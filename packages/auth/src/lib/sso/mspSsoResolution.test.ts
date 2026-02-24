import { beforeEach, describe, expect, it, vi } from 'vitest';

const tenantSecrets = new Map<string, string>();
const appSecrets = new Map<string, string>();
const domainRows: Array<{ tenant: string; domain: string; is_active: boolean }> = [];

const getTenantSecretMock = vi.fn(async (tenant: string, key: string) => {
  return tenantSecrets.get(`${tenant}:${key}`) ?? null;
});
const getAppSecretMock = vi.fn(async (key: string) => {
  return appSecrets.get(key) ?? null;
});

const dbMock = vi.fn((table: string) => {
  if (table !== 'msp_sso_tenant_login_domains') {
    throw new Error(`Unexpected table: ${table}`);
  }

  const state: {
    isActive?: boolean;
    domain?: string;
  } = {};

  return {
    distinct: () => ({
      where: (conditions: { is_active?: boolean }) => {
        state.isActive = conditions?.is_active;
        return {
          whereRaw: (_sql: string, bindings: unknown[]) => {
            state.domain = String(bindings[0] ?? '').toLowerCase();
            const rows = domainRows
              .filter((row) => (state.isActive === undefined ? true : row.is_active === state.isActive))
              .filter((row) => row.domain.toLowerCase() === state.domain)
              .map((row) => ({ tenant: row.tenant }));
            return Promise.resolve(rows);
          },
        };
      },
    }),
  };
});

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
  createSignedMspSsoDiscoveryCookie,
  createSignedMspSsoResolutionCookie,
  discoverMspSsoProviderOptions,
  extractDomainFromEmail,
  normalizeResolverEmail,
  parseAndVerifyMspSsoDiscoveryCookie,
  parseAndVerifyMspSsoResolutionCookie,
  resolveMspSsoCredentialSource,
  resolveTenantForMspSsoDomain,
} from './mspSsoResolution';

describe('mspSsoResolution helpers', () => {
  beforeEach(() => {
    tenantSecrets.clear();
    appSecrets.clear();
    domainRows.length = 0;
    getTenantSecretMock.mockClear();
    getAppSecretMock.mockClear();
    dbMock.mockClear();
  });

  it('normalizes email and extracts domain from mixed-case input', () => {
    expect(normalizeResolverEmail('  User@Example.COM  ')).toBe('user@example.com');
    expect(extractDomainFromEmail('  User@Example.COM  ')).toBe('example.com');
    expect(extractDomainFromEmail('not-an-email')).toBeNull();
  });

  it('resolves mapped domain to single tenant and marks ambiguous duplicates as unresolved', async () => {
    domainRows.push(
      { tenant: 'tenant-1', domain: 'acme.com', is_active: true },
      { tenant: 'tenant-2', domain: 'shared.com', is_active: true },
      { tenant: 'tenant-3', domain: 'shared.com', is_active: true }
    );

    await expect(resolveTenantForMspSsoDomain('acme.com')).resolves.toEqual({
      tenantId: 'tenant-1',
      ambiguous: false,
    });
    await expect(resolveTenantForMspSsoDomain('shared.com')).resolves.toEqual({
      ambiguous: true,
    });
    await expect(resolveTenantForMspSsoDomain('unknown.com')).resolves.toEqual({
      ambiguous: false,
    });
  });

  it('discovers tenant-scoped provider list without user lookup', async () => {
    domainRows.push({ tenant: 'tenant-1', domain: 'acme.com', is_active: true });
    tenantSecrets.set('tenant-1:microsoft_client_id', 'ms-id');
    tenantSecrets.set('tenant-1:microsoft_client_secret', 'ms-secret');

    const result = await discoverMspSsoProviderOptions('person@acme.com');
    expect(result).toEqual({
      source: 'tenant',
      tenantId: 'tenant-1',
      providers: ['azure-ad'],
      domain: 'acme.com',
      ambiguous: false,
    });
  });

  it('falls back to app providers for unresolved or ambiguous domains', async () => {
    domainRows.push(
      { tenant: 'tenant-1', domain: 'shared.com', is_active: true },
      { tenant: 'tenant-2', domain: 'shared.com', is_active: true }
    );
    appSecrets.set('GOOGLE_OAUTH_CLIENT_ID', 'google-id');
    appSecrets.set('GOOGLE_OAUTH_CLIENT_SECRET', 'google-secret');

    await expect(discoverMspSsoProviderOptions('person@shared.com')).resolves.toEqual({
      source: 'app',
      providers: ['google'],
      domain: 'shared.com',
      ambiguous: true,
    });
    await expect(discoverMspSsoProviderOptions('person@unknown.com')).resolves.toEqual({
      source: 'app',
      providers: ['google'],
      domain: 'unknown.com',
      ambiguous: false,
    });
  });

  it('resolver enforces discovered provider allow-list and falls back to app when discovery missing', async () => {
    tenantSecrets.set('tenant-1:microsoft_client_id', 'ms-id');
    tenantSecrets.set('tenant-1:microsoft_client_secret', 'ms-secret');
    appSecrets.set('GOOGLE_OAUTH_CLIENT_ID', 'google-id');
    appSecrets.set('GOOGLE_OAUTH_CLIENT_SECRET', 'google-secret');

    await expect(
      resolveMspSsoCredentialSource({
        provider: 'azure-ad',
        discovery: {
          source: 'tenant',
          tenantId: 'tenant-1',
          providers: ['azure-ad'],
          issuedAt: 1,
          expiresAt: Number.MAX_SAFE_INTEGER,
          nonce: 'nonce-1',
        },
      })
    ).resolves.toEqual({
      resolved: true,
      source: 'tenant',
      tenantId: 'tenant-1',
    });

    await expect(
      resolveMspSsoCredentialSource({
        provider: 'google',
        discovery: {
          source: 'tenant',
          tenantId: 'tenant-1',
          providers: ['azure-ad'],
          issuedAt: 1,
          expiresAt: Number.MAX_SAFE_INTEGER,
          nonce: 'nonce-2',
        },
      })
    ).resolves.toEqual({ resolved: false });

    await expect(resolveMspSsoCredentialSource({ provider: 'google' })).resolves.toEqual({
      resolved: true,
      source: 'app',
    });
  });

  it('signs and verifies discovery + resolver cookies without secrets in payload', () => {
    const discovery = createSignedMspSsoDiscoveryCookie({
      source: 'tenant',
      tenantId: 'tenant-1',
      providers: ['google', 'azure-ad'],
      secret: 'unit-secret',
      now: 1_700_000_000_000,
      ttlSeconds: 300,
    });

    expect(discovery.value).toContain('.');
    expect(discovery.value).not.toContain('client_secret');
    expect(discovery.payload.providers).toEqual(['google', 'azure-ad']);

    expect(
      parseAndVerifyMspSsoDiscoveryCookie({
        value: discovery.value,
        secret: 'unit-secret',
        now: 1_700_000_010_000,
      })
    ).toMatchObject({
      source: 'tenant',
      tenantId: 'tenant-1',
      providers: ['google', 'azure-ad'],
    });

    const resolution = createSignedMspSsoResolutionCookie({
      provider: 'azure-ad',
      source: 'tenant',
      tenantId: 'tenant-1',
      secret: 'unit-secret',
      now: 1_700_000_000_000,
      ttlSeconds: 300,
    });

    expect(
      parseAndVerifyMspSsoResolutionCookie({
        value: resolution.value,
        secret: 'unit-secret',
        now: 1_700_000_010_000,
      })
    ).toMatchObject({
      provider: 'azure-ad',
      source: 'tenant',
      tenantId: 'tenant-1',
    });
  });
});
