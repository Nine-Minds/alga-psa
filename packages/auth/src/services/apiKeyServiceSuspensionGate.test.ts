import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createTenantKnex: vi.fn(),
  isTenantSuspended: vi.fn(),
  apiKeyRow: null as Record<string, unknown> | null,
  userRow: null as Record<string, unknown> | null,
  updates: [] as Array<Record<string, unknown>>,
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: mocks.createTenantKnex,
  isTenantSuspended: mocks.isTenantSuspended,
  tenantDb: () => ({
    table: (table: string) => {
      const builder: any = {
        where: () => builder,
        whereNull: () => builder,
        orWhere: () => builder,
        first: async () => (table === 'api_keys' ? mocks.apiKeyRow : mocks.userRow),
        update: async (values: Record<string, unknown>) => {
          mocks.updates.push({ table, ...values });
          return 1;
        },
      };
      return builder;
    },
  }),
}));

import { ApiKeyService } from './apiKeyService';

describe('ApiKeyService validation gates', () => {
  const knex: any = () => undefined;
  knex.fn = { now: () => 'now()' };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updates.length = 0;
    mocks.createTenantKnex.mockResolvedValue({ knex, tenant: 'tenant-1' });
    mocks.isTenantSuspended.mockResolvedValue(false);
    mocks.apiKeyRow = {
      api_key_id: 'key-1',
      user_id: 'user-1',
      tenant: 'tenant-1',
      usage_limit: null,
      usage_count: 0,
    };
    mocks.userRow = { is_inactive: false };
  });

  it('T033: rejects an otherwise-valid key whose owning user is inactive', async () => {
    mocks.userRow = { is_inactive: true };

    await expect(ApiKeyService.validateApiKey('plain-key')).resolves.toBeNull();
    expect(mocks.updates).toEqual([]);
  });

  it('T033: treats a missing owning user as inactive', async () => {
    mocks.userRow = null;

    await expect(ApiKeyService.validateApiKey('plain-key')).resolves.toBeNull();
  });

  it('T034: rejects an otherwise-valid key whose tenant is suspended', async () => {
    mocks.isTenantSuspended.mockResolvedValue(true);

    await expect(ApiKeyService.validateApiKey('plain-key')).resolves.toBeNull();
    expect(mocks.isTenantSuspended).toHaveBeenCalledWith(knex, 'tenant-1');
    expect(mocks.updates).toEqual([]);
  });

  it('T035: accepts a valid key for an active user in a non-suspended tenant', async () => {
    const record = await ApiKeyService.validateApiKey('plain-key');

    expect(record).toMatchObject({ api_key_id: 'key-1', user_id: 'user-1' });
    expect(mocks.updates).toHaveLength(1);
  });
});
