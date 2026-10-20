/**
 * Alga's real LevelIoApiClient against the algasim Level emulator, over HTTP.
 *
 * The emulator package knows nothing about the product: an import of ee/server
 * from packages/emulators/levelio would make the Nx project graph circular
 * (sebastian-ee already imports the emulator for the route test). So the
 * consumer-side check lives here: cursor pagination, include_* detail
 * sections, last_seen_at as incremental-sync input, alert/update filters and
 * the client's 429/5xx handling. The vendor wire contract itself is covered by
 * packages/emulators/levelio/tests/rest.test.ts.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { EmulatorHost } from '@alga-psa/emulator-host';
import levelio, { type LevelEmulatorCore } from '@alga-psa/emulator-levelio';
import { LevelIoApiClient, LevelIoApiError } from '../../lib/integrations/levelio/levelApiClient';
import { mapLevelIoDiskUsage } from '../../lib/integrations/levelio/mappers/deviceMapper';

// createLevelIoClient imports the secrets provider at module load; the client
// under test is constructed directly with the emulator's base URL.
vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: async () => ({ getTenantSecret: async () => undefined }),
}));

const API_KEY = 'algasim-level-key';

let host: EmulatorHost;
let control: string;
let vendor: string;
let core: LevelEmulatorCore;

async function callControl(kind: 'seed' | 'actions', name: string, params: unknown = {}) {
  const response = await fetch(`${control}/control/levelio/${kind}/${name}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(params),
  });
  const json = (await response.json()) as { ok: boolean; result?: any; error?: string };
  if (!json.ok) throw new Error(`${kind}/${name} failed: ${json.error}`);
  return json.result;
}

const seed = (name: string, params?: unknown) => callControl('seed', name, params);
const action = (name: string, params?: unknown) => callControl('actions', name, params);

async function arm(name: string, params: unknown = {}) {
  const response = await fetch(`${control}/control/levelio/faults/${name}/arm`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (response.status !== 200) throw new Error(`arm ${name} failed: ${await response.text()}`);
}

function client(apiKey = API_KEY) {
  return new LevelIoApiClient({ apiKey, baseUrl: vendor, maxRetries: 2 });
}

beforeAll(async () => {
  host = new EmulatorHost({ emulators: [levelio], controlPort: 0, ports: { levelio: 0 } });
  const { controlPort, ports } = await host.start();
  control = `http://127.0.0.1:${controlPort}`;
  vendor = `http://127.0.0.1:${ports.levelio}`;
  core = host.instance('levelio').core as LevelEmulatorCore;
});

afterAll(async () => {
  await host.stop();
});

beforeEach(async () => {
  await fetch(`${control}/control/levelio/reset`, { method: 'POST' });
});

describe('LevelIoApiClient against the Level emulator', () => {
  it('testConnection succeeds with the key and surfaces 401 as LevelIoApiError otherwise', async () => {
    await expect(client().testConnection()).resolves.toBeUndefined();
    await expect(client('wrong-key').testConnection()).rejects.toMatchObject({ status: 401 });

    await action('revoke-api-key', { key: API_KEY });
    await expect(client().testConnection()).rejects.toBeInstanceOf(LevelIoApiError);
  });

  it('listGroups walks the hierarchy across pages with limit=100 + starting_after', async () => {
    const root = (await seed('group', { name: 'Acme Corp' })).group;
    for (let i = 0; i < 104; i += 1) {
      await seed('group', { name: `Site ${i}`, parentId: root.id });
    }
    await seed('device', { hostname: 'WS-01', groupId: root.id });

    const groups = await client().listGroups();
    expect(groups).toHaveLength(105);
    expect(new Set(groups.map((g) => g.id)).size).toBe(105);
    const acme = groups.find((g) => g.id === root.id)!;
    expect(acme).toMatchObject({ parent_id: null, name: 'Acme Corp', device_count: 1, descendent_device_count: 1 });
    expect(acme.child_ids).toHaveLength(104);
    expect(root.id).toBe('Z2lkOi8vbGV2ZWwvRGV2aWNlR3JvdXAvMQ'); // gid://level/DeviceGroup/1, Level's id form
  });

  it('listDevices asks for the detail sections and filters by ancestor group; getDevice carries security', async () => {
    const acme = (await seed('group', { name: 'Acme' })).group;
    const branch = (await seed('group', { name: 'Branch', parentId: acme.id })).group;
    const other = (await seed('group', { name: 'Other' })).group;
    const ws = (
      await seed('device', {
        hostname: 'WS-01',
        groupId: branch.id,
        serial_number: 'SN-1',
        operating_system: { full_operating_system: 'Windows 11 Pro', major_version: '10.0' },
        network_interfaces: [{ interface: 'eth0', ip_addresses: ['10.0.0.5'] }],
        disks: [{ disk_type: 'NVMe', model: 'Samsung', size: 512_000_000_000 }],
        security: { score: 80 },
      })
    ).device;
    await seed('device', { hostname: 'OTHER-01', groupId: other.id });

    const devices = await client().listDevices({ ancestorGroupId: acme.id });
    expect(devices.map((d) => d.hostname)).toEqual(['WS-01']);
    expect(devices[0].operating_system).toEqual({ full_operating_system: 'Windows 11 Pro', major_version: '10.0' });
    expect(devices[0].network_interfaces).toHaveLength(1);
    // Level's documented device carries `disks`, which Alga's type and mapper read.
    expect(devices[0].disks).toHaveLength(1);
    expect((devices[0] as unknown as Record<string, unknown>).disk_partitions).toBeUndefined();
    expect(mapLevelIoDiskUsage(devices[0])).toEqual([{ name: 'NVMe Samsung', total_gb: 476.84 }]);

    expect((await client().getDevice(ws.id)).security).toEqual({ score: 80 });
    expect(await client().listDevices({ groupId: acme.id })).toEqual([]);
    await expect(client().getDevice('nope')).rejects.toMatchObject({ status: 404 });
  });

  it('reports last_seen_at as now for online devices and frozen for offline ones (incremental sync input)', async () => {
    const online = (await seed('device', { hostname: 'ONLINE' })).device;
    const offline = (await seed('device', { hostname: 'OFFLINE' })).device;
    await action('device-offline', { deviceId: offline.id });
    const frozenAt = core.getDevice(offline.id).last_seen_at!;

    host.clock.advance('2h');
    const since = new Date(host.clock.now().getTime() - 60_000);
    const devices = await client().listDevices();
    const byHost = Object.fromEntries(devices.map((d) => [d.hostname, d]));
    expect(byHost.OFFLINE.last_seen_at).toBe(frozenAt);
    expect(new Date(byHost.ONLINE.last_seen_at!).getTime()).toBeGreaterThanOrEqual(since.getTime());
    // The sync engine's incremental filter keeps devices seen at/after `since`.
    const changed = devices.filter((d) => !d.last_seen_at || new Date(d.last_seen_at) >= since);
    expect(changed.map((d) => d.id)).toEqual([online.id]);

    await action('device-checkin', { deviceId: offline.id });
    expect((await client().getDevice(offline.id)).online).toBe(true);
  });

  it('lists alerts by device and status, and resolves through POST /resolve', async () => {
    const ws = (await seed('device', { hostname: 'WS-01' })).device;
    const srv = (await seed('device', { hostname: 'SRV-01', role: 'server' })).device;
    const disk = (
      await action('fire-alert', {
        deviceId: ws.id,
        name: 'Low disk space',
        description: 'Disk free < 5.0%',
        severity: 'critical',
        payload: '4.37% (10.39 GB) remaining',
      })
    ).alert;
    await action('fire-alert', { deviceId: srv.id, name: 'CPU', severity: 'warning' });

    const active = await client().listAlerts({ status: 'active' });
    expect(active).toHaveLength(2);
    expect(active[0]).toEqual({
      id: disk.id,
      device_id: ws.id,
      device_hostname: 'WS-01',
      name: 'Low disk space',
      description: 'Disk free < 5.0%',
      payload: '4.37% (10.39 GB) remaining',
      severity: 'critical',
      is_resolved: false,
      started_at: expect.any(String),
      resolved_at: null,
    });

    await client().resolveAlert(disk.id);
    expect((await client().listAlerts({ status: 'resolved' })).map((a) => a.id)).toEqual([disk.id]);
    expect(await client().listAlerts({ deviceId: srv.id })).toHaveLength(1);
  });

  it('lists updates filtered by device and status', async () => {
    const ws = (await seed('device', { hostname: 'WS-01' })).device;
    await seed('update', { deviceId: ws.id, name: 'KB5034441', category: 'Security Updates' });
    await seed('update', { deviceId: ws.id, name: 'KB0000001', is_available: false, installed_on: '2026-10-01T00:00:00.000Z' });
    expect((await client().listUpdates({ deviceId: ws.id, status: 'available' })).map((u) => u.name)).toEqual(['KB5034441']);
    expect((await client().listUpdates({ status: 'installed' })).map((u) => u.name)).toEqual(['KB0000001']);
  });

  it('retries a 429 after Retry-After, then surfaces persistent 429 and 5xx as errors', async () => {
    await seed('group', { name: 'Acme' });

    await arm('rate-limit', { remaining: 2, retryAfterSeconds: 0 });
    await expect(client().listGroups()).resolves.toHaveLength(1);
    const journal = (await (await fetch(`${control}/control/levelio/requests`)).json()).result;
    expect(journal.requests.filter((r: { status: number }) => r.status === 429)).toHaveLength(2);

    await arm('rate-limit', { remaining: 3, retryAfterSeconds: 0 });
    await expect(client().listGroups()).rejects.toMatchObject({ status: 429 }); // maxRetries: 2

    await arm('operation-fault', { operation: 'GET /v2/devices', status: 503, message: 'Service unavailable' });
    await expect(client().listDevices()).rejects.toMatchObject({ status: 503 });
    await expect(client().listDevices()).resolves.toEqual([]);
  });
});
