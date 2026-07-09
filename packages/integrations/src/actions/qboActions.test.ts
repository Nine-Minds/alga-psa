import { beforeEach, describe, expect, it, vi } from 'vitest';

let mockUser: any = { user_id: 'user-1', user_type: 'internal' };
let mockCtx: any = { tenant: 'tenant-1' };

const tenantSecrets = new Map<string, string>();

const getTenantSecretMock = vi.hoisted(() => vi.fn(async (tenant: string, key: string) => {
  return tenantSecrets.get(`${tenant}:${key}`) || null;
}));
const setTenantSecretMock = vi.hoisted(() => vi.fn(async (tenant: string, key: string, value: string) => {
  tenantSecrets.set(`${tenant}:${key}`, value);
}));
const deleteTenantSecretMock = vi.hoisted(() => vi.fn(async (tenant: string, key: string) => {
  tenantSecrets.delete(`${tenant}:${key}`);
}));
const hasPermissionMock = vi.hoisted(() => vi.fn(async () => true));

const resolveQboOAuthCredentialsMock = vi.hoisted(() => vi.fn(async (): Promise<any> => ({
  clientId: 'tenant-client-id',
  clientSecret: 'tenant-client-secret',
  source: 'tenant' as const
})));
const getQboRedirectUriMock = vi.hoisted(() => vi.fn(async () => 'https://example.com/api/integrations/qbo/callback'));
const getQboOAuthScopesMock = vi.hoisted(() => vi.fn(() => [
  'com.intuit.quickbooks.accounting',
  'openid',
  'profile',
  'email',
  'phone',
  'address'
]));
const getQboEnvironmentMock = vi.hoisted(() => vi.fn(() => 'sandbox' as const));
const qboClientCreateMock = vi.hoisted(() => vi.fn(async (): Promise<any> => ({
  query: vi.fn(async () => [])
})));

const axiosPostMock = vi.hoisted(() => vi.fn(async () => ({ status: 200 })));

const revalidatePathMock = vi.hoisted(() => vi.fn());
const loggerInfoMock = vi.hoisted(() => vi.fn());
const loggerWarnMock = vi.hoisted(() => vi.fn());
const loggerErrorMock = vi.hoisted(() => vi.fn());
const loggerDebugMock = vi.hoisted(() => vi.fn());

vi.mock('@alga-psa/auth', () => ({
  withAuth:
    (action: (...args: any[]) => Promise<unknown>) =>
    (...args: any[]) =>
      action(mockUser, mockCtx, ...args)
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: hasPermissionMock
}));

vi.mock('@alga-psa/core/logger', () => ({
  default: {
    info: loggerInfoMock,
    warn: loggerWarnMock,
    error: loggerErrorMock,
    debug: loggerDebugMock
  }
}));

vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: async () => ({
    getTenantSecret: getTenantSecretMock,
    setTenantSecret: setTenantSecretMock,
    deleteTenantSecret: deleteTenantSecretMock
  })
}));

vi.mock('next/cache', () => ({
  revalidatePath: revalidatePathMock
}));

vi.mock('axios', () => ({
  default: {
    post: axiosPostMock
  }
}));

vi.mock('../lib/qbo/qboClientService', () => ({
  QBO_CLIENT_ID_SECRET_NAME: 'qbo_client_id',
  QBO_CLIENT_SECRET_SECRET_NAME: 'qbo_client_secret',
  QBO_CREDENTIALS_SECRET_NAME: 'qbo_credentials',
  resolveQboOAuthCredentials: resolveQboOAuthCredentialsMock,
  getQboRedirectUri: getQboRedirectUriMock,
  getQboOAuthScopes: getQboOAuthScopesMock,
  getQboEnvironment: getQboEnvironmentMock,
  QboClientService: {
    create: qboClientCreateMock
  }
}));

import {
  saveQboCredentials,
  getQboConnectionStatus,
  disconnectQbo,
  getQboAccounts,
  getQboClasses,
  getQboDepartments
} from './qboActions';

describe('QBO integration actions', () => {
  const originalEdition = process.env.NEXT_PUBLIC_EDITION;
  const originalEditionFlag = process.env.EDITION;

  beforeEach(() => {
    mockUser = { user_id: 'user-1', user_type: 'internal' };
    mockCtx = { tenant: 'tenant-1' };
    tenantSecrets.clear();
    vi.clearAllMocks();
    hasPermissionMock.mockResolvedValue(true);
    resolveQboOAuthCredentialsMock.mockResolvedValue({
      clientId: 'tenant-client-id',
      clientSecret: 'tenant-client-secret',
      source: 'tenant' as const
    });
    getQboRedirectUriMock.mockResolvedValue('https://example.com/api/integrations/qbo/callback');
    getQboOAuthScopesMock.mockReturnValue([
      'com.intuit.quickbooks.accounting',
      'openid'
    ]);
    getQboEnvironmentMock.mockReturnValue('sandbox');
    qboClientCreateMock.mockResolvedValue({
      query: vi.fn(async () => [])
    });
    axiosPostMock.mockResolvedValue({ status: 200 });
    process.env.NEXT_PUBLIC_EDITION = 'enterprise';
    process.env.EDITION = 'ee';
  });

  // Restore env after all tests
  afterAll(() => {
    process.env.NEXT_PUBLIC_EDITION = originalEdition;
    process.env.EDITION = originalEditionFlag;
  });

  // --- saveQboCredentials ---

  it('saveQboCredentials: empty clientId returns success:false with required error', async () => {
    const result = await saveQboCredentials({ clientId: '   ', clientSecret: 'some-secret' });
    expect(result).toEqual({
      success: false,
      error: 'QuickBooks client ID is required.'
    });
    expect(setTenantSecretMock).not.toHaveBeenCalled();
  });

  it('saveQboCredentials: empty clientSecret returns success:false with required error', async () => {
    const result = await saveQboCredentials({ clientId: 'some-id', clientSecret: '   ' });
    expect(result).toEqual({
      success: false,
      error: 'QuickBooks client secret is required.'
    });
    expect(setTenantSecretMock).not.toHaveBeenCalled();
  });

  it('saveQboCredentials success: stores both tenant secrets and revalidates path', async () => {
    const result = await saveQboCredentials({ clientId: 'my-client-id', clientSecret: 'my-client-secret' });
    expect(result).toEqual({ success: true });
    expect(setTenantSecretMock).toHaveBeenCalledWith('tenant-1', 'qbo_client_id', 'my-client-id');
    expect(setTenantSecretMock).toHaveBeenCalledWith('tenant-1', 'qbo_client_secret', 'my-client-secret');
    expect(revalidatePathMock).toHaveBeenCalledWith('/msp/settings');
  });

  it('saveQboCredentials in CE (no EDITION env) returns success:false with Enterprise Edition message', async () => {
    process.env.NEXT_PUBLIC_EDITION = 'community';
    process.env.EDITION = 'ce';

    const result = await saveQboCredentials({ clientId: 'my-client-id', clientSecret: 'my-client-secret' });
    expect(result).toEqual({
      success: false,
      error: 'QuickBooks Online integration is only available in Enterprise Edition.'
    });
    expect(setTenantSecretMock).not.toHaveBeenCalled();
  });

  // --- getQboConnectionStatus ---

  it('getQboConnectionStatus in CE returns an Enterprise Edition status error', async () => {
    process.env.NEXT_PUBLIC_EDITION = 'community';
    process.env.EDITION = 'ce';

    await expect(getQboConnectionStatus()).resolves.toEqual(
      expect.objectContaining({
        connected: false,
        error: 'QuickBooks Online integration is only available in Enterprise Edition.',
        errorCode: 'ENTERPRISE_REQUIRED',
      })
    );
  });

  it('getQboConnectionStatus (EE): no stored credentials → connected:false, credentials.ready false, error mentions client ID/secret', async () => {
    // No stored qbo_credentials in tenantSecrets
    // resolveQboOAuthCredentials returns null → credentials not ready
    resolveQboOAuthCredentialsMock.mockResolvedValue(null);

    const result = await getQboConnectionStatus();

    expect(result.connected).toBe(false);
    expect(result.connections).toEqual([]);
    expect(result.credentials.ready).toBe(false);
    expect(result.credentials.clientIdConfigured).toBe(false);
    expect(result.credentials.clientSecretConfigured).toBe(false);
    expect(result.error).toBeTruthy();
    // Error should mention client ID/secret configuration
    expect(result.error).toContain('client');
    expect(result.redirectUri).toBe('https://example.com/api/integrations/qbo/callback');
    expect(result.scopes).toContain('com.intuit.quickbooks.accounting');
    expect(result.environment).toBe('sandbox');
  });

  it('getQboConnectionStatus (EE): stored credentials for one realm + QboClientService query returns CompanyName → connected:true, masked values', async () => {
    tenantSecrets.set('tenant-1:qbo_client_id', 'client-id-abcd1234');
    tenantSecrets.set('tenant-1:qbo_client_secret', 'super-secret-wxyz5678');

    const credMap = {
      'realm-123': {
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        realmId: 'realm-123',
        accessTokenExpiresAt: new Date(Date.now() + 3600000).toISOString(),
        refreshTokenExpiresAt: new Date(Date.now() + 86400000).toISOString()
      }
    };
    tenantSecrets.set('tenant-1:qbo_credentials', JSON.stringify(credMap));

    const queryMock = vi.fn(async () => [{ CompanyName: 'Sandbox Co' }]);
    qboClientCreateMock.mockResolvedValue({ query: queryMock });

    const result = await getQboConnectionStatus();

    expect(result.connected).toBe(true);
    expect(result.defaultRealmId).toBe('realm-123');
    expect(result.defaultConnection).toBeDefined();
    expect(result.defaultConnection?.displayName).toBe('Sandbox Co');
    expect(result.defaultConnection?.status).toBe('active');

    // Masked credentials: last 4 chars should be present
    expect(result.credentials.clientIdConfigured).toBe(true);
    expect(result.credentials.clientSecretConfigured).toBe(true);
    expect(result.credentials.clientIdMasked).toContain('1234');
    expect(result.credentials.clientSecretMasked).toContain('5678');
    // Full secret values must not appear
    expect(result.credentials.clientIdMasked).not.toContain('client-id-abcd1234');
    expect(result.credentials.clientSecretMasked).not.toContain('super-secret-wxyz5678');
    expect(JSON.stringify(result)).not.toContain('super-secret-wxyz5678');
  });

  // --- disconnectQbo ---

  it('disconnectQbo (EE): deletes tenant secret, posts revocation per realm, revalidates path; success even when axios.post rejects', async () => {
    const credMap = {
      'realm-456': {
        accessToken: 'access-token',
        refreshToken: 'refresh-token-to-revoke',
        realmId: 'realm-456',
        accessTokenExpiresAt: new Date(Date.now() + 3600000).toISOString(),
        refreshTokenExpiresAt: new Date(Date.now() + 86400000).toISOString()
      }
    };
    tenantSecrets.set('tenant-1:qbo_credentials', JSON.stringify(credMap));

    // Simulate revocation failure — action should still succeed
    axiosPostMock.mockRejectedValue(new Error('Network error'));

    const result = await disconnectQbo();

    expect(result).toEqual({ success: true });
    expect(deleteTenantSecretMock).toHaveBeenCalledWith('tenant-1', 'qbo_credentials');
    expect(revalidatePathMock).toHaveBeenCalledWith('/msp/settings');

    // Revocation was attempted with the refresh token
    expect(axiosPostMock).toHaveBeenCalledWith(
      'https://developer.api.intuit.com/v2/oauth2/tokens/revoke',
      { token: 'refresh-token-to-revoke' },
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: expect.stringContaining('Basic ') })
      })
    );
  });

  it('disconnectQbo in CE returns success:false with EE message', async () => {
    process.env.NEXT_PUBLIC_EDITION = 'community';
    process.env.EDITION = 'ce';

    tenantSecrets.set('tenant-1:qbo_credentials', JSON.stringify({
      'realm-789': {
        accessToken: 'at',
        refreshToken: 'rt',
        realmId: 'realm-789',
        accessTokenExpiresAt: new Date().toISOString(),
        refreshTokenExpiresAt: new Date().toISOString()
      }
    }));

    const result = await disconnectQbo();

    expect(result).toEqual({
      success: false,
      error: 'QuickBooks Online integration is only available in Enterprise Edition.'
    });
    expect(deleteTenantSecretMock).not.toHaveBeenCalled();
    expect(axiosPostMock).not.toHaveBeenCalled();
  });

  // --- catalog actions: getQboAccounts, getQboClasses, getQboDepartments ---

  it('getQboAccounts: returns only Bank and Other Current Asset accounts', async () => {
    const credMap = {
      'realm-111': {
        accessToken: 'at', refreshToken: 'rt', realmId: 'realm-111',
        accessTokenExpiresAt: new Date(Date.now() + 3600000).toISOString(),
        refreshTokenExpiresAt: new Date(Date.now() + 86400000).toISOString()
      }
    };
    tenantSecrets.set('tenant-1:qbo_credentials', JSON.stringify(credMap));

    const queryMock = vi.fn(async () => [
      { Id: 'acct-1', Name: 'Checking', AccountType: 'Bank' },
      { Id: 'acct-2', Name: 'Undeposited Funds', AccountType: 'Other Current Asset' },
      { Id: 'acct-3', Name: 'Accounts Receivable', AccountType: 'Accounts Receivable' },
      { Id: 'acct-4', Name: 'Retained Earnings', AccountType: 'Equity' }
    ]);
    qboClientCreateMock.mockResolvedValue({ query: queryMock });

    const result = await getQboAccounts();

    expect(Array.isArray(result)).toBe(true);
    if (!Array.isArray(result)) return;
    expect(result).toHaveLength(2);
    expect(result.map((a) => a.id)).toEqual(['acct-1', 'acct-2']);
    expect(result.every((a) => ['Bank', 'Other Current Asset'].includes(a.accountType))).toBe(true);
    expect(result.find((a) => a.accountType === 'Accounts Receivable')).toBeUndefined();
  });

  it('getQboAccounts: reports a missing QuickBooks connection instead of returning an empty catalog', async () => {
    const result = await getQboAccounts();

    expect(result).toEqual({
      actionError: 'Connect QuickBooks before loading QuickBooks accounts.'
    });
    expect(qboClientCreateMock).not.toHaveBeenCalled();
  });

  it('getQboAccounts: reports an expired QuickBooks connection as a reconnect-required catalog error', async () => {
    const credMap = {
      'realm-expired': {
        accessToken: 'at', refreshToken: 'rt', realmId: 'realm-expired',
        accessTokenExpiresAt: new Date(Date.now() + 3600000).toISOString(),
        refreshTokenExpiresAt: new Date(Date.now() + 86400000).toISOString()
      }
    };
    tenantSecrets.set('tenant-1:qbo_credentials', JSON.stringify(credMap));
    qboClientCreateMock.mockRejectedValue(new Error('refresh token expired'));

    const result = await getQboAccounts();

    expect(result).toEqual({
      actionError: 'Reconnect QuickBooks before loading QuickBooks accounts.'
    });
  });

  it('getQboClasses: returns active classes only', async () => {
    const credMap = {
      'realm-222': {
        accessToken: 'at', refreshToken: 'rt', realmId: 'realm-222',
        accessTokenExpiresAt: new Date(Date.now() + 3600000).toISOString(),
        refreshTokenExpiresAt: new Date(Date.now() + 86400000).toISOString()
      }
    };
    tenantSecrets.set('tenant-1:qbo_credentials', JSON.stringify(credMap));

    const queryMock = vi.fn(async () => [
      { Id: 'cls-1', Name: 'Managed Services', Active: true },
      { Id: 'cls-2', Name: 'Old Class', Active: false },
      { Id: 'cls-3', Name: 'Professional Services' } // Active omitted = treated as active
    ]);
    qboClientCreateMock.mockResolvedValue({ query: queryMock });

    const result = await getQboClasses();

    expect(Array.isArray(result)).toBe(true);
    if (!Array.isArray(result)) return;
    expect(result).toHaveLength(2);
    expect(result.map((c) => c.id)).toEqual(['cls-1', 'cls-3']);
    expect(result.find((c) => c.id === 'cls-2')).toBeUndefined();
  });

  it('getQboDepartments: returns all departments from QBO', async () => {
    const credMap = {
      'realm-333': {
        accessToken: 'at', refreshToken: 'rt', realmId: 'realm-333',
        accessTokenExpiresAt: new Date(Date.now() + 3600000).toISOString(),
        refreshTokenExpiresAt: new Date(Date.now() + 86400000).toISOString()
      }
    };
    tenantSecrets.set('tenant-1:qbo_credentials', JSON.stringify(credMap));

    const queryMock = vi.fn(async () => [
      { Id: 'dept-1', Name: 'East Region' },
      { Id: 'dept-2', Name: 'West Region' }
    ]);
    qboClientCreateMock.mockResolvedValue({ query: queryMock });

    const result = await getQboDepartments();

    expect(Array.isArray(result)).toBe(true);
    if (!Array.isArray(result)) return;
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ id: 'dept-1', name: 'East Region' });
    expect(result[1]).toEqual({ id: 'dept-2', name: 'West Region' });
  });
});
