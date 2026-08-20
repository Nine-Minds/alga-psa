import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getConnection: vi.fn(),
  isTenantSuspended: vi.fn(),
  apiKeyRow: null as Record<string, unknown> | null,
  userRow: null as Record<string, unknown> | null,
  updates: [] as Array<{ tenant: string; values: Record<string, unknown> }>,
}));

vi.mock('../../../lib/db/db', () => ({
  getConnection: mocks.getConnection,
}));

vi.mock('@alga-psa/db', () => ({
  isTenantSuspended: mocks.isTenantSuspended,
  tenantDb: (knex: any, tenant: string) => ({
    table: (table: string) => {
      const builder: any = {
        unscoped: () => builder,
        where: () => builder,
        whereNull: () => builder,
        orWhere: () => builder,
        first: async () => {
          if (table === 'users') return mocks.userRow;
          if (table === 'api_keys') return mocks.apiKeyRow;
          return null;
        },
        update: async (values: Record<string, unknown>) => {
          mocks.updates.push({ tenant, values });
          return 1;
        },
        increment: async () => [{ usage_count: 1, usage_limit: null }],
      };
      return builder;
    },
    unscoped: (_table: string) => {
      const builder: any = {
        where: () => builder,
        whereNull: () => builder,
        orWhere: () => builder,
        first: async () => mocks.apiKeyRow,
        update: async (values: Record<string, unknown>) => {
          mocks.updates.push({ tenant, values });
          return 1;
        },
      };
      return builder;
    },
  }),
}));

import { ApiKeyServiceForApi } from '../../../lib/services/apiKeyServiceForApi';

describe('ApiKeyServiceForApi client-owner rejection', () => {
  const knex: any = () => undefined;
  knex.fn = { now: () => 'now()' };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updates.length = 0;
    mocks.getConnection.mockResolvedValue(knex);
    mocks.isTenantSuspended.mockResolvedValue(false);
    mocks.apiKeyRow = {
      api_key_id: 'key-1',
      user_id: 'user-1',
      tenant: 'tenant-1',
      usage_limit: null,
      usage_count: 0,
    };
    mocks.userRow = { is_inactive: false, user_type: 'internal' };
  });

  it('rejects a client-owned key via validateApiKeyForTenant (with x-tenant-id)', async () => {
    mocks.userRow = { is_inactive: false, user_type: 'client' };

    await expect(ApiKeyServiceForApi.validateApiKeyForTenant('plain-key', 'tenant-1')).resolves.toBeNull();

    expect(mocks.updates).toEqual([
      { tenant: 'tenant-1', values: { active: false, updated_at: 'now()' } },
    ]);
    expect(mocks.updates.some((u) => 'last_used_at' in u.values)).toBe(false);
  });

  it('rejects a client-owned key via validateApiKeyAnyTenant (without x-tenant-id)', async () => {
    mocks.userRow = { is_inactive: false, user_type: 'client' };

    await expect(ApiKeyServiceForApi.validateApiKeyAnyTenant('plain-key')).resolves.toBeNull();

    expect(mocks.updates.some((u) => 'last_used_at' in u.values)).toBe(false);
    expect(mocks.updates.some((u) => u.values.active === false)).toBe(true);
  });

  it('accepts an internal-owned key via both paths and records use', async () => {
    const tenantKey = await ApiKeyServiceForApi.validateApiKeyForTenant('plain-key', 'tenant-1');
    expect(tenantKey).toMatchObject({ api_key_id: 'key-1' });
    expect(mocks.updates.some((u) => 'last_used_at' in u.values)).toBe(true);

    mocks.updates.length = 0;
    const anyTenantKey = await ApiKeyServiceForApi.validateApiKeyAnyTenant('plain-key');
    expect(anyTenantKey).toMatchObject({ api_key_id: 'key-1' });
    expect(mocks.updates.some((u) => 'last_used_at' in u.values)).toBe(true);
  });
});
