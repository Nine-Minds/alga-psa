import { beforeEach, describe, expect, it, vi } from 'vitest';

const tenantSecrets = new Map<string, string>();
const appSecrets = new Map<string, string>();
const domainRows: Array<{
  tenant: string;
  domain: string;
  is_active: boolean;
  claim_status?: string;
}> = [];
const microsoftProfiles: Array<Record<string, unknown>> = [];
const microsoftConsumerBindings: Array<Record<string, unknown>> = [];

const getTenantSecretMock = vi.fn(async (tenant: string, key: string) => {
  return tenantSecrets.get(`${tenant}:${key}`) ?? null;
});
const setTenantSecretMock = vi.fn(async (tenant: string, key: string, value: string | null) => {
  if (value === null) {
    tenantSecrets.delete(`${tenant}:${key}`);
    return;
  }
  tenantSecrets.set(`${tenant}:${key}`, value);
});
const getAppSecretMock = vi.fn(async (key: string) => {
  return appSecrets.get(key) ?? null;
});

const dbMock = vi.fn((table: string) => {
  const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
  const matchesWhere = (row: Record<string, unknown>, conditions: Record<string, unknown>): boolean =>
    Object.entries(conditions).every(([key, value]) => row[key] === value);

  if (table === 'msp_sso_tenant_login_domains') {
    const state: {
      isActive?: boolean;
      domain?: string;
      tenant?: string;
    } = {};

    return {
      where(conditions: { tenant?: string; is_active?: boolean }) {
        state.tenant = conditions?.tenant;
        state.isActive = conditions?.is_active;
        return this;
      },
      first() {
        const row = domainRows.find(
          (candidate) =>
            (state.tenant === undefined || candidate.tenant === state.tenant) &&
            (state.isActive === undefined || candidate.is_active === state.isActive)
        );
        return Promise.resolve(row ? clone(row) : undefined);
      },
      select: () => ({
        where: (conditions: { is_active?: boolean }) => {
          state.isActive = conditions?.is_active;
          return {
            whereRaw: (_sql: string, bindings: unknown[]) => {
              state.domain = String(bindings[0] ?? '').toLowerCase();
              const rows = domainRows
                .filter((row) => (state.isActive === undefined ? true : row.is_active === state.isActive))
                .filter((row) => row.domain.toLowerCase() === state.domain)
                .map((row) => ({ tenant: row.tenant, claim_status: row.claim_status }));
              return Promise.resolve(rows);
            },
          };
        },
      }),
    };
  }

  if (table === 'microsoft_profiles' || table === 'microsoft_profile_consumer_bindings') {
    const rows = table === 'microsoft_profiles' ? microsoftProfiles : microsoftConsumerBindings;
    const filters: Record<string, unknown>[] = [];

    return {
      where(conditions: Record<string, unknown>) {
        filters.push(conditions);
        return this;
      },
      async first() {
        const row = rows.find((candidate) => filters.every((filter) => matchesWhere(candidate, filter)));
        return row ? clone(row) : undefined;
      },
      async select(..._args: unknown[]) {
        return rows
          .filter((candidate) => filters.every((filter) => matchesWhere(candidate, filter)))
          .map((row) => clone(row));
      },
      async insert(values: Record<string, unknown> | Array<Record<string, unknown>>) {
        const items = Array.isArray(values) ? values : [values];
        items.forEach((item) => rows.push(clone(item)));
        return items.length;
      },
    };
  }

  throw new Error(`Unexpected table: ${table}`);
});

vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: async () => ({
    getTenantSecret: (...args: unknown[]) => getTenantSecretMock(...args),
    setTenantSecret: (...args: unknown[]) => setTenantSecretMock(...args),
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
    delete process.env.EDITION;
    delete process.env.NEXT_PUBLIC_EDITION;
    tenantSecrets.clear();
    appSecrets.clear();
    domainRows.length = 0;
    microsoftProfiles.length = 0;
    microsoftConsumerBindings.length = 0;
    getTenantSecretMock.mockClear();
    setTenantSecretMock.mockClear();
    getAppSecretMock.mockClear();
    dbMock.mockClear();
  });

  it('T018: normalizes email and extracts domain from mixed-case input', () => {
    expect(normalizeResolverEmail('  User@Example.COM  ')).toBe('user@example.com');
    expect(extractDomainFromEmail('  User@Example.COM  ')).toBe('example.com');
    expect(extractDomainFromEmail('not-an-email')).toBeNull();
  });

  it('T014: resolves mapped domain to single tenant and marks ambiguous duplicates as unresolved', async () => {
    domainRows.push(
      { tenant: 'tenant-1', domain: 'acme.com', is_active: true },
      { tenant: 'tenant-2', domain: 'shared.com', is_active: true },
      { tenant: 'tenant-3', domain: 'shared.com', is_active: true }
    );

    await expect(resolveTenantForMspSsoDomain('acme.com')).resolves.toMatchObject({
      tenantId: 'tenant-1',
      ambiguous: false,
      claimStatus: 'advisory',
      eligibleForTakeover: true,
    });
    await expect(resolveTenantForMspSsoDomain('shared.com')).resolves.toEqual({
      ambiguous: true,
    });
    await expect(resolveTenantForMspSsoDomain('unknown.com')).resolves.toEqual({
      ambiguous: false,
    });
  });

  it('T020/T049: known mapped domain with tenant Microsoft configured returns only azure-ad', async () => {
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

  it('T055: EE verified claim uses tenant provider source', async () => {
    process.env.EDITION = 'ee';
    domainRows.push({
      tenant: 'tenant-1',
      domain: 'acme.com',
      is_active: true,
      claim_status: 'verified',
    });
    tenantSecrets.set('tenant-1:microsoft_client_id', 'ms-id');
    tenantSecrets.set('tenant-1:microsoft_client_secret', 'ms-secret');

    await expect(discoverMspSsoProviderOptions('person@acme.com')).resolves.toEqual({
      source: 'tenant',
      tenantId: 'tenant-1',
      providers: ['azure-ad'],
      domain: 'acme.com',
      ambiguous: false,
    });
  });

  it('T026: EE verified claim with tenant Google credentials returns tenant source and google provider', async () => {
    process.env.EDITION = 'ee';
    domainRows.push({
      tenant: 'tenant-1',
      domain: 'acme.com',
      is_active: true,
      claim_status: 'verified',
    });
    tenantSecrets.set('tenant-1:google_client_id', 'google-id');
    tenantSecrets.set('tenant-1:google_client_secret', 'google-secret');

    await expect(discoverMspSsoProviderOptions('person@acme.com')).resolves.toEqual({
      source: 'tenant',
      tenantId: 'tenant-1',
      providers: ['google'],
      domain: 'acme.com',
      ambiguous: false,
    });
  });

  it('T056: EE pending claim falls back to app provider routing', async () => {
    process.env.EDITION = 'ee';
    domainRows.push({
      tenant: 'tenant-1',
      domain: 'acme.com',
      is_active: true,
      claim_status: 'pending',
    });
    tenantSecrets.set('tenant-1:google_client_id', 'tenant-google-id');
    tenantSecrets.set('tenant-1:google_client_secret', 'tenant-google-secret');
    appSecrets.set('GOOGLE_OAUTH_CLIENT_ID', 'app-google-id');
    appSecrets.set('GOOGLE_OAUTH_CLIENT_SECRET', 'app-google-secret');

    await expect(discoverMspSsoProviderOptions('person@acme.com')).resolves.toEqual({
      source: 'app',
      providers: ['google'],
      domain: 'acme.com',
      ambiguous: false,
    });
  });

  it('T058: EE revoked claim no longer allows tenant takeover routing', async () => {
    process.env.EDITION = 'ee';
    domainRows.push({
      tenant: 'tenant-1',
      domain: 'acme.com',
      is_active: true,
      claim_status: 'revoked',
    });
    tenantSecrets.set('tenant-1:google_client_id', 'tenant-google-id');
    tenantSecrets.set('tenant-1:google_client_secret', 'tenant-google-secret');
    appSecrets.set('GOOGLE_OAUTH_CLIENT_ID', 'app-google-id');
    appSecrets.set('GOOGLE_OAUTH_CLIENT_SECRET', 'app-google-secret');

    await expect(discoverMspSsoProviderOptions('person@acme.com')).resolves.toEqual({
      source: 'app',
      providers: ['google'],
      domain: 'acme.com',
      ambiguous: false,
    });
  });

  it('T030/T057: EE ambiguous ownership falls back to app source', async () => {
    process.env.EDITION = 'ee';
    domainRows.push(
      { tenant: 'tenant-1', domain: 'shared.com', is_active: true, claim_status: 'verified' },
      { tenant: 'tenant-2', domain: 'shared.com', is_active: true, claim_status: 'verified' }
    );
    appSecrets.set('GOOGLE_OAUTH_CLIENT_ID', 'app-google-id');
    appSecrets.set('GOOGLE_OAUTH_CLIENT_SECRET', 'app-google-secret');

    await expect(discoverMspSsoProviderOptions('person@shared.com')).resolves.toEqual({
      source: 'app',
      providers: ['google'],
      domain: 'shared.com',
      ambiguous: true,
    });
  });

  it('T059: CE advisory claim can route to tenant provider source', async () => {
    process.env.EDITION = 'ce';
    domainRows.push({
      tenant: 'tenant-1',
      domain: 'advisory.io',
      is_active: true,
      claim_status: 'advisory',
    });
    tenantSecrets.set('tenant-1:google_client_id', 'tenant-google-id');
    tenantSecrets.set('tenant-1:google_client_secret', 'tenant-google-secret');

    await expect(discoverMspSsoProviderOptions('person@advisory.io')).resolves.toEqual({
      source: 'tenant',
      tenantId: 'tenant-1',
      providers: ['google'],
      domain: 'advisory.io',
      ambiguous: false,
    });
  });

  it('T032: CE unregistered domain returns app-level fallback providers', async () => {
    process.env.EDITION = 'ce';
    appSecrets.set('MICROSOFT_OAUTH_CLIENT_ID', 'app-ms-id');
    appSecrets.set('MICROSOFT_OAUTH_CLIENT_SECRET', 'app-ms-secret');

    await expect(discoverMspSsoProviderOptions('person@unregistered.com')).resolves.toEqual({
      source: 'app',
      providers: ['azure-ad'],
      domain: 'unregistered.com',
      ambiguous: false,
    });
  });

  it('T033: unresolved domain in both editions returns app-level fallback provider set', async () => {
    appSecrets.set('GOOGLE_OAUTH_CLIENT_ID', 'app-google-id');
    appSecrets.set('GOOGLE_OAUTH_CLIENT_SECRET', 'app-google-secret');

    for (const edition of ['ce', 'ee'] as const) {
      process.env.EDITION = edition;
      await expect(discoverMspSsoProviderOptions(`person@unknown-${edition}.com`)).resolves.toEqual({
        source: 'app',
        providers: ['google'],
        domain: `unknown-${edition}.com`,
        ambiguous: false,
      });
    }
  });

  it('T021: known mapped domain with both tenant providers configured returns google and azure-ad', async () => {
    domainRows.push({ tenant: 'tenant-1', domain: 'acme.com', is_active: true });
    tenantSecrets.set('tenant-1:google_client_id', 'google-id');
    tenantSecrets.set('tenant-1:google_client_secret', 'google-secret');
    tenantSecrets.set('tenant-1:microsoft_client_id', 'ms-id');
    tenantSecrets.set('tenant-1:microsoft_client_secret', 'ms-secret');

    await expect(discoverMspSsoProviderOptions('person@acme.com')).resolves.toEqual({
      source: 'tenant',
      tenantId: 'tenant-1',
      providers: ['google', 'azure-ad'],
      domain: 'acme.com',
      ambiguous: false,
    });
  });

  it('T022: known mapped domain with no tenant providers configured returns an empty provider list', async () => {
    domainRows.push({ tenant: 'tenant-1', domain: 'acme.com', is_active: true });

    await expect(discoverMspSsoProviderOptions('person@acme.com')).resolves.toEqual({
      source: 'tenant',
      tenantId: 'tenant-1',
      providers: [],
      domain: 'acme.com',
      ambiguous: false,
    });
  });

  it('T023: unresolved domain with app Google fallback configured returns only google', async () => {
    appSecrets.set('GOOGLE_OAUTH_CLIENT_ID', 'google-id');
    appSecrets.set('GOOGLE_OAUTH_CLIENT_SECRET', 'google-secret');

    await expect(discoverMspSsoProviderOptions('person@unknown.com')).resolves.toEqual({
      source: 'app',
      providers: ['google'],
      domain: 'unknown.com',
      ambiguous: false,
    });
  });

  it('T024: unresolved domain with app Microsoft fallback configured returns only azure-ad', async () => {
    appSecrets.set('MICROSOFT_OAUTH_CLIENT_ID', 'ms-id');
    appSecrets.set('MICROSOFT_OAUTH_CLIENT_SECRET', 'ms-secret');

    await expect(discoverMspSsoProviderOptions('person@unknown.com')).resolves.toEqual({
      source: 'app',
      providers: ['azure-ad'],
      domain: 'unknown.com',
      ambiguous: false,
    });
  });

  it('T025: unresolved domain with no app fallback providers configured returns an empty provider list', async () => {
    await expect(discoverMspSsoProviderOptions('person@unknown.com')).resolves.toEqual({
      source: 'app',
      providers: [],
      domain: 'unknown.com',
      ambiguous: false,
    });
  });

  it('T050/T051: ambiguous domains resolve as unresolved and inactive mappings are ignored', async () => {
    domainRows.push(
      { tenant: 'tenant-1', domain: 'shared.com', is_active: true },
      { tenant: 'tenant-2', domain: 'shared.com', is_active: true },
      { tenant: 'tenant-3', domain: 'inactive.com', is_active: false }
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
    await expect(discoverMspSsoProviderOptions('person@inactive.com')).resolves.toEqual({
      source: 'app',
      providers: ['google'],
      domain: 'inactive.com',
      ambiguous: false,
    });
  });

  it('T026/T041: discovery contract avoids user lookup and resolver falls back when discovery is missing', async () => {
    domainRows.push({ tenant: 'tenant-1', domain: 'acme.com', is_active: true, claim_status: 'advisory' });
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
          domain: 'acme.com',
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
          domain: 'acme.com',
          providers: ['azure-ad'],
          issuedAt: 1,
          expiresAt: Number.MAX_SAFE_INTEGER,
          nonce: 'nonce-2',
        },
      })
    ).resolves.toEqual({ resolved: false });

    await expect(resolveMspSsoCredentialSource({ provider: 'google', email: 'user@unknown.com' })).resolves.toEqual({
      resolved: true,
      source: 'app',
    });
    expect(dbMock).not.toHaveBeenCalledWith('users');
  });

  it('T038/T040: resolver revalidates tenant lifecycle and falls back to app source when claim is no longer eligible', async () => {
    domainRows.push({
      tenant: 'tenant-1',
      domain: 'acme.com',
      is_active: true,
      claim_status: 'revoked',
    });
    tenantSecrets.set('tenant-1:google_client_id', 'google-id');
    tenantSecrets.set('tenant-1:google_client_secret', 'google-secret');
    appSecrets.set('GOOGLE_OAUTH_CLIENT_ID', 'app-google-id');
    appSecrets.set('GOOGLE_OAUTH_CLIENT_SECRET', 'app-google-secret');

    await expect(
      resolveMspSsoCredentialSource({
        provider: 'google',
        email: 'person@acme.com',
        discovery: {
          source: 'tenant',
          tenantId: 'tenant-1',
          domain: 'acme.com',
          providers: ['google'],
          issuedAt: 1,
          expiresAt: Number.MAX_SAFE_INTEGER,
          nonce: 'nonce-stale-1',
        },
      })
    ).resolves.toEqual({
      resolved: true,
      source: 'app',
    });
  });

  it('T037: resolver in EE with verified claim context selects tenant credential source', async () => {
    process.env.EDITION = 'ee';
    domainRows.push({
      tenant: 'tenant-1',
      domain: 'acme.com',
      is_active: true,
      claim_status: 'verified',
    });
    tenantSecrets.set('tenant-1:microsoft_client_id', 'tenant-ms-id');
    tenantSecrets.set('tenant-1:microsoft_client_secret', 'tenant-ms-secret');

    await expect(
      resolveMspSsoCredentialSource({
        provider: 'azure-ad',
        email: 'person@acme.com',
        discovery: {
          source: 'tenant',
          tenantId: 'tenant-1',
          domain: 'acme.com',
          providers: ['azure-ad'],
          issuedAt: 1,
          expiresAt: Number.MAX_SAFE_INTEGER,
          nonce: 'nonce-verified-1',
        },
      })
    ).resolves.toEqual({
      resolved: true,
      source: 'tenant',
      tenantId: 'tenant-1',
    });
  });

  it('T028/T029: signs/verifies discovery cookies and enforces expiry with secret-safe payloads', () => {
    const discovery = createSignedMspSsoDiscoveryCookie({
      source: 'tenant',
      tenantId: 'tenant-1',
      domain: 'acme.com',
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
      domain: 'acme.com',
      providers: ['google', 'azure-ad'],
    });
    expect(
      parseAndVerifyMspSsoDiscoveryCookie({
        value: discovery.value,
        secret: 'unit-secret',
        now: 1_700_000_400_001,
      })
    ).toBeNull();

    const invalidDomainDiscovery = createSignedMspSsoDiscoveryCookie({
      source: 'app',
      domain: 'bad domain value',
      providers: ['google'],
      secret: 'unit-secret',
      now: 1_700_000_000_000,
      ttlSeconds: 300,
    });
    expect(
      parseAndVerifyMspSsoDiscoveryCookie({
        value: invalidDomainDiscovery.value,
        secret: 'unit-secret',
        now: 1_700_000_010_000,
      })
    ).toBeNull();

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

  it('T043: resolution cookie payload remains signed, short-lived, and free of provider secrets', () => {
    const resolution = createSignedMspSsoResolutionCookie({
      provider: 'google',
      source: 'app',
      secret: 'unit-secret',
      now: 1_700_000_000_000,
      ttlSeconds: 300,
    });

    expect(resolution.value).toContain('.');
    expect(resolution.value).not.toContain('client_secret');

    expect(
      parseAndVerifyMspSsoResolutionCookie({
        value: resolution.value,
        secret: 'unit-secret',
        now: 1_700_000_050_000,
      })
    ).toMatchObject({
      provider: 'google',
      source: 'app',
    });

    expect(
      parseAndVerifyMspSsoResolutionCookie({
        value: resolution.value,
        secret: 'unit-secret',
        now: 1_700_000_400_001,
      })
    ).toBeNull();
  });
});
