import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  validateApiKeyAnyTenant: vi.fn(),
  getCurrentUser: vi.fn(),
  hasPermission: vi.fn(),
}));

vi.mock('@/lib/services/apiKeyServiceForApi', () => ({
  ApiKeyServiceForApi: {
    validateApiKeyAnyTenant: mocks.validateApiKeyAnyTenant,
  },
}));

vi.mock('@alga-psa/user-composition/actions', () => ({
  getCurrentUser: mocks.getCurrentUser,
}));

vi.mock('@alga-psa/auth', () => ({
  hasPermission: mocks.hasPermission,
}));

function requestWithHeaders(headers: Record<string, string>) {
  return {
    headers: new Headers(headers),
  } as never;
}

const MASTER = 'master-tenant';

const masterAdmin = {
  tenant: MASTER,
  user_id: 'master-user',
  email: 'master@example.test',
  user_type: 'internal',
};

async function loadGate() {
  return import('@ee/lib/auth/masterTenantAccess');
}

describe('assertMasterTenantAccess', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubEnv('MASTER_BILLING_TENANT_ID', MASTER);
    mocks.hasPermission.mockResolvedValue(true);
  });

  it('throws when MASTER_BILLING_TENANT_ID is not configured', async () => {
    vi.stubEnv('MASTER_BILLING_TENANT_ID', '');
    const { assertMasterTenantAccess } = await loadGate();

    await expect(assertMasterTenantAccess(requestWithHeaders({}))).rejects.toThrow(
      'MASTER_BILLING_TENANT_ID not configured',
    );
    expect(mocks.getCurrentUser).not.toHaveBeenCalled();
  });

  describe('x-internal-* headers (GHSA-v72r-pvf8-6cq2)', () => {
    it('never grants access from unauthenticated x-internal-* headers', async () => {
      mocks.validateApiKeyAnyTenant.mockResolvedValue(null);
      mocks.getCurrentUser.mockResolvedValue(null);
      const { assertMasterTenantAccess } = await loadGate();

      const forged = {
        'x-internal-request': 'ext-proxy-prefetch',
        'x-internal-user-id': 'attacker',
        'x-internal-user-tenant': MASTER,
        'x-internal-user-email': 'attacker@example.test',
      };

      await expect(assertMasterTenantAccess(requestWithHeaders(forged))).rejects.toThrow('Authentication required');
      await expect(
        assertMasterTenantAccess(requestWithHeaders({ ...forged, 'x-api-key': 'anything' })),
      ).rejects.toThrow('Access denied: invalid API key');
    });
  });

  describe('API key path', () => {
    it('rejects an invalid API key without falling back to session authentication', async () => {
      mocks.validateApiKeyAnyTenant.mockResolvedValue(null);
      mocks.getCurrentUser.mockResolvedValue(masterAdmin);
      const { assertMasterTenantAccess } = await loadGate();

      await expect(assertMasterTenantAccess(requestWithHeaders({ 'x-api-key': 'junk' }))).rejects.toThrow(
        'Access denied: invalid API key',
      );
      expect(mocks.getCurrentUser).not.toHaveBeenCalled();
    });

    it('rejects a valid API key from a non-master tenant', async () => {
      mocks.validateApiKeyAnyTenant.mockResolvedValue({ tenant: 'other-tenant', user_id: 'other-user' });
      const { assertMasterTenantAccess } = await loadGate();

      await expect(assertMasterTenantAccess(requestWithHeaders({ 'x-api-key': 'valid' }))).rejects.toThrow(
        'Access denied: master tenant required',
      );
      expect(mocks.getCurrentUser).not.toHaveBeenCalled();
    });

    it('accepts a master-tenant API key and takes the acting operator from runner headers', async () => {
      mocks.validateApiKeyAnyTenant.mockResolvedValue({ tenant: MASTER, user_id: 'key-owner' });
      const { assertMasterTenantAccess } = await loadGate();

      await expect(
        assertMasterTenantAccess(
          requestWithHeaders({ 'x-api-key': 'valid', 'x-user-id': 'operator', 'x-user-email': 'op@example.test' }),
        ),
      ).resolves.toEqual({ tenantId: MASTER, userId: 'operator', userEmail: 'op@example.test' });

      await expect(
        assertMasterTenantAccess(requestWithHeaders({ 'x-api-key': 'valid', 'x-alga-extension': 'ext-1' })),
      ).resolves.toEqual({ tenantId: MASTER, userId: 'extension:ext-1', userEmail: undefined });

      await expect(assertMasterTenantAccess(requestWithHeaders({ 'x-api-key': 'valid' }))).resolves.toEqual({
        tenantId: MASTER,
        userId: 'key-owner',
        userEmail: undefined,
      });
    });
  });

  describe('session path', () => {
    it('rejects an anonymous request', async () => {
      mocks.getCurrentUser.mockResolvedValue(null);
      const { assertMasterTenantAccess } = await loadGate();

      await expect(assertMasterTenantAccess(requestWithHeaders({}))).rejects.toThrow('Authentication required');
    });

    it('rejects a user from another tenant', async () => {
      mocks.getCurrentUser.mockResolvedValue({ ...masterAdmin, tenant: 'other-tenant' });
      const { assertMasterTenantAccess } = await loadGate();

      await expect(assertMasterTenantAccess(requestWithHeaders({}))).rejects.toThrow(
        'Access denied: master tenant required',
      );
      expect(mocks.hasPermission).not.toHaveBeenCalled();
    });

    it('rejects a client-portal user of the master tenant', async () => {
      mocks.getCurrentUser.mockResolvedValue({ ...masterAdmin, user_type: 'client' });
      const { assertMasterTenantAccess } = await loadGate();

      await expect(assertMasterTenantAccess(requestWithHeaders({}))).rejects.toThrow(
        'Access denied: master tenant required',
      );
      expect(mocks.hasPermission).not.toHaveBeenCalled();
    });

    it('rejects a master-tenant internal user without the tenant-management permission', async () => {
      mocks.getCurrentUser.mockResolvedValue(masterAdmin);
      mocks.hasPermission.mockResolvedValue(false);
      const { assertMasterTenantAccess, TENANT_MANAGEMENT_PERMISSION } = await loadGate();

      await expect(assertMasterTenantAccess(requestWithHeaders({}))).rejects.toThrow(
        'Access denied: tenant management permission required',
      );
      expect(mocks.hasPermission).toHaveBeenCalledWith(
        masterAdmin,
        TENANT_MANAGEMENT_PERMISSION.resource,
        TENANT_MANAGEMENT_PERMISSION.action,
      );
    });

    it('allows a permitted internal user of the master tenant', async () => {
      mocks.getCurrentUser.mockResolvedValue(masterAdmin);
      const { assertMasterTenantAccess } = await loadGate();

      await expect(assertMasterTenantAccess(requestWithHeaders({}))).resolves.toEqual({
        tenantId: MASTER,
        userId: 'master-user',
        userEmail: 'master@example.test',
      });
    });
  });

  describe('isMasterTenantAuthError', () => {
    it('classifies gate failures and nothing else', async () => {
      const { isMasterTenantAuthError, MASTER_TENANT_ERRORS } = await loadGate();

      for (const message of [
        MASTER_TENANT_ERRORS.invalidApiKey,
        MASTER_TENANT_ERRORS.unauthenticated,
        MASTER_TENANT_ERRORS.wrongTenant,
        MASTER_TENANT_ERRORS.missingPermission,
      ]) {
        expect(isMasterTenantAuthError(new Error(message))).toBe(true);
      }
      expect(isMasterTenantAuthError(new Error(MASTER_TENANT_ERRORS.notConfigured))).toBe(false);
      expect(isMasterTenantAuthError(new Error('boom'))).toBe(false);
      expect(isMasterTenantAuthError('Access denied')).toBe(false);
    });
  });
});
