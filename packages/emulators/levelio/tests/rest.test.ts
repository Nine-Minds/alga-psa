import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startLevel } from './helpers';

// The Level v2 REST surface as a wire contract, driven with plain fetch the way
// Level documents it (Authorization: <key>, limit + starting_after cursors,
// include_* detail flags). Alga's LevelIoApiClient against this emulator is
// covered on the product side, in
// ee/server/src/__tests__/integration/levelioEmulatorApiClient.integration.test.ts,
// so this package never imports the product.

const API_KEY = 'algasim-level-key';
const INCLUDE_ALL =
  'include_operating_system=true&include_cpus=true&include_memory=true&include_disks=true&include_network_interfaces=true&include_security=true';
let level: Awaited<ReturnType<typeof startLevel>>;

async function raw(path: string, init: RequestInit = {}) {
  const response = await fetch(`${level.vendor}${path}`, {
    ...init,
    headers: { authorization: API_KEY, ...(init.headers as Record<string, string>) },
  });
  return { status: response.status, headers: response.headers, body: (await response.json()) as any };
}

/** Walk a list endpoint with limit=100 + starting_after until has_more is false. */
async function listAll(path: string) {
  const items: any[] = [];
  let startingAfter: string | undefined;
  for (;;) {
    const separator = path.includes('?') ? '&' : '?';
    const cursor = startingAfter ? `&starting_after=${encodeURIComponent(startingAfter)}` : '';
    const page = await raw(`${path}${separator}limit=100${cursor}`);
    expect(page.status).toBe(200);
    items.push(...page.body.data);
    if (!page.body.has_more || page.body.data.length === 0) return items;
    startingAfter = page.body.data[page.body.data.length - 1].id;
  }
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

describe('Level v2 REST surface', () => {
  it('accepts the bare API key and answers Level\'s 401 envelope otherwise', async () => {
    expect((await raw('/v2/groups?limit=1')).status).toBe(200);

    const wrong = await fetch(`${level.vendor}/v2/groups`, { headers: { authorization: 'wrong-key' } });
    expect(wrong.status).toBe(401);
    expect(await wrong.json()).toEqual({ error: 'Access denied' });
    // Level takes the key verbatim, not as a Bearer token.
    const bearer = await fetch(`${level.vendor}/v2/groups`, { headers: { authorization: `Bearer ${API_KEY}` } });
    expect(bearer.status).toBe(401);

    await level.action('revoke-api-key', { key: API_KEY });
    expect((await raw('/v2/groups?limit=1')).status).toBe(401);
  });

  it('pages the group hierarchy with starting_after/ending_before and has_more', async () => {
    const root = (await level.seed('group', { name: 'Acme Corp' })).group;
    for (let i = 0; i < 104; i += 1) {
      await level.seed('group', { name: `Site ${i}`, parentId: root.id });
    }
    await level.seed('device', { hostname: 'WS-01', groupId: root.id });

    const groups = await listAll('/v2/groups');
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

    const devices = await listAll(`/v2/devices?ancestor_group_id=${acme.id}&${INCLUDE_ALL}`);
    expect(devices.map((d) => d.hostname)).toEqual(['WS-01']);
    expect(devices[0].operating_system).toEqual({ full_operating_system: 'Windows 11 Pro', major_version: '10.0' });
    expect(devices[0].network_interfaces).toHaveLength(1);
    // Level's documented device carries `disks`, not `disk_partitions`.
    expect(devices[0].disks).toHaveLength(1);
    expect(devices[0].disk_partitions).toBeUndefined();

    const bare = await raw(`/v2/devices/${ws.id}`);
    expect(bare.body.operating_system).toBeUndefined();
    expect(bare.body.security).toBeUndefined();
    expect((await raw(`/v2/devices/${ws.id}?include_security=true`)).body.security).toEqual({ score: 80 });

    expect((await raw(`/v2/devices?group_id=${acme.id}`)).body.data).toEqual([]);
    expect((await raw('/v2/devices?serial_number=SN-1')).body.data).toHaveLength(1);
    expect((await raw('/v2/devices/nope')).status).toBe(404);
    expect((await raw('/v2/devices/nope')).body).toEqual({ error: 'Record not found' });
  });

  it('reports last_seen_at as now for online devices and frozen for offline ones', async () => {
    const online = (await level.seed('device', { hostname: 'ONLINE' })).device;
    const offline = (await level.seed('device', { hostname: 'OFFLINE' })).device;
    await level.action('device-offline', { deviceId: offline.id });
    const frozenAt = level.core.getDevice(offline.id).last_seen_at!;

    level.host.clock.advance('2h');
    const since = new Date(level.host.clock.now().getTime() - 60_000);
    const devices = await listAll('/v2/devices');
    const byHost = Object.fromEntries(devices.map((d) => [d.hostname, d]));
    expect(byHost.OFFLINE.last_seen_at).toBe(frozenAt);
    expect(byHost.OFFLINE.online).toBe(false);
    expect(new Date(byHost.ONLINE.last_seen_at).getTime()).toBeGreaterThanOrEqual(since.getTime());
    expect([online.id]).toEqual(devices.filter((d) => new Date(d.last_seen_at) >= since).map((d) => d.id));

    await level.action('device-checkin', { deviceId: offline.id });
    expect((await raw(`/v2/devices/${offline.id}`)).body.online).toBe(true);
  });

  it('lists alerts by device and status, and resolves through POST /resolve', async () => {
    const ws = (await level.seed('device', { hostname: 'WS-01' })).device;
    const srv = (await level.seed('device', { hostname: 'SRV-01', role: 'server' })).device;
    const disk = (
      await level.action('fire-alert', {
        deviceId: ws.id,
        name: 'Low disk space',
        description: 'Disk free < 5.0%',
        severity: 'critical',
        payload: '4.37% (10.39 GB) remaining',
      })
    ).alert;
    await level.action('fire-alert', { deviceId: srv.id, name: 'CPU', severity: 'warning' });

    const active = await raw('/v2/alerts?status=active');
    expect(active.body.data).toHaveLength(2);
    expect(active.body.data[0]).toEqual({
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

    expect((await raw(`/v2/alerts/${disk.id}/resolve`, { method: 'POST' })).status).toBe(200);
    expect((await raw('/v2/alerts?status=resolved')).body.data.map((a: { id: string }) => a.id)).toEqual([disk.id]);
    expect((await raw(`/v2/alerts?device_id=${srv.id}`)).body.data).toHaveLength(1);
    expect((await raw('/v2/alerts?status=bogus')).status).toBe(400);
  });

  it('serves updates filtered by device and status', async () => {
    const ws = (await level.seed('device', { hostname: 'WS-01' })).device;
    await level.seed('update', { deviceId: ws.id, name: 'KB5034441', category: 'Security Updates' });
    await level.seed('update', { deviceId: ws.id, name: 'KB0000001', is_available: false, installed_on: '2026-10-01T00:00:00.000Z' });
    const available = await raw(`/v2/updates?device_id=${ws.id}&status=available`);
    expect(available.body.data.map((u: { name: string }) => u.name)).toEqual(['KB5034441']);
    const installed = await raw('/v2/updates?status=installed');
    expect(installed.body.data.map((u: { name: string }) => u.name)).toEqual(['KB0000001']);
  });

  it('answers armed rate limits with 429 + Retry-After and operation faults with Level\'s error envelope', async () => {
    await level.seed('group', { name: 'Acme' });

    await level.arm('rate-limit', { remaining: 2, retryAfterSeconds: 7 });
    const first = await raw('/v2/groups');
    expect(first.status).toBe(429);
    expect(first.headers.get('retry-after')).toBe('7');
    expect((await raw('/v2/groups')).status).toBe(429);
    expect((await raw('/v2/groups')).status).toBe(200);
    const journal = (await (await fetch(`${level.control}/control/levelio/requests`)).json()).result;
    expect(journal.requests.filter((r: { status: number }) => r.status === 429)).toHaveLength(2);

    await level.arm('operation-fault', { operation: 'GET /v2/devices', status: 503, message: 'Service unavailable' });
    const failed = await raw('/v2/devices');
    expect(failed.status).toBe(503);
    expect(failed.body).toEqual({ error: 'Service unavailable' });
    expect((await raw('/v2/devices')).body).toEqual({ data: [], has_more: false });
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
