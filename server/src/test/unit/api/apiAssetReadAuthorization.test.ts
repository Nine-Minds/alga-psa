import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * C3 (alga-2026-0002683) asset read authorization on REST.
 * Order: product gate -> asset:read (403) -> load -> record-level check (404,
 * identical to "missing"). Applied to getById and the sub-resources that the
 * mobile AssetDetailScreen calls.
 */

const state = vi.hoisted(() => ({
  rbacAllowed: true,
  record: null as unknown,
  recordLevelAllowed: true,
  calls: [] as string[],
}));

vi.mock('@/lib/api/services/AssetService', () => ({
  AssetService: class {
    async getAuthorizationRecord(id: string, context: { tenant: string }) {
      state.calls.push(`load:${context.tenant}:${id}`);
      return state.record;
    }
    async getWithDetails(id: string) {
      state.calls.push('getWithDetails');
      return { asset_id: id, name: 'Secret laptop' };
    }
    async getMaintenanceSchedules() {
      state.calls.push('getMaintenanceSchedules');
      return [{ schedule_id: 's1' }];
    }
    async getMaintenanceHistory() {
      state.calls.push('getMaintenanceHistory');
      return [{ history_id: 'h1' }];
    }
    async getAssetTickets() {
      state.calls.push('getAssetTickets');
      return [{ ticket_id: 't1' }];
    }
  },
}));

vi.mock('@/lib/productAccess', () => ({
  getTenantProduct: vi.fn(async () => 'psa'),
  ProductAccessError: class ProductAccessError extends Error {},
}));

vi.mock('@/lib/auth/rbac', () => ({
  hasPermission: vi.fn(async () => {
    state.calls.push('rbac');
    return state.rbacAllowed;
  }),
}));

vi.mock('@/lib/db/db', () => ({ getConnection: vi.fn(async () => ({})) }));

vi.mock('@/lib/api/controllers/authorizationKernel', () => ({
  authorizeApiResourceRead: vi.fn(async () => {
    state.calls.push('record-level');
    return state.recordLevelAllowed;
  }),
}));

const { ApiAssetController } = await import('@/lib/api/controllers/ApiAssetController');
const { setRequestContext } = await import('@/lib/api/utils/requestContext');

const TENANT = '11111111-1111-1111-1111-111111111111';
const ASSET = '22222222-2222-2222-2222-222222222222';

function request(suffix = ''): NextRequest {
  const req = new NextRequest(`http://localhost/api/v1/assets/${ASSET}${suffix}`);
  setRequestContext(req, {
    tenant: TENANT,
    user: { user_id: 'user-1', tenant: TENANT, user_type: 'internal' },
  } as any);
  return req;
}

async function errorBody(res: Response) {
  const body = await res.json();
  return { status: res.status, error: body.error };
}

beforeEach(() => {
  state.rbacAllowed = true;
  state.record = { id: ASSET, clientId: 'c1' };
  state.recordLevelAllowed = true;
  state.calls = [];
});

const endpoints: Array<[string, string, (c: InstanceType<typeof ApiAssetController>, r: NextRequest) => Promise<Response>]> = [
  ['getById', '', (c, r) => c.getById(r, { id: ASSET })],
  ['maintenance', '/maintenance', (c, r) => c.listMaintenanceSchedules(r, { id: ASSET })],
  ['history', '/history', (c, r) => c.getMaintenanceHistory(r, { id: ASSET })],
  ['tickets', '/tickets', (c, r) => c.listTickets(r, { id: ASSET })],
];

describe.each(endpoints)('asset read authorization: %s', (_name, suffix, call) => {
  it('allows a permitted caller', async () => {
    const res = await call(new ApiAssetController(), request(suffix));
    expect(res.status).toBe(200);
  });

  it('403s without asset:read, before loading the record', async () => {
    state.rbacAllowed = false;
    const res = await call(new ApiAssetController(), request(suffix));
    expect(res.status).toBe(403);
    expect(state.calls.some((c) => c.startsWith('load'))).toBe(false);
  });

  it('404s on record-level denial with the same error as a missing record, and reads nothing', async () => {
    state.record = null;
    const missing = await errorBody(await call(new ApiAssetController(), request(suffix)));

    state.record = { id: ASSET, clientId: 'c1' };
    state.recordLevelAllowed = false;
    state.calls = [];
    const denied = await errorBody(await call(new ApiAssetController(), request(suffix)));

    expect(missing.status).toBe(404);
    expect(denied).toEqual(missing);
    expect(state.calls).not.toContain('getWithDetails');
    expect(state.calls).not.toContain('getMaintenanceSchedules');
    expect(state.calls).not.toContain('getMaintenanceHistory');
    expect(state.calls).not.toContain('getAssetTickets');
  });

  it('runs rbac, then load, then the record-level check, in that order', async () => {
    await call(new ApiAssetController(), request(suffix));
    const order = state.calls.filter((c) => c === 'rbac' || c.startsWith('load') || c === 'record-level');
    expect(order[0]).toBe('rbac');
    expect(order.indexOf('record-level')).toBeGreaterThan(order.findIndex((c) => c.startsWith('load')));
  });

  it("scopes the load to the caller's tenant (another tenant's id is a 404)", async () => {
    state.record = null; // tenant-scoped loader finds nothing for a foreign id
    const res = await call(new ApiAssetController(), request(suffix));
    expect(res.status).toBe(404);
    expect(state.calls).toContain(`load:${TENANT}:${ASSET}`);
  });
});
