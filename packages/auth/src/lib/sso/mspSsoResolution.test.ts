import { beforeEach, describe, expect, it, vi } from 'vitest';

let mockUserRow: { user_id: string; tenant: string } | undefined;
let lookedUpEmail: string | undefined;

const tenantSecrets = new Map<string, string>();
const appSecrets = new Map<string, string>();

const getTenantSecretMock = vi.fn(async (tenant: string, key: string) => {
  return tenantSecrets.get(`${tenant}:${key}`) ?? null;
});
const getAppSecretMock = vi.fn(async (key: string) => {
  return appSecrets.get(key) ?? null;
});

const dbMock = vi.fn((_table: string) => ({
  select: () => ({
    whereRaw: (_sql: string, bindings: unknown[]) => {
      lookedUpEmail = String(bindings[0] ?? '');
      return {
        andWhere: () => ({
          first: async () => mockUserRow,
        }),
      };
    },
  }),
}));

vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: async () => ({
    getTenantSecret: (...args: unknown[]) => getTenantSecretMock(...args),
    getAppSecret: (...args: unknown[]) => getAppSecretMock(...args),
  }),
}));

vi.mock('@alga-psa/db/admin', () => ({
  getAdminConnection: async () => dbMock,
}));

import {
  createSignedMspSsoResolutionCookie,
  normalizeResolverEmail,
  parseAndVerifyMspSsoResolutionCookie,
  resolveMspSsoCredentialSource,
} from './mspSsoResolution';

describe('mspSsoResolution helpers', () => {
  beforeEach(() => {
    mockUserRow = undefined;
    lookedUpEmail = undefined;
    tenantSecrets.clear();
    appSecrets.clear();
    getTenantSecretMock.mockClear();
    getAppSecretMock.mockClear();
    dbMock.mockClear();
  });

  it('T032: normalizes email case/whitespace before resolver user lookup', async () => {
    appSecrets.set('GOOGLE_OAUTH_CLIENT_ID', 'app-google-id');
    appSecrets.set('GOOGLE_OAUTH_CLIENT_SECRET', 'app-google-secret');

    await resolveMspSsoCredentialSource({
      provider: 'google',
      email: '  User@Example.COM  ',
    });

    expect(normalizeResolverEmail('  User@Example.COM  ')).toBe('user@example.com');
    expect(lookedUpEmail).toBe('user@example.com');
  });

  it('T033/T063: selects tenant source for Microsoft when matching internal user + tenant secrets exist', async () => {
    mockUserRow = { user_id: 'user-1', tenant: 'tenant-1' };
    tenantSecrets.set('tenant-1:microsoft_client_id', 'tenant-ms-id');
    tenantSecrets.set('tenant-1:microsoft_client_secret', 'tenant-ms-secret');

    await expect(
      resolveMspSsoCredentialSource({ provider: 'azure-ad', email: 'user@example.com' })
    ).resolves.toMatchObject({
      resolved: true,
      source: 'tenant',
      userId: 'user-1',
      tenantId: 'tenant-1',
      userFound: true,
    });
  });

  it('T034: selects tenant source for Google when matching internal user + tenant secrets exist', async () => {
    mockUserRow = { user_id: 'user-2', tenant: 'tenant-1' };
    tenantSecrets.set('tenant-1:google_client_id', 'tenant-google-id');
    tenantSecrets.set('tenant-1:google_client_secret', 'tenant-google-secret');

    await expect(
      resolveMspSsoCredentialSource({ provider: 'google', email: 'user@example.com' })
    ).resolves.toMatchObject({
      resolved: true,
      source: 'tenant',
      userId: 'user-2',
      tenantId: 'tenant-1',
      userFound: true,
    });
  });

  it('T035/T041/T065: uses Microsoft app fallback keys when tenant source unavailable', async () => {
    mockUserRow = { user_id: 'user-3', tenant: 'tenant-1' };
    appSecrets.set('MICROSOFT_OAUTH_CLIENT_ID', 'app-ms-id');
    appSecrets.set('MICROSOFT_OAUTH_CLIENT_SECRET', 'app-ms-secret');

    await expect(
      resolveMspSsoCredentialSource({ provider: 'azure-ad', email: 'user@example.com' })
    ).resolves.toMatchObject({
      resolved: true,
      source: 'app',
      userFound: true,
    });

    expect(getAppSecretMock).toHaveBeenCalledWith('MICROSOFT_OAUTH_CLIENT_ID');
    expect(getAppSecretMock).toHaveBeenCalledWith('MICROSOFT_OAUTH_CLIENT_SECRET');
  });

  it('T036/T042: uses Google app fallback keys when tenant source unavailable', async () => {
    mockUserRow = { user_id: 'user-4', tenant: 'tenant-1' };
    appSecrets.set('GOOGLE_OAUTH_CLIENT_ID', 'app-google-id');
    appSecrets.set('GOOGLE_OAUTH_CLIENT_SECRET', 'app-google-secret');

    await expect(
      resolveMspSsoCredentialSource({ provider: 'google', email: 'user@example.com' })
    ).resolves.toMatchObject({
      resolved: true,
      source: 'app',
      userFound: true,
    });

    expect(getAppSecretMock).toHaveBeenCalledWith('GOOGLE_OAUTH_CLIENT_ID');
    expect(getAppSecretMock).toHaveBeenCalledWith('GOOGLE_OAUTH_CLIENT_SECRET');
  });

  it('T039/T040: signed cookie includes source metadata + signature and excludes raw secrets', () => {
    const { value, payload } = createSignedMspSsoResolutionCookie({
      provider: 'azure-ad',
      source: 'tenant',
      tenantId: 'tenant-1',
      userId: 'user-1',
      secret: 'unit-test-signing-secret',
      now: 1_700_000_000_000,
      ttlSeconds: 300,
    });

    expect(payload).toMatchObject({
      provider: 'azure-ad',
      source: 'tenant',
      tenantId: 'tenant-1',
      userId: 'user-1',
      issuedAt: 1_700_000_000_000,
      expiresAt: 1_700_000_300_000,
    });
    expect(payload.nonce.length).toBeGreaterThanOrEqual(8);

    expect(value).toContain('.');
    expect(value).not.toContain('client_id');
    expect(value).not.toContain('client_secret');

    const parsed = parseAndVerifyMspSsoResolutionCookie({
      value,
      secret: 'unit-test-signing-secret',
      now: 1_700_000_050_000,
    });

    expect(parsed).toMatchObject({
      provider: 'azure-ad',
      source: 'tenant',
      tenantId: 'tenant-1',
      userId: 'user-1',
    });
  });

  it('T043: invalid signature or expired cookie fails verification', () => {
    const { value } = createSignedMspSsoResolutionCookie({
      provider: 'google',
      source: 'app',
      secret: 'secret-a',
      now: 10_000,
      ttlSeconds: 1,
    });

    expect(
      parseAndVerifyMspSsoResolutionCookie({ value, secret: 'wrong-secret', now: 10_500 })
    ).toBeNull();
    expect(
      parseAndVerifyMspSsoResolutionCookie({ value, secret: 'secret-a', now: 12_000 })
    ).toBeNull();
  });
});
