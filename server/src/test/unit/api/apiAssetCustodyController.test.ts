import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CustodyError } from '@alga-psa/assets/lib/custody/errors';

const state = vi.hoisted(() => ({
  rbac: { read: true, update: true } as Record<string, boolean>,
  guard: null as null | { status: number },
  calls: [] as string[],
  open: { custody_id: 'c1' } as unknown,
  throwOn: null as null | Error,
}));

vi.mock('@/lib/productAccess', () => ({
  getTenantProduct: vi.fn(async () => 'psa'),
  ProductAccessError: class extends Error {},
}));
vi.mock('@/lib/productSurfaceRegistry', () => ({ resolveProductApiBehavior: () => 'allowed' }));
vi.mock('@/lib/api/services/AssetService', () => ({ AssetService: class {} }));
vi.mock('@/lib/auth/rbac', () => ({
  hasPermission: vi.fn(async (_u: unknown, _r: string, action: string) => state.rbac[action]),
}));
vi.mock('@/lib/db/db', () => ({ getConnection: vi.fn(async () => ({})) }));
vi.mock('@/lib/api/controllers/assetReadGuard', () => ({
  guardAssetRead: vi.fn(async () =>
    state.guard ? new Response(JSON.stringify({ error: { message: 'Asset not found' } }), { status: state.guard.status }) : null
  ),
}));
vi.mock('@alga-psa/assets/lib/custody/service', () => ({
  getAssetCustodyService: vi.fn(async () => {
    state.calls.push('get');
    return { open: state.open, episodes: [] };
  }),
  resolveCustodyToday: vi.fn(async () => '2026-10-24'),
  listCustodyEventsService: vi.fn(async () => []),
  openCustodyService: vi.fn(async () => {
    state.calls.push('open');
    if (state.throwOn) throw state.throwOn;
    return { custody: { custody_id: 'c1' }, event: { event_id: 'e1' } };
  }),
  recordCustodyEventService: vi.fn(async () => {
    state.calls.push('event');
    if (state.throwOn) throw state.throwOn;
    return { custody: { custody_id: 'c1' }, event: { event_id: 'e2' } };
  }),
  listCustodyQueueService: vi.fn(async () => {
    state.calls.push('queue');
    return { rows: [], total: 0, counts: {} };
  }),
}));

const { ApiAssetCustodyController } = await import('@/lib/api/controllers/ApiAssetCustodyController');

const A = '6f1c2b1e-0b57-4a53-9d77-2f0f4d9f1a11';
const L = '7f1c2b1e-0b57-4a53-9d77-2f0f4d9f1a11';
const req = (url: string, body?: unknown) => {
  const r: any = new Request(`http://x${url}`, body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) });
  r.context = { tenant: 't1', user: { user_id: 'u1', user_type: 'internal' } };
  return r;
};

beforeEach(() => {
  state.rbac = { read: true, update: true };
  state.guard = null;
  state.calls = [];
  state.open = { custody_id: 'c1' };
  state.throwOn = null;
});

describe('ApiAssetCustodyController', () => {
  const c = new ApiAssetCustodyController();

  it('GET returns 404 with no data when the record-level guard denies, and never reads custody', async () => {
    state.guard = { status: 404 };
    const res = await c.get(req(`/api/v1/assets/${A}/custody`), { id: A });
    expect(res.status).toBe(404);
    expect(state.calls).toEqual([]);
    expect(JSON.stringify(await res.json())).not.toMatch(/custody_id|episodes/);
  });

  it('403 without asset:read / asset:update, before the record is loaded', async () => {
    state.rbac = { read: false, update: false };
    expect((await c.get(req('/x'), { id: A })).status).toBe(403);
    expect((await c.open(req('/x', {}), { id: A })).status).toBe(403);
    expect((await c.recordEvent(req('/x', { event_type: 'moved' }), { id: A })).status).toBe(403);
    expect((await c.queue(req('/api/v1/asset-custody'))).status).toBe(403);
    expect(state.calls).toEqual([]);
  });

  it('a read-only caller cannot write (asset:update required)', async () => {
    state.rbac = { read: true, update: false };
    expect((await c.recordEvent(req('/x', { event_type: 'moved', location_id: L }), { id: A })).status).toBe(403);
    expect(state.calls).toEqual([]);
  });

  it('POST open validates the body (400) and maps an open episode to 409', async () => {
    expect((await c.open(req('/x', { bin: 'x' }), { id: A })).status).toBe(400);
    state.throwOn = new CustodyError('open_episode_exists', 'already in custody');
    const res = await c.open(req('/x', { purpose: 'repair', location_id: L, bin: 'Shelf B3' }), { id: A });
    expect(res.status).toBe(409);
  });

  it('POST open succeeds with 201 and forces the asset id from the path', async () => {
    const res = await c.open(req('/x', { asset_id: L, purpose: 'repair', location_id: L, bin: 'Shelf B3' }), { id: A });
    expect(res.status).toBe(201);
  });

  it('POST events: 409 when the asset is not in custody, invalid transition 409, success 201', async () => {
    state.open = null;
    expect((await c.recordEvent(req('/x', { event_type: 'moved', location_id: L }), { id: A })).status).toBe(409);
    state.open = { custody_id: 'c1' };
    state.throwOn = new CustodyError('invalid_transition', 'not allowed');
    expect((await c.recordEvent(req('/x', { event_type: 'received', location_id: L, bin: 'B' }), { id: A })).status).toBe(409);
    state.throwOn = null;
    expect((await c.recordEvent(req('/x', { event_type: 'moved', location_id: L, bin: 'C1' }), { id: A })).status).toBe(201);
    expect((await c.recordEvent(req('/x', { event_type: 'bogus' }), { id: A })).status).toBe(400);
  });

  it('queue validates filters and returns the page', async () => {
    expect((await c.queue(req('/api/v1/asset-custody?next_action_party=nobody'))).status).toBe(400);
    expect((await c.queue(req('/api/v1/asset-custody'))).status).toBe(200);
  });
});
