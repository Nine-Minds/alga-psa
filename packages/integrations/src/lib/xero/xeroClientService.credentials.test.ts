import { beforeEach, describe, expect, it, vi } from 'vitest';

const tenantSecrets = new Map<string, string>();
const appSecrets = new Map<string, string>();
const axiosRequestMock = vi.hoisted(() => vi.fn());

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

vi.mock('axios', () => {
  const axios = {
    request: (...args: unknown[]) => axiosRequestMock(...args),
    post: vi.fn(),
    isAxiosError: (error: unknown) => Boolean((error as { isAxiosError?: boolean })?.isAxiosError)
  };
  return { default: axios, ...axios };
});

import {
  getDefaultXeroTenantId,
  resolveXeroOAuthCredentials,
  XeroClientService
} from './xeroClientService';

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

  it('selects a stored connection by its Xero organisation tenant id', async () => {
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    tenantSecrets.set('tenant-1:xero_client_id', 'tenant-client-id');
    tenantSecrets.set('tenant-1:xero_client_secret', 'tenant-client-secret');
    tenantSecrets.set('tenant-1:xero_credentials', JSON.stringify({
      'connection-default': {
        connectionId: 'connection-default',
        xeroTenantId: 'xero-tenant-default',
        accessToken: 'default-access-token',
        refreshToken: 'default-refresh-token',
        accessTokenExpiresAt: future
      },
      'connection-selected': {
        connectionId: 'connection-selected',
        xeroTenantId: 'xero-tenant-selected',
        accessToken: 'selected-access-token',
        refreshToken: 'selected-refresh-token',
        accessTokenExpiresAt: future
      }
    }));
    axiosRequestMock.mockResolvedValueOnce({ data: { Items: [] } });

    const client = await XeroClientService.create('tenant-1', 'xero-tenant-selected');
    await client.listItems();

    expect(axiosRequestMock).toHaveBeenCalledWith(expect.objectContaining({
      headers: expect.objectContaining({
        Authorization: 'Bearer selected-access-token',
        'Xero-tenant-id': 'xero-tenant-selected'
      })
    }));
  });

  it('does not silently fall back to the default organisation for an unknown realm', async () => {
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    tenantSecrets.set('tenant-1:xero_client_id', 'tenant-client-id');
    tenantSecrets.set('tenant-1:xero_client_secret', 'tenant-client-secret');
    tenantSecrets.set('tenant-1:xero_credentials', JSON.stringify({
      'connection-default': {
        connectionId: 'connection-default',
        xeroTenantId: 'xero-tenant-default',
        accessToken: 'default-access-token',
        refreshToken: 'default-refresh-token',
        accessTokenExpiresAt: future
      }
    }));

    await expect(XeroClientService.create('tenant-1', 'unknown-realm')).rejects.toMatchObject({
      code: 'XERO_CONNECTION_NOT_FOUND'
    });
  });
});
