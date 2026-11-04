import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { renderTemplate, SYSTEM_VARIABLE_NAMES } from '../src/variables';
import { startLevel, startReceiver } from './helpers';

let level: Awaited<ReturnType<typeof startLevel>>;
let receiver: Awaited<ReturnType<typeof startReceiver>>;

/**
 * The payload template Alga's settings screen tells users to paste into a
 * Level automation (getLevelIoWebhookInfo, as of 2026-10-15).
 */
const ALGA_TEMPLATE = JSON.stringify(
  {
    event: 'alert.triggered',
    alert_id: '{{alert_id}}',
    device_id: '{{device_id}}',
    hostname: '{{hostname}}',
    name: '{{alert_name}}',
    severity: '{{severity}}',
    description: '{{description}}',
  },
  null,
  2,
);

beforeAll(async () => {
  level = await startLevel();
  receiver = await startReceiver();
});

afterAll(async () => {
  await level.host.stop();
  await receiver.close();
});

beforeEach(async () => {
  await level.reset();
  receiver.received.length = 0;
  receiver.respondWith(() => ({ status: 200, body: '{"ok":true}' }));
});

async function seedEstate() {
  const hq = (await level.seed('group', { name: 'HQ' })).group;
  const servers = (await level.seed('group', { name: 'Servers', parentId: hq.id })).group;
  const device = (
    await level.seed('device', {
      hostname: 'SRV-01',
      groupId: servers.id,
      tags: ['exchange', 'nginx'],
      total_memory: 17_179_869_184,
      cpu_cores: 8,
      architecture: 'amd64',
      manufacturer: 'Dell',
      model: 'PowerEdge R650',
      operating_system: { full_operating_system: 'Windows Server 2022', minor_version: '10.0.20348.2340' },
      network_interfaces: [{ ip_addresses: ['10.0.0.5', '10.0.1.5'] }],
      publicIpAddress: '203.0.113.7',
    })
  ).device;
  return { hq, servers, device };
}

describe('Level automation HTTP Request action', () => {
  it('renders every documented system variable', async () => {
    const { servers, device } = await seedEstate();
    await level.seed('automation', {
      name: 'dump variables',
      url: `${receiver.url}/vars`,
      body: JSON.stringify(Object.fromEntries(SYSTEM_VARIABLE_NAMES.map((name) => [name, `{{${name}}}`]))),
    });
    await level.action('fire-alert', { deviceId: device.id, name: 'CPU' });

    const vars = JSON.parse(receiver.received[0].rawBody);
    expect(vars).toMatchObject({
      level_device_id: device.id,
      level_device_hostname: 'SRV-01',
      level_device_nickname: '',
      level_device_public_ip_address: '203.0.113.7',
      level_device_private_ip_addresses: '10.0.0.5,10.0.1.5',
      level_device_architecture: 'amd64',
      level_device_cpu_cores: '8',
      level_device_memory: '17179869184',
      level_device_memory_formatted: '16 GB',
      level_device_os: 'Windows Server 2022',
      level_device_os_version: '10.0.20348.2340',
      level_device_manufacturer: 'Dell',
      level_device_model: 'PowerEdge R650',
      level_device_last_boot_at: '',
      level_device_online: 'true',
      level_device_maintenance_mode: 'false',
      level_device_restart_required: 'false',
      level_group_id: servers.id,
      level_group_name: 'Servers',
      level_group_path: 'HQ / Servers',
      level_tag_names: 'exchange,nginx',
    });
    expect(vars.level_tag_ids.split(',')).toHaveLength(2);
    expect(Object.values(vars).some((value) => String(value).includes('{{'))).toBe(false);
  });

  it('sends Alga\'s pasted template with its unknown {{placeholders}} as literal text', async () => {
    const { device } = await seedEstate();
    await level.seed('automation', {
      name: 'Alga alert forwarder',
      url: `${receiver.url}/api/webhooks/levelio?tenant=t-1`,
      headers: { 'X-Alga-Webhook-Secret': 'alga-secret' },
      body: ALGA_TEMPLATE,
    });
    await level.action('fire-alert', { deviceId: device.id, name: 'CPU', severity: 'critical' });
    await level.action('fire-alert', { deviceId: device.id, name: 'Low disk space' });

    expect(receiver.received).toHaveLength(2);
    const [first, second] = receiver.received.map((r) => JSON.parse(r.rawBody));
    expect(first).toEqual(JSON.parse(ALGA_TEMPLATE)); // nothing rendered
    expect(second).toEqual(first); // two distinct alerts, byte-identical payloads
    expect(receiver.received[0].headers['x-alga-webhook-secret']).toBe('alga-secret');
    const runs = await level.state('automation-runs');
    expect(runs[0].unresolvedVariables).toEqual(['alert_id', 'device_id', 'hostname', 'alert_name', 'severity', 'description']);
  });

  it('renders system variables and automation variables in URL, headers and body', async () => {
    const { device } = await seedEstate();
    await level.seed('automation', {
      name: 'rendered forwarder',
      url: `${receiver.url}/hook/{{level_group_id}}?host={{level_device_hostname}}`,
      headers: [{ key: 'Authorization', value: 'Bearer {{api_token}}' }],
      body: '{"device_id":"{{level_device_id}}","group":"{{level_group_name}}","at":"{{level_time}}"}',
      variables: { api_token: 'tok-123' },
    });
    await level.action('fire-alert', { deviceId: device.id, name: 'CPU' });
    const [request] = receiver.received;
    expect(request.path).toBe(`/hook/${device.group_id}?host=SRV-01`);
    expect(request.headers.authorization).toBe('Bearer tok-123');
    expect(JSON.parse(request.rawBody)).toEqual({
      device_id: device.id,
      group: 'Servers',
      at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
    });
  });

  it('runs only automations whose monitor trigger matches the alert and the device\'s group', async () => {
    const { hq, device } = await seedEstate();
    const other = (await level.seed('group', { name: 'Elsewhere' })).group;
    const lone = (await level.seed('device', { hostname: 'WS-99', groupId: other.id })).device;
    await level.seed('automation', { name: 'disk only', alertNames: ['Low disk space'], url: `${receiver.url}/disk` });
    await level.seed('automation', { name: 'HQ tree', groupIds: [hq.id], url: `${receiver.url}/hq` });
    await level.seed('automation', { name: 'disabled', enabled: false, url: `${receiver.url}/off` });

    await level.action('fire-alert', { deviceId: device.id, name: 'CPU' });
    await level.action('fire-alert', { deviceId: lone.id, name: 'Low disk space' });
    expect(receiver.received.map((r) => r.path)).toEqual(['/hq', '/disk']);
  });

  it('records failed actions and honors the configured retry count', async () => {
    const { device } = await seedEstate();
    receiver.respondWith(() => ({ status: 503 }));
    await level.seed('automation', { name: 'flaky', url: `${receiver.url}/x`, retries: 2 });
    const fired = await level.action('fire-alert', { deviceId: device.id, name: 'CPU' });
    expect(fired.automationRuns.map((r: any) => [r.attempt, r.status, r.ok])).toEqual([[1, 503, false], [2, 503, false], [3, 503, false]]);
  });

  it('leaves unknown tokens intact and reports them', () => {
    expect(renderTemplate('{{ level_x }} {{a}} {{a}} {{b}}', { a: '1' })).toEqual({ text: '{{ level_x }} 1 1 {{b}}', unresolved: ['level_x', 'b'] });
  });
});
