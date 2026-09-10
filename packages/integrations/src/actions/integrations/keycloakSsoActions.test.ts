import { beforeEach, describe, expect, it, vi } from 'vitest';

const tenantSecrets = new Map<string, string>();
const TENANT = 'tenant-1';
let mockUser: { user_id: string; user_type: string } = { user_id: 'user-1', user_type: 'internal' };
let hasPermissionValue = true;

vi.mock('@alga-psa/auth', () => ({
  withAuth: (handler: (...args: unknown[]) => unknown) =>
    (...args: unknown[]) => handler(mockUser, { tenant: TENANT }, ...args),
}));

vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: async () => hasPermissionValue,
}));

vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: async () => ({
    getTenantSecret: async (tenant: string, key: string) => tenantSecrets.get(`${tenant}:${key}`),
    setTenantSecret: async (tenant: string, key: string, value: string | null) => {
      if (value === null) tenantSecrets.delete(`${tenant}:${key}`);
      else tenantSecrets.set(`${tenant}:${key}`, value);
    },
    deleteTenantSecret: async (tenant: string, key: string) => {
      tenantSecrets.delete(`${tenant}:${key}`);
    },
    getAppSecret: async () => undefined,
  }),
}));

import {
  clearKeycloakSsoSettings,
  getKeycloakSsoStatus,
  saveKeycloakSsoSettings,
} from './keycloakSsoActions';

function discoveryResponse(issuer: string, ok = true, status = 200) {
  return { ok, status, json: async () => ({ issuer }) };
}

describe('keycloakSsoActions', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    tenantSecrets.clear();
    mockUser = { user_id: 'user-1', user_type: 'internal' };
    hasPermissionValue = true;
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    process.env.NEXTAUTH_URL = 'https://psa.example.com';
  });

  it('verifies OpenID discovery, normalizes the URL, and stores the four tenant secrets', async () => {
    fetchMock.mockResolvedValue(discoveryResponse('https://kc.example.com/realms/acme'));

    const result = await saveKeycloakSsoSettings({
      url: ' https://kc.example.com/ ',
      realm: 'acme',
      clientId: ' algapsa ',
      clientSecret: 's3cret',
    });

    expect(result).toEqual({ success: true, issuer: 'https://kc.example.com/realms/acme' });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://kc.example.com/realms/acme/.well-known/openid-configuration',
      expect.objectContaining({ headers: { accept: 'application/json' } })
    );
    expect(tenantSecrets.get(`${TENANT}:keycloak_url`)).toBe('https://kc.example.com');
    expect(tenantSecrets.get(`${TENANT}:keycloak_realm`)).toBe('acme');
    expect(tenantSecrets.get(`${TENANT}:keycloak_client_id`)).toBe('algapsa');
    expect(tenantSecrets.get(`${TENANT}:keycloak_client_secret`)).toBe('s3cret');
  });

  it('rejects a realm whose issuer does not match and writes nothing', async () => {
    fetchMock.mockResolvedValue(discoveryResponse('http://internal:8080/realms/acme'));

    const result = await saveKeycloakSsoSettings({
      url: 'https://kc.example.com',
      realm: 'acme',
      clientId: 'algapsa',
      clientSecret: 's3cret',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('does not match');
    expect(tenantSecrets.size).toBe(0);
  });

  it('rejects an unreachable realm with a readable reason', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));

    const result = await saveKeycloakSsoSettings({
      url: 'https://kc.example.com',
      realm: 'acme',
      clientId: 'algapsa',
      clientSecret: 's3cret',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('ECONNREFUSED');
  });

  it('keeps the saved secret when the form leaves it blank', async () => {
    tenantSecrets.set(`${TENANT}:keycloak_client_secret`, 'existing');
    fetchMock.mockResolvedValue(discoveryResponse('https://kc.example.com/realms/acme'));

    const result = await saveKeycloakSsoSettings({
      url: 'https://kc.example.com',
      realm: 'acme',
      clientId: 'algapsa',
      clientSecret: '',
    });

    expect(result.success).toBe(true);
    expect(tenantSecrets.get(`${TENANT}:keycloak_client_secret`)).toBe('existing');
  });

  it('validates inputs before touching the network', async () => {
    await expect(saveKeycloakSsoSettings({ url: 'ftp://kc', realm: 'acme', clientId: 'x', clientSecret: 'y' }))
      .resolves.toMatchObject({ success: false });
    await expect(saveKeycloakSsoSettings({ url: 'https://kc.example.com', realm: 'bad realm', clientId: 'x', clientSecret: 'y' }))
      .resolves.toMatchObject({ success: false });
    await expect(saveKeycloakSsoSettings({ url: 'https://kc.example.com', realm: 'acme', clientId: '', clientSecret: 'y' }))
      .resolves.toMatchObject({ success: false, error: 'Client ID is required' });
    await expect(saveKeycloakSsoSettings({ url: 'https://kc.example.com', realm: 'acme', clientId: 'x', clientSecret: '' }))
      .resolves.toMatchObject({ success: false, error: 'Client secret is required' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports masked status with the callback redirect URI and clears all four secrets on remove', async () => {
    tenantSecrets.set(`${TENANT}:keycloak_url`, 'https://kc.example.com');
    tenantSecrets.set(`${TENANT}:keycloak_realm`, 'acme');
    tenantSecrets.set(`${TENANT}:keycloak_client_id`, 'algapsa');
    tenantSecrets.set(`${TENANT}:keycloak_client_secret`, 'supersecret');

    const status = await getKeycloakSsoStatus();
    expect(status).toMatchObject({
      success: true,
      redirectUri: 'https://psa.example.com/api/auth/callback/keycloak',
      config: {
        configured: true,
        url: 'https://kc.example.com',
        realm: 'acme',
        clientId: 'algapsa',
        clientSecretMasked: '•••••••cret',
        issuer: 'https://kc.example.com/realms/acme',
      },
    });

    await expect(clearKeycloakSsoSettings()).resolves.toEqual({ success: true });
    expect(tenantSecrets.size).toBe(0);
    await expect(getKeycloakSsoStatus()).resolves.toMatchObject({ config: { configured: false } });
  });

  it('denies client users and users without settings permission', async () => {
    mockUser = { user_id: 'c-1', user_type: 'client' };
    await expect(getKeycloakSsoStatus()).resolves.toEqual({ success: false, error: 'Forbidden' });

    mockUser = { user_id: 'user-1', user_type: 'internal' };
    hasPermissionValue = false;
    await expect(saveKeycloakSsoSettings({ url: 'https://kc.example.com', realm: 'acme', clientId: 'x', clientSecret: 'y' }))
      .resolves.toEqual({ success: false, error: 'Forbidden' });
    await expect(clearKeycloakSsoSettings()).resolves.toEqual({ success: false, error: 'Forbidden' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
