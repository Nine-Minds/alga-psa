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

describe('ApiKeyService client-owner rejection', () => {
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
    mocks.insertedRow = {
      api_key_id: 'key-1',
      user_id: 'user-1',
      tenant: 'tenant-1',
      api_key: 'hashed',
      description: null,
      active: true,
      created_at: new Date(),
      updated_at: new Date(),
      last_used_at: null,
      expires_at: null,
      purpose: 'general',
      metadata: null,
      usage_limit: null,
      usage_count: 0,
    };
  });

  describe('createApiKey owner gate', () => {
    it('refuses to mint a key for a client owner', async () => {
      mocks.userRow = { is_inactive: false, user_type: 'client' };

      await expect(ApiKeyService.createApiKey('user-1')).rejects.toThrow(
        'Failed to create API key for user user-1 in tenant tenant-1'
      );
      expect(mocks.inserts).toEqual([]);
    });

    it('refuses to mint a key for an inactive owner', async () => {
      mocks.userRow = { is_inactive: true, user_type: 'internal' };

      await expect(ApiKeyService.createApiKey('user-1')).rejects.toThrow();
      expect(mocks.inserts).toEqual([]);
    });

    it('mints a key for an active internal owner, preserving purpose/metadata', async () => {
      mocks.userRow = { is_inactive: false, user_type: 'internal' };

      const record = await ApiKeyService.createApiKey('user-1', 'mobile', new Date('2030-01-01'), {
        purpose: 'mobile_session',
        metadata: { device: 'test' },
        usageLimit: 5,
      });

      expect(mocks.inserts).toHaveLength(1);
      expect(mocks.inserts[0].payload).toMatchObject({
        user_id: 'user-1',
        tenant: 'tenant-1',
        purpose: 'mobile_session',
        metadata: { device: 'test' },
        usage_limit: 5,
        usage_count: 0,
      });
      expect(record.api_key).toBeTruthy();
    });
  });

  describe('validateApiKey client-owner gate', () => {
    it('rejects a client-owned key and lazily deactivates it without recording use', async () => {
      mocks.userRow = { is_inactive: false, user_type: 'client' };

      await expect(ApiKeyService.validateApiKey('plain-key')).resolves.toBeNull();

      // Only the lazy deactivation update is recorded — no last_used_at touch.
      expect(mocks.updates).toEqual([
        { table: 'api_keys', values: { active: false, updated_at: 'now()' } },
      ]);
      expect(mocks.updates.some((u) => 'last_used_at' in u.values)).toBe(false);
    });

    it('accepts an internal-owned key and records use', async () => {
      mocks.userRow = { is_inactive: false, user_type: 'internal' };

      const record = await ApiKeyService.validateApiKey('plain-key');

      expect(record).toMatchObject({ api_key_id: 'key-1', user_id: 'user-1' });
      expect(mocks.updates).toHaveLength(1);
      expect(mocks.updates[0].values).toHaveProperty('last_used_at');
    });

    it('rejects a client-owned mobile_session key identically', async () => {
      mocks.apiKeyRow = { ...mocks.apiKeyRow, purpose: 'mobile_session' };
      mocks.userRow = { is_inactive: false, user_type: 'client' };

      await expect(ApiKeyService.validateApiKey('plain-key')).resolves.toBeNull();
      expect(mocks.updates.some((u) => 'last_used_at' in u.values)).toBe(false);
    });

    it('rejects an inactive owner without deactivating the key', async () => {
      mocks.userRow = { is_inactive: true, user_type: 'internal' };

      await expect(ApiKeyService.validateApiKey('plain-key')).resolves.toBeNull();
      expect(mocks.updates).toEqual([]);
    });
  });
});
