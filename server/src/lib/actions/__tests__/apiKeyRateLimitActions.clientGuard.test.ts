import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getUserRoles: vi.fn(),
  getApiRateLimitSettingsRow: vi.fn(),
  resolveApiRateLimitConfig: vi.fn(),
  getApiRateLimitSettingsRows: vi.fn(),
  upsertForKey: vi.fn(),
  upsertForTenant: vi.fn(),
  clearForKey: vi.fn(),
  bucketState: vi.fn(),
}));

vi.mock('@alga-psa/auth/actions', () => ({
  getUserRoles: mocks.getUserRoles,
}));

vi.mock('@alga-psa/auth/withAuth', () => ({
  withAuth: (action: any) => action,
}));

vi.mock('@alga-psa/ui/lib/errorHandling', () => ({
  permissionError: (message: string) => ({ permissionError: message }),
  actionError: (message: string) => ({ actionError: message }),
}));

vi.mock('@alga-psa/core/rateLimit', () => ({
  TokenBucketRateLimiter: {
    getInstance: () => ({
      getState: () => mocks.bucketState(),
    }),
  },
}));

vi.mock('@/lib/api/rateLimit/apiRateLimitSettingsModel', () => ({
  DEFAULT_API_RATE_LIMIT_CONFIG: { maxTokens: 100, refillRate: 1 },
  DEFAULT_API_RATE_LIMIT_SETTINGS: { maxTokens: 100, refillPerMin: 60 },
  getForKey: mocks.getApiRateLimitSettingsRow,
  getForKeys: mocks.getApiRateLimitSettingsRows,
  resolveApiRateLimitConfig: mocks.resolveApiRateLimitConfig,
  upsertForKey: mocks.upsertForKey,
  upsertForTenant: mocks.upsertForTenant,
  clearForKey: mocks.clearForKey,
}));

vi.mock('@/lib/api/rateLimit/apiRateLimitConfigGetter', () => ({
  invalidateApiRateLimitConfig: vi.fn(),
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => ({
    knex: { fn: { now: () => 'now()' } },
    tenant: 'tenant-1',
  })),
  tenantDb: () => ({
    table: () => ({
      select: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      whereIn: vi.fn().mockReturnThis(),
      first: vi.fn().mockResolvedValue({ api_key_id: 'key-1' }),
    }),
  }),
}));

import {
  clearApiRateLimitForKey,
  getApiRateLimitForKey,
  getApiRateLimitsForKeys,
  setApiRateLimitForKey,
  setTenantDefaultApiRateLimit,
} from '../apiKeyRateLimitActions';

// withAuth is mocked to return the raw action; the real wrapper type only
// accepts the trailing args, so the actions are invoked through a raw alias.
type RawAction = (user: any, ctx: any, ...args: any[]) => Promise<any>;
const rawGetFor = getApiRateLimitForKey as unknown as RawAction;
const rawGetMany = getApiRateLimitsForKeys as unknown as RawAction;
const rawSetFor = setApiRateLimitForKey as unknown as RawAction;
const rawSetTenant = setTenantDefaultApiRateLimit as unknown as RawAction;
const rawClear = clearApiRateLimitForKey as unknown as RawAction;

const clientUser = {
  user_id: 'client-user-1',
  user_type: 'client',
  tenant: 'tenant-1',
  email: 'client@example.com',
  is_inactive: false,
};

const internalAdminUser = {
  user_id: 'internal-admin-1',
  user_type: 'internal',
  tenant: 'tenant-1',
  email: 'admin@example.com',
  is_inactive: false,
};

const ctx = { tenant: 'tenant-1' };

describe('apiKeyRateLimitActions internal-user guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getUserRoles.mockResolvedValue([
      { role_id: 'role-admin', role_name: 'Admin', msp: true, client: false },
    ]);
    mocks.bucketState.mockResolvedValue(null);
    mocks.resolveApiRateLimitConfig.mockResolvedValue({ maxTokens: 100, refillRate: 1 });
    mocks.getApiRateLimitSettingsRow.mockResolvedValue(null);
    mocks.getApiRateLimitSettingsRows.mockResolvedValue({ overrides: new Map(), tenantDefault: null });
  });

  it('denies a client user on every rate-limit settings action before admin/key lookups', async () => {
    const getOne = await rawGetFor(clientUser, ctx, 'key-1');
    expect(getOne).toMatchObject({ permissionError: expect.any(String) });
    expect(mocks.getUserRoles).not.toHaveBeenCalled();

    const getMany = await rawGetMany(clientUser, ctx, ['key-1']);
    expect(getMany).toMatchObject({ permissionError: expect.any(String) });

    const setOne = await rawSetFor(clientUser, ctx, 'key-1', { maxTokens: 10, refillPerMin: 1 });
    expect(setOne).toMatchObject({ permissionError: expect.any(String) });

    const setTenant = await rawSetTenant(clientUser, ctx, { maxTokens: 10, refillPerMin: 1 });
    expect(setTenant).toMatchObject({ permissionError: expect.any(String) });

    const clear = await rawClear(clientUser, ctx, 'key-1');
    expect(clear).toMatchObject({ permissionError: expect.any(String) });

    expect(mocks.getUserRoles).not.toHaveBeenCalled();
  });

  it('keeps internal admin behavior for read actions', async () => {
    const result = await rawGetFor(internalAdminUser, ctx, 'key-1');
    expect(mocks.getUserRoles).toHaveBeenCalledWith('internal-admin-1');
    expect(result).toMatchObject({ apiKeyId: 'key-1', source: 'default' });
  });
});
