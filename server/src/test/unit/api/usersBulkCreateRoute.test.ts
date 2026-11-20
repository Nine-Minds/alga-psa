import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * POST /api/v1/users/bulk/create used to delegate to the single-user create(),
 * so a documented bulk payload was rejected and send_welcome_email /
 * force_password_reset were never read. The route now parses
 * bulkCreateUsersSchema and hands the options to the service.
 */

const TENANT = '11111111-1111-1111-1111-111111111111';
const ROLE = '22222222-2222-2222-2222-222222222222';

const state = vi.hoisted(() => ({
  bulkCalls: [] as Array<{ users: unknown[]; options: Record<string, unknown> }>,
  createCalls: 0,
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

vi.mock('@alga-psa/users', () => ({
  UserService: class {
    async bulkCreateUsers(users: unknown[], _context: unknown, options: Record<string, unknown>) {
      state.bulkCalls.push({ users, options });
      return { total_processed: users.length, successful: users.length, failed: 0, errors: [], results: [] };
    }

    async create() {
      state.createCalls += 1;
      return {};
    }
  },
}));

const { POST } = await import('../../../app/api/v1/users/bulk/create/route');

const request = (body: unknown) =>
  new NextRequest('http://localhost/api/v1/users/bulk/create', {
    method: 'POST',
    headers: { 'x-api-key': 'test-api-key', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

const user = (email: string) => ({
  username: email,
  email,
  password: 'Str0ngPassw0rd!',
  first_name: 'Bulk',
  last_name: 'User',
  role_ids: [ROLE],
});

beforeEach(() => {
  state.bulkCalls = [];
  state.createCalls = 0;
});

describe('POST /api/v1/users/bulk/create', () => {
  it('creates the whole batch through bulkCreateUsers, not the single create', async () => {
    const res = await POST(request({ users: [user('a@acme.test'), user('b@acme.test')] }));
    expect(res.status).toBe(201);
    expect(state.createCalls).toBe(0);
    expect(state.bulkCalls).toHaveLength(1);
    expect(state.bulkCalls[0].users).toHaveLength(2);

    const body = await res.json();
    expect(body.data).toMatchObject({ total_processed: 2, successful: 2, failed: 0 });
  });

  it('applies the documented option defaults when options are omitted', async () => {
    await POST(request({ users: [user('a@acme.test')] }));
    expect(state.bulkCalls[0].options).toEqual({
      send_welcome_email: true,
      force_password_reset: false,
      skip_invalid: true,
      dry_run: false,
    });
  });

  it('passes the caller\'s options through', async () => {
    await POST(request({
      users: [user('a@acme.test')],
      options: { send_welcome_email: false, force_password_reset: true },
    }));
    expect(state.bulkCalls[0].options).toMatchObject({
      send_welcome_email: false,
      force_password_reset: true,
      skip_invalid: true,
      dry_run: false,
    });
  });

  it('rejects an empty batch', async () => {
    const res = await POST(request({ users: [] }));
    expect(res.status).toBe(400);
    expect(state.bulkCalls).toHaveLength(0);
  });
});
