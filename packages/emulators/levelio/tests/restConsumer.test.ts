import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { startLevel } from './helpers';

// Alga's real LevelIoApiClient over HTTP. Only the secrets provider (imported
// at module load by createLevelIoClient) is stubbed; the client under test is
// constructed directly with the emulator's base URL.
vi.mock('@alga-psa/core/secrets', () => ({ getSecretProviderInstance: async () => ({ getTenantSecret: async () => undefined }) }));

const { LevelIoApiClient, LevelIoApiError } = await import(
  '../../../../ee/server/src/lib/integrations/levelio/levelApiClient'
);

const API_KEY = 'algasim-level-key';
let level: Awaited<ReturnType<typeof startLevel>>;

function client(apiKey = API_KEY) {
  return new LevelIoApiClient({ apiKey, baseUrl: level.vendor, maxRetries: 2 });
}

async function raw(path: string, init: RequestInit = {}) {
  const response = await fetch(`${level.vendor}${path}`, {
    ...init,
    headers: { authorization: API_KEY, ...(init.headers as Record<string, string>) },
  });
  return { status: response.status, headers: response.headers, body: (await response.json()) as any };
}

beforeAll(async () => {
  level = await startLevel();
});

afterAll(async () => {
  await level.host.stop();
});

beforeEach(async () => {
  await level.reset();
});

describe('Level REST surface via LevelIoApiClient', () => {
  it('testConnection succeeds with the key and fails with Level\'s 401 envelope otherwise', async () => {
    await expect(client().testConnection()).resolves.toBeUndefined();

    await expect(client('wrong-key').testConnection()).rejects.toMatchObject({ status: 401 });
    const denied = await fetch(`${level.vendor}/v2/groups`, { headers: { authorization: `Bearer ${API_KEY}` } });
    expect(denied.status).toBe(401);
    expect(await denied.json()).toEqual({ error: 'Access denied' });

    await level.action('revoke-api-key', { key: API_KEY });
    await expect(client().testConnection()).rejects.toBeInstanceOf(LevelIoApiError);
  });

  it('walks the group hierarchy across pages with starting_after/has_more', async () => {
    const root = (await level.seed('group', { name: 'Acme Corp' })).group;
    for (let i = 0; i < 104; i += 1) {
      await level.seed('group', { name: `Site ${i}`, parentId: root.id });
    }
    await level.seed('device', { hostname: 'WS-01', groupId: root.id });

    const groups = await client().listGroups();
    expect(groups).toHaveLength(105);
    expect(new Set(groups.map((g) => g.id)).size).toBe(105);
    const acme = groups.find((g) => g.id === root.id)!;
    expect(acme).toMatchObject({ parent_id: null, name: 'Acme Corp', device_count: 1, descendent_device_count: 1 });
    expect(acme.child_ids).toHaveLength(104);
    expect(root.id).toBe('Z2lkOi8vbGV2ZWwvRGV2aWNlR3JvdXAvMQ'); // gid://level/DeviceGroup/1, Level's id form

    const firstPage = await raw('/v2/groups');
    expect(firstPage.body.data).toHaveLength(20); // documented default limit
    expect(firstPage.body.has_more).toBe(true);
    const roots = await raw('/v2/groups?parent_id=null');
    expect(roots.body).toEqual({ data: [expect.objectContaining({ id: root.id })], has_more: false });
    const back = await raw(`/v2/groups?limit=2&ending_before=${groups[5].id}`);
    expect(back.body.data.map((g: { id: string }) => g.id)).toEqual([groups[3].id, groups[4].id]);
    expect(back.body.has_more).toBe(true);
  });

  it('returns detail sections only when include_* is true, and filters by ancestor group', async () => {
    const acme = (await level.seed('group', { name: 'Acme' })).group;
    const branch = (await level.seed('group', { name: 'Branch', parentId: acme.id })).group;
    const other = (await level.seed('group', { name: 'Other' })).group;
    const ws = (
      await level.seed('device', {
        hostname: 'WS-01',
        groupId: branch.id,
        serial_number: 'SN-1',
        operating_system: { full_operating_system: 'Windows 11 Pro', major_version: '10.0' },
        network_interfaces: [{ interface: 'eth0', ip_addresses: ['10.0.0.5'] }],
        disks: [{ disk_type: 'NVMe', model: 'Samsung', size: 512_000_000_000 }],
        security: { score: 80 },
      })
    ).device;
    await level.seed('device', { hostname: 'OTHER-01', groupId: other.id });

    const devices = await client().listDevices({ ancestorGroupId: acme.id });
    expect(devices.map((d) => d.hostname)).toEqual(['WS-01']);
    expect(devices[0].operating_system).toEqual({ full_operating_system: 'Windows 11 Pro', major_version: '10.0' });
    expect(devices[0].network_interfaces).toHaveLength(1);
    // Level's documented device carries `disks`; Alga's mapper reads `disk_partitions`.
    expect((devices[0] as unknown as Record<string, unknown>).disks).toHaveLength(1);
    expect(devices[0].disk_partitions).toBeUndefined();

    const bare = await raw(`/v2/devices/${ws.id}`);
    expect(bare.body.operating_system).toBeUndefined();
    expect(bare.body.security).toBeUndefined();
    expect((await client().getDevice(ws.id)).security).toEqual({ score: 80 });

    expect((await raw(`/v2/devices?group_id=${acme.id}`)).body.data).toEqual([]);
    expect((await raw('/v2/devices?serial_number=SN-1')).body.data).toHaveLength(1);
    expect((await raw('/v2/devices/nope')).status).toBe(404);
    expect((await raw('/v2/devices/nope')).body).toEqual({ error: 'Record not found' });
  });

  it('reports last_seen_at as now for online devices and frozen for offline ones (incremental sync input)', async () => {
    const online = (await level.seed('device', { hostname: 'ONLINE' })).device;
    const offline = (await level.seed('device', { hostname: 'OFFLINE' })).device;
    await level.action('device-offline', { deviceId: offline.id });
    const frozenAt = level.core.getDevice(offline.id).last_seen_at!;

    level.host.clock.advance('2h');
    const since = new Date(level.host.clock.now().getTime() - 60_000);
    const devices = await client().listDevices();
    const byHost = Object.fromEntries(devices.map((d) => [d.hostname, d]));
    expect(byHost.OFFLINE.last_seen_at).toBe(frozenAt);
    expect(new Date(byHost.ONLINE.last_seen_at!).getTime()).toBeGreaterThanOrEqual(since.getTime());
    // The sync engine's incremental filter keeps devices seen at/after `since`.
    const changed = devices.filter((d) => !d.last_seen_at || new Date(d.last_seen_at) >= since);
    expect(changed.map((d) => d.id)).toEqual([online.id]);

    await level.action('device-checkin', { deviceId: offline.id });
    expect((await client().getDevice(offline.id)).online).toBe(true);
  });

  it('lists alerts by device and status, and resolves through POST /resolve', async () => {
    const ws = (await level.seed('device', { hostname: 'WS-01' })).device;
    const srv = (await level.seed('device', { hostname: 'SRV-01', role: 'server' })).device;
    const disk = (await level.action('fire-alert', { deviceId: ws.id, name: 'Low disk space', description: 'Disk free < 5.0%', severity: 'critical', payload: '4.37% (10.39 GB) remaining' })).alert;
    await level.action('fire-alert', { deviceId: srv.id, name: 'CPU', severity: 'warning' });

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
    expect((await raw('/v2/alerts?status=bogus')).status).toBe(400);
  });

  it('serves updates filtered by device and status', async () => {
    const ws = (await level.seed('device', { hostname: 'WS-01' })).device;
    await level.seed('update', { deviceId: ws.id, name: 'KB5034441', category: 'Security Updates' });
    await level.seed('update', { deviceId: ws.id, name: 'KB0000001', is_available: false, installed_on: '2026-10-01T00:00:00.000Z' });
    expect((await client().listUpdates({ deviceId: ws.id, status: 'available' })).map((u) => u.name)).toEqual(['KB5034441']);
    expect((await client().listUpdates({ status: 'installed' })).map((u) => u.name)).toEqual(['KB0000001']);
  });

  it('retries a 429 after Retry-After, then surfaces persistent 5xx and 429 as errors', async () => {
    await level.seed('group', { name: 'Acme' });

    await level.arm('rate-limit', { remaining: 2, retryAfterSeconds: 0 });
    await expect(client().listGroups()).resolves.toHaveLength(1);
    const journal = (await (await fetch(`${level.control}/control/levelio/requests`)).json()).result;
    expect(journal.requests.filter((r: { status: number }) => r.status === 429)).toHaveLength(2);

    await level.arm('rate-limit', { remaining: 3, retryAfterSeconds: 0 });
    await expect(client().listGroups()).rejects.toMatchObject({ status: 429 }); // maxRetries: 2

    await level.arm('operation-fault', { operation: 'GET /v2/devices', status: 503, message: 'Service unavailable' });
    await expect(client().listDevices()).rejects.toMatchObject({ status: 503 });
    await expect(client().listDevices()).resolves.toEqual([]);
  });

  it('answers 400 for out-of-range limits and unknown cursors, 501 for unmodeled v2 routes', async () => {
    expect((await raw('/v2/devices?limit=101')).status).toBe(400);
    expect((await raw('/v2/devices?limit=0')).status).toBe(400);
    expect((await raw('/v2/devices?starting_after=missing')).status).toBe(400);
    const tags = await raw('/v2/tags');
    expect(tags.status).toBe(501);
    expect(tags.body.code).toBe('EmulatorUnsupportedOperation');
  });
});
