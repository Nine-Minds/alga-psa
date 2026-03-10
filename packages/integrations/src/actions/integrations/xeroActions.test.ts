import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

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
const getXeroConnectionSummariesMock = vi.hoisted(() => vi.fn(async () => []));
const getXeroRedirectUriMock = vi.hoisted(() => vi.fn(async () => 'https://example.com/api/integrations/xero/callback'));
const getXeroOAuthScopesMock = vi.hoisted(() => vi.fn(() => [
  'offline_access',
  'accounting.settings',
  'accounting.transactions',
  'accounting.contacts'
]));
const xeroCreateMock = vi.hoisted(() => vi.fn(async () => ({})));
const revalidatePathMock = vi.hoisted(() => vi.fn());

vi.mock('@alga-psa/auth', () => ({
  withAuth:
    (action: (...args: any[]) => Promise<unknown>) =>
    (...args: any[]) =>
      action(mockUser, mockCtx, ...args)
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: hasPermissionMock
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

vi.mock('../../lib/xero/xeroClientService', () => ({
  XERO_CREDENTIALS_SECRET_NAME: 'xero_credentials',
  XERO_CLIENT_ID_SECRET_NAME: 'xero_client_id',
  XERO_CLIENT_SECRET_SECRET_NAME: 'xero_client_secret',
  getXeroConnectionSummaries: getXeroConnectionSummariesMock,
  getXeroRedirectUri: getXeroRedirectUriMock,
  getXeroOAuthScopes: getXeroOAuthScopesMock,
  XeroClientService: {
    create: xeroCreateMock
  }
}));

import {
  disconnectXero,
  getXeroConnectionStatus,
  saveXeroCredentials
} from './xeroActions';

describe('Xero integration actions', () => {
  const originalEdition = process.env.NEXT_PUBLIC_EDITION;
  const originalEditionFlag = process.env.EDITION;

  beforeEach(() => {
    mockUser = { user_id: 'user-1', user_type: 'internal' };
    mockCtx = { tenant: 'tenant-1' };
    tenantSecrets.clear();
    vi.clearAllMocks();
    hasPermissionMock.mockResolvedValue(true);
    getXeroConnectionSummariesMock.mockResolvedValue([]);
    getXeroRedirectUriMock.mockResolvedValue('https://example.com/api/integrations/xero/callback');
    getXeroOAuthScopesMock.mockReturnValue([
      'offline_access',
      'accounting.settings',
      'accounting.transactions',
      'accounting.contacts'
    ]);
    xeroCreateMock.mockResolvedValue({});
    process.env.NEXT_PUBLIC_EDITION = 'enterprise';
    process.env.EDITION = 'ee';
  });

  it('T005: status returns masked credential readiness, redirect URI, scopes, and default connection summary', async () => {
    tenantSecrets.set('tenant-1:xero_client_id', 'xero-client-id-1234');
    tenantSecrets.set('tenant-1:xero_client_secret', 'super-secret-value');
    getXeroConnectionSummariesMock.mockResolvedValue([
      {
        connectionId: 'connection-1',
        xeroTenantId: 'tenant-guid-1',
        tenantName: 'Acme Holdings',
        status: 'connected'
      }
    ] as any);

    const result = await getXeroConnectionStatus();

    expect(result.credentials).toEqual({
      clientIdConfigured: true,
      clientSecretConfigured: true,
      ready: true,
      clientIdMasked: expect.stringContaining('1234'),
      clientSecretMasked: expect.stringContaining('alue')
    });
    expect(result.credentials.clientSecretMasked).not.toContain('super-secret-value');
    expect(JSON.stringify(result)).not.toContain('super-secret-value');
    expect(result.redirectUri).toBe('https://example.com/api/integrations/xero/callback');
    expect(result.scopes).toContain('accounting.transactions');
    expect(result.defaultConnectionId).toBe('connection-1');
    expect(result.defaultConnection?.tenantName).toBe('Acme Holdings');
    expect(result.connected).toBe(true);
  });

  it('T006: save action rejects empty client ID', async () => {
    const result = await saveXeroCredentials({
      clientId: '   ',
      clientSecret: 'secret'
    });

    expect(result).toEqual({
      success: false,
      error: 'Xero client ID is required.'
    });
  });

  it('T007: save action rejects empty client secret', async () => {
    const result = await saveXeroCredentials({
      clientId: 'client-id',
      clientSecret: '   '
    });

    expect(result).toEqual({
      success: false,
      error: 'Xero client secret is required.'
    });
  });

  it('T008: save action persists tenant-owned credentials and later status stays masked', async () => {
    const saveResult = await saveXeroCredentials({
      clientId: 'client-id',
      clientSecret: 'client-secret'
    });

    expect(saveResult).toEqual({ success: true });
    expect(setTenantSecretMock).toHaveBeenCalledWith('tenant-1', 'xero_client_id', 'client-id');
    expect(setTenantSecretMock).toHaveBeenCalledWith('tenant-1', 'xero_client_secret', 'client-secret');
    expect(revalidatePathMock).toHaveBeenCalledWith('/msp/settings');

    const status = await getXeroConnectionStatus();
    expect(status.credentials.ready).toBe(true);
    expect(status.credentials.clientSecretMasked).not.toContain('client-secret');
    expect(status.error).toBe('No live Xero organisation is connected yet. Save credentials, then click Connect Xero.');
  });

  it('T015: disconnect deletes xero_credentials but preserves tenant-owned Xero app credentials', async () => {
    tenantSecrets.set('tenant-1:xero_credentials', '{"connection-1":{"connectionId":"connection-1"}}');
    tenantSecrets.set('tenant-1:xero_client_id', 'client-id');
    tenantSecrets.set('tenant-1:xero_client_secret', 'client-secret');

    const result = await disconnectXero();

    expect(result).toEqual({ success: true });
    expect(deleteTenantSecretMock).toHaveBeenCalledWith('tenant-1', 'xero_credentials');
    expect(tenantSecrets.get('tenant-1:xero_client_id')).toBe('client-id');
    expect(tenantSecrets.get('tenant-1:xero_client_secret')).toBe('client-secret');
  });

  it('T024/T030: non-enterprise save attempts are rejected before writing secrets', async () => {
    process.env.NEXT_PUBLIC_EDITION = 'community';
    process.env.EDITION = 'ce';

    const result = await saveXeroCredentials({
      clientId: 'client-id',
      clientSecret: 'client-secret'
    });

    expect(result).toEqual({
      success: false,
      error: 'Xero integration is only available in Enterprise Edition.'
    });
    expect(setTenantSecretMock).not.toHaveBeenCalled();
  });

  it('T029/T030: billing permission is required for status and save/disconnect writes', async () => {
    hasPermissionMock.mockResolvedValue(false);

    await expect(getXeroConnectionStatus()).rejects.toThrow('Forbidden');
    await expect(
      saveXeroCredentials({
        clientId: 'client-id',
        clientSecret: 'client-secret'
      })
    ).resolves.toEqual({
      success: false,
      error: 'Forbidden'
    });
    await expect(disconnectXero()).resolves.toEqual({
      success: false,
      error: 'Forbidden'
    });
  });

  it('exports saveXeroCredentials from the integrations action indexes', () => {
    const repoRoot = path.resolve(process.cwd(), '..');
    const integrationsIndex = fs.readFileSync(
      path.resolve(repoRoot, 'packages/integrations/src/actions/integrations/index.ts'),
      'utf8'
    );
    const rootActionsIndex = fs.readFileSync(
      path.resolve(repoRoot, 'packages/integrations/src/actions/index.ts'),
      'utf8'
    );

    expect(integrationsIndex).toContain('saveXeroCredentials');
    expect(rootActionsIndex).toContain('saveXeroCredentials');
  });
});
