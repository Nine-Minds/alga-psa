import { beforeEach, describe, expect, it, vi } from 'vitest';

// A seat principal holds no API credentials (S12 F030): none can be issued, and one that exists (it predates
// the user becoming a seat technician) authenticates nothing on REST.

const mocks = vi.hoisted(() => ({
  getConnection: vi.fn(),
  isTenantSuspended: vi.fn(),
  mayHoldApiCredentials: vi.fn(),
  apiKeyRow: null as Record<string, unknown> | null,
  userRow: null as Record<string, unknown> | null,
  inserts: [] as Array<Record<string, unknown>>,
  buildContext: vi.fn(),
  enforceRateLimit: vi.fn(),
}));

vi.mock('../../../lib/db/db', () => ({ getConnection: mocks.getConnection }));
vi.mock('@alga-psa/authorization/subject/principalKind', async (importOriginal) => ({
  ...(await importOriginal() as typeof import('@alga-psa/authorization/subject/principalKind')),
  principalMemberColumns: () => [],
  mayHoldApiCredentials: (...args: unknown[]) => mocks.mayHoldApiCredentials(...args),
}));
vi.mock('@alga-psa/db', () => ({
  isTenantSuspended: mocks.isTenantSuspended,
  createTenantKnex: async () => ({ knex: { fn: { now: () => 'now()' } }, tenant: 'tenant-1' }),
  getAdminConnection: async () => ({}),
  tenantDb: (_knex: unknown, _tenant: string) => {
    const table = (name: string) => {
      const builder: any = {
        unscoped: () => builder,
        where: () => builder,
        whereNull: () => builder,
        orWhere: () => builder,
        first: async () => (name === 'users' ? mocks.userRow : mocks.apiKeyRow),
        insert: (row: Record<string, unknown>) => {
          mocks.inserts.push(row);
          return { returning: async () => [row] };
        },
        update: async () => 1,
      };
      return builder;
    };
    return { table, unscoped: (name: string) => table(name) };
  },
}));
vi.mock('@alga-psa/licensing/lifecycle', () => ({
  coManagedAcceptancePendingError: () => new Error('pending'),
  isCoManagedAwaitingAcceptanceLazily: async () => false,
  isCoManagedLifecycleError: () => false,
}));
vi.mock('../../../lib/api/middleware/apiMiddleware', async () => {
  class UnauthorizedError extends Error {}
  return {
    UnauthorizedError,
    buildAuthenticatedApiContext: (...args: unknown[]) => mocks.buildContext(...args),
    handleApiError: (error: Error) => ({ status: error instanceof UnauthorizedError ? 401 : 500, error }),
  };
});
vi.mock('../../../lib/api/rateLimit/enforce', () => ({ enforceApiRateLimit: (...args: unknown[]) => mocks.enforceRateLimit(...args) }));
vi.mock('@alga-psa/auth', async () => ({
  runWithApiKeyUser: (_user: unknown, fn: () => unknown) => fn(),
  shouldTouchApiKeyLastUsed: () => false,
}));
vi.mock('../../../lib/db', () => ({ runWithTenant: (_t: string, fn: () => unknown) => fn() }));
vi.mock('@/lib/productAccess', () => ({ getTenantProduct: async () => 'psa', ProductAccessError: class extends Error {} }));

import { ApiKeyService } from '../../../../../packages/auth/src/services/apiKeyService';
import { ApiKeyServiceForApi } from '../../../lib/services/apiKeyServiceForApi';
import { authenticateApiKeyRequest, withApiKeyAuth } from '../../../lib/api/middleware/apiAuthMiddleware';
import { NextRequest } from 'next/server';

const request = () => new NextRequest('http://localhost/api/v1/tickets', { headers: { 'x-api-key': 'plain-key', 'x-tenant-id': 'tenant-1' } });

describe('a seat principal holds no API credentials (S12 F030)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.inserts.length = 0;
    mocks.getConnection.mockResolvedValue({ fn: { now: () => 'now()' } });
    mocks.isTenantSuspended.mockResolvedValue(false);
    mocks.apiKeyRow = { api_key_id: 'key-1', user_id: 'user-1', tenant: 'tenant-1', usage_limit: null, usage_count: 0 };
    mocks.userRow = { is_inactive: false, user_type: 'internal' };
    mocks.mayHoldApiCredentials.mockResolvedValue(true);
    mocks.buildContext.mockResolvedValue({ tenant: 'tenant-1', user: { user_id: 'user-1' } });
  });

  describe('issuance', () => {
    it('refuses to create a key for a seat principal, for every purpose, and writes nothing', async () => {
      mocks.mayHoldApiCredentials.mockResolvedValue(false);

      for (const options of [{ tenantId: 'tenant-1' }, { tenantId: 'tenant-1', purpose: 'mcp_user' }, { tenantId: 'tenant-1', purpose: 'mobile_session' }]) {
        await expect(ApiKeyService.createApiKey('user-1', 'k', undefined, options)).rejects.toMatchObject({ code: 'API_CREDENTIALS_REFUSED' });
      }
      expect(mocks.inserts).toEqual([]);
    });

    it('asks about the key owner in the key tenant', async () => {
      mocks.mayHoldApiCredentials.mockResolvedValue(false);
      await expect(ApiKeyService.createApiKey('user-1')).rejects.toBeDefined();
      expect(mocks.mayHoldApiCredentials).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ tenant: 'tenant-1', userId: 'user-1' }));
    });

    it('still issues a key for an ordinary internal user', async () => {
      const key = await ApiKeyService.createApiKey('user-1', 'k', undefined, { tenantId: 'tenant-1' });
      expect(key.user_id).toBe('user-1');
      expect(mocks.inserts).toHaveLength(1);
    });
  });

  describe('validation of a key that already exists', () => {
    it('rejects it in both validators when its owner is now a seat principal', async () => {
      mocks.mayHoldApiCredentials.mockResolvedValue(false);

      await expect(ApiKeyServiceForApi.validateApiKeyForTenant('plain-key', 'tenant-1')).resolves.toBeNull();
      await expect(ApiKeyServiceForApi.validateApiKeyAnyTenant('plain-key')).resolves.toBeNull();
      await expect(ApiKeyService.validateApiKey('plain-key', 'tenant-1')).resolves.toBeNull();
    });

    it('accepts it for an ordinary owner', async () => {
      await expect(ApiKeyServiceForApi.validateApiKeyForTenant('plain-key', 'tenant-1')).resolves.toMatchObject({ api_key_id: 'key-1' });
      await expect(ApiKeyServiceForApi.validateApiKeyAnyTenant('plain-key')).resolves.toMatchObject({ api_key_id: 'key-1' });
      await expect(ApiKeyService.validateApiKey('plain-key', 'tenant-1')).resolves.toMatchObject({ api_key_id: 'key-1' });
    });
  });

  describe('REST authentication', () => {
    it('authenticateApiKeyRequest refuses a key whose owner is a seat principal', async () => {
      mocks.mayHoldApiCredentials.mockResolvedValue(false);

      await expect(authenticateApiKeyRequest(request())).rejects.toThrow('Invalid API key');
      expect(mocks.buildContext).not.toHaveBeenCalled();
    });

    it('withApiKeyAuth never runs the handler for a seat principal', async () => {
      mocks.mayHoldApiCredentials.mockResolvedValue(false);
      const handler = vi.fn();

      const response: any = await (await withApiKeyAuth(handler))(request());

      expect(response.status).toBe(401);
      expect(handler).not.toHaveBeenCalled();
    });

    it('authenticates an ordinary principal', async () => {
      const apiRequest = await authenticateApiKeyRequest(request());
      expect(apiRequest.context).toMatchObject({ tenant: 'tenant-1' });
    });
  });
});
