import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createTenantKnex: vi.fn(),
  isTenantSuspended: vi.fn(),
  apiKeyRow: null as Record<string, unknown> | null,
  userRow: null as Record<string, unknown> | null,
  insertedRow: null as Record<string, unknown> | null,
  updates: [] as Array<{ table: string; values: Record<string, unknown> }>,
  inserts: [] as Array<{ table: string; payload: Record<string, unknown> }>,
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
        insert: (payload: Record<string, unknown>) => {
          mocks.inserts.push({ table, payload });
          return builder;
        },
        returning: async () => [mocks.insertedRow],
        update: async (values: Record<string, unknown>) => {
          mocks.updates.push({ table, values });
          return 1;
        },
      };
      return builder;
    },
  }),
}));

import { ApiKeyService } from './apiKeyService';

describe('ApiKeyService service-owner rejection (F041: internal-owner-only)', () => {
  const knex: any = () => undefined;
  knex.fn = { now: () => 'now()' };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updates.length = 0;
    mocks.inserts.length = 0;
    mocks.createTenantKnex.mockResolvedValue({ knex, tenant: 'tenant-1' });
    mocks.isTenantSuspended.mockResolvedValue(false);
    mocks.apiKeyRow = {
      api_key_id: 'key-1',
      user_id: 'user-1',
      tenant: 'tenant-1',
      usage_limit: null,
      usage_count: 0,
    };
    mocks.insertedRow = null;
  });

  it.each(['general', 'mobile', 'mobile_ott', undefined])('refuses to mint a key for a service owner (purpose %s)', async (purpose) => {
    mocks.userRow = { is_inactive: false, user_type: 'service' };

    await expect(
      ApiKeyService.createApiKey('user-1', purpose ? { purpose } as never : undefined)
    ).rejects.toThrow('Failed to create API key for user user-1 in tenant tenant-1');
    expect(mocks.inserts).toEqual([]);
  });

  it('refuses an unknown or missing owner type', async () => {
    for (const row of [{ is_inactive: false, user_type: 'robot' }, { is_inactive: false, user_type: null }, null]) {
      mocks.userRow = row;
      await expect(ApiKeyService.createApiKey('user-1')).rejects.toThrow();
    }
    expect(mocks.inserts).toEqual([]);
  });
});
