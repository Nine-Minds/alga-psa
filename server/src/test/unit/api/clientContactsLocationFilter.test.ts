import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * T071 (client-scoped half): GET /api/v1/clients/{id}/contacts honours the documented
 * `location_id` and `work_arrangement` filters, and the client in the path always wins — a
 * `client_id` in the query string cannot widen the scope.
 */

const TENANT = '11111111-1111-1111-1111-111111111111';
const CLIENT = '22222222-2222-2222-2222-222222222222';
const OTHER_CLIENT = '33333333-3333-3333-3333-333333333333';
const LOCATION = '44444444-4444-4444-4444-444444444444';

const state = vi.hoisted(() => ({
  client: null as Record<string, unknown> | null,
  listCalls: [] as Array<Record<string, unknown>>,
}));

vi.mock('@/lib/services/apiKeyServiceForApi', () => ({
  ApiKeyServiceForApi: {
    validateApiKeyAnyTenant: vi.fn(async () => ({ tenant: TENANT, user_id: 'user-1', api_key_id: 'key-1' })),
    validateApiKeyForTenant: vi.fn(async () => ({ tenant: TENANT, user_id: 'user-1', api_key_id: 'key-1' })),
  },
}));

vi.mock('@alga-psa/users/actions', () => ({
  findUserByIdForApi: vi.fn(async () => ({ user_id: 'user-1', user_type: 'internal', tenant: TENANT })),
}));

vi.mock('@/lib/db', () => ({
  runWithTenant: vi.fn(async (_tenant: string, callback: () => Promise<any>) => callback()),
  runWithApiKeyUser: vi.fn(async (_user: unknown, callback: () => Promise<any>) => callback()),
}));

vi.mock('@/lib/db/db', () => ({ getConnection: vi.fn(async () => ({})) }));

vi.mock('@/lib/auth/rbac', () => ({ hasPermission: vi.fn(async () => true) }));

vi.mock('@/lib/api/rateLimit/enforce', () => ({
  enforceApiRateLimit: vi.fn(async () => null),
  shouldBypassRateLimit: vi.fn(() => false),
}));

vi.mock('@/lib/productAccess', () => ({ getTenantProduct: vi.fn(async () => 'psa') }));
vi.mock('@/lib/productSurfaceRegistry', () => ({ resolveProductApiBehavior: vi.fn(() => 'allowed') }));

vi.mock('@/lib/api/services/ClientService', () => ({
  ClientService: class {
    async getById() {
      return state.client;
    }
  },
}));

vi.mock('@/lib/api/services/ContactService', () => ({
  ContactService: class {
    async list(params: Record<string, unknown>) {
      state.listCalls.push(params);
      return { data: [], total: 0 };
    }
  },
}));

const { GET } = await import('../../../app/api/v1/clients/[id]/contacts/route');

const request = (query = '') =>
  new NextRequest(`http://localhost/api/v1/clients/${CLIENT}/contacts${query}`, {
    headers: { 'x-api-key': 'test-api-key' },
  });

describe('GET /api/v1/clients/{id}/contacts filters', () => {
  beforeEach(() => {
    state.client = { client_id: CLIENT };
    state.listCalls = [];
  });

  it('passes location_id and work_arrangement through to the contact list', async () => {
    const res = await GET(request(`?location_id=${LOCATION}&work_arrangement=remote`));
    expect(res.status).toBe(200);
    expect(state.listCalls[0].filters).toEqual({
      client_id: CLIENT,
      location_id: LOCATION,
      work_arrangement: 'remote',
    });
  });

  it('keeps the client of the path even when the query names another', async () => {
    await GET(request(`?client_id=${OTHER_CLIENT}&work_arrangement=on_site`));
    expect(state.listCalls[0].filters).toEqual({ client_id: CLIENT, work_arrangement: 'on_site' });
  });

  it('filters nothing extra when no filter is given', async () => {
    await GET(request('?page=2&limit=10'));
    expect(state.listCalls[0]).toMatchObject({ page: 2, limit: 10, filters: { client_id: CLIENT } });
  });

  it('rejects a malformed filter rather than ignoring it', async () => {
    const res = await GET(request('?location_id=not-a-uuid'));
    expect(res.status).toBe(400);
  });
});
