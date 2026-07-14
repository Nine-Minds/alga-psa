import { beforeEach, describe, expect, it, vi } from 'vitest';

const tenantSecrets = new Map<string, string>();
const appSecrets = new Map<string, string>();

const getTenantSecretMock = vi.fn(async (tenant: string, key: string) => {
  return tenantSecrets.get(`${tenant}:${key}`) || null;
});
const getAppSecretMock = vi.fn(async (key: string) => appSecrets.get(key) || null);

vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: async () => ({
    getTenantSecret: getTenantSecretMock,
    getAppSecret: getAppSecretMock
  })
}));

import { getDefaultXeroTenantId, resolveXeroOAuthCredentials } from './xeroClientService';

describe('Xero OAuth credential resolution', () => {
  beforeEach(() => {
    tenantSecrets.clear();
    appSecrets.clear();
    vi.clearAllMocks();
  });

  it('T011: prefers tenant-owned credentials when both tenant and app fallback credentials exist', async () => {
    tenantSecrets.set('tenant-1:xero_client_id', 'tenant-client-id');
    tenantSecrets.set('tenant-1:xero_client_secret', 'tenant-client-secret');
    appSecrets.set('xero_client_id', 'app-client-id');
    appSecrets.set('xero_client_secret', 'app-client-secret');

    await expect(resolveXeroOAuthCredentials('tenant-1')).resolves.toEqual({
      clientId: 'tenant-client-id',
      clientSecret: 'tenant-client-secret',
      source: 'tenant'
    });
  });

  it('T014: falls back to app-level credentials only when tenant-owned credentials are absent', async () => {
    appSecrets.set('xero_client_id', 'app-client-id');
    appSecrets.set('xero_client_secret', 'app-client-secret');

    await expect(resolveXeroOAuthCredentials('tenant-1')).resolves.toEqual({
      clientId: 'app-client-id',
      clientSecret: 'app-client-secret',
      source: 'app'
    });
  });

  it('rejects partially-configured tenant credentials instead of mixing sources', async () => {
    tenantSecrets.set('tenant-1:xero_client_id', 'tenant-client-id');
    appSecrets.set('xero_client_id', 'app-client-id');
    appSecrets.set('xero_client_secret', 'app-client-secret');

    await expect(resolveXeroOAuthCredentials('tenant-1')).rejects.toThrow(
      'Xero client ID and client secret must both be configured for this tenant before connecting.'
    );
  });
});

describe('getDefaultXeroTenantId', () => {
  beforeEach(() => {
    tenantSecrets.clear();
    appSecrets.clear();
    vi.clearAllMocks();
  });

  it('returns the Xero organisation tenant id from the first stored connection', async () => {
    tenantSecrets.set('tenant-1:xero_credentials', JSON.stringify({
      'connection-1': {
        connectionId: 'connection-1',
        xeroTenantId: 'xero-tenant-1',
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        accessTokenExpiresAt: new Date(Date.now() + 60_000).toISOString()
      }
    }));

    await expect(getDefaultXeroTenantId('tenant-1')).resolves.toBe('xero-tenant-1');
  });

  it('returns null when no Xero connection is stored', async () => {
    await expect(getDefaultXeroTenantId('tenant-1')).resolves.toBeNull();
  });
});
