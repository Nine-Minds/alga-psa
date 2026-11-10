import { beforeEach, describe, expect, it, vi } from 'vitest';

const getTenantIdBySlugMock = vi.fn();
const portalDomains: Array<{ domain: string; tenant: string; status: string }> = [];

vi.mock('@alga-psa/db', () => ({
  getTenantIdBySlug: (...args: unknown[]) => getTenantIdBySlugMock(...args),
  isValidTenantSlug: (value: string) => /^[a-z0-9]{12}$/.test(value),
}));

vi.mock('@alga-psa/db/admin', () => ({
  getAdminConnection: async () => (table: string) => {
    if (table !== 'portal_domains') {
      throw new Error(`Unexpected table: ${table}`);
    }

    const filters: Record<string, unknown> = {};
    return {
      select: () => ({
        where(conditions: Record<string, unknown>) {
          Object.assign(filters, conditions);
          return {
            async first() {
              return portalDomains.find((row) =>
                Object.entries(filters).every(([key, value]) => row[key as keyof typeof row] === value)
              );
            },
          };
        },
      }),
    };
  },
}));

const edition = vi.hoisted(() => ({ value: 'ee' as 'ee' | 'ce' }));
const tenantCreds = vi.hoisted(() => ({ ready: new Set<string>() }));
const appCreds = vi.hoisted(() => ({ ready: new Set<string>() }));
const policyState = vi.hoisted(() => ({ clientPortalSsoProviders: null as string[] | null, fail: false }));
const warn = vi.hoisted(() => vi.fn());

vi.mock('./mspSsoResolution', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./mspSsoResolution')>()),
  getMspSsoEdition: () => edition.value,
  hasTenantProviderCredentials: async (_tenant: string, provider: string) => tenantCreds.ready.has(provider),
  hasAppFallbackProviderCredentials: async (provider: string) => appCreds.ready.has(provider),
}));

vi.mock('../authPolicyStore', () => ({
  loadTenantAuthPolicy: async () => {
    if (policyState.fail) throw new Error('db down');
    return { clientPortalSsoProviders: policyState.clientPortalSsoProviders };
  },
}));

vi.mock('@alga-psa/core/logger', () => ({
  default: { warn: (...args: unknown[]) => warn(...args), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const {
  resolveClientPortalSsoTenantContext,
  listClientPortalAvailableSsoProviders,
  discoverClientPortalSsoProviders,
  getClientPortalSignInSsoProviders,
} = await import('./clientPortalSsoResolution');

describe('client portal SSO tenant context resolution', () => {
  beforeEach(() => {
    portalDomains.length = 0;
    getTenantIdBySlugMock.mockReset();
  });

  it('resolves when slug and portal domain point to the same tenant', async () => {
    getTenantIdBySlugMock.mockResolvedValueOnce('tenant-a');
    portalDomains.push({ domain: 'portal.example.test', tenant: 'tenant-a', status: 'active' });

    await expect(
      resolveClientPortalSsoTenantContext({
        tenantSlug: 'abc123def456',
        portalDomain: 'portal.example.test',
      })
    ).resolves.toEqual({ tenantId: 'tenant-a' });
  });

  it('rejects tenant context when slug and portal domain disagree', async () => {
    getTenantIdBySlugMock.mockResolvedValueOnce('tenant-b');
    portalDomains.push({ domain: 'portal.example.test', tenant: 'tenant-a', status: 'active' });

    await expect(
      resolveClientPortalSsoTenantContext({
        tenantSlug: 'abc123def456',
        portalDomain: 'portal.example.test',
      })
    ).resolves.toEqual({});
  });
});

describe('client portal SSO availability and discovery', () => {
  beforeEach(() => {
    edition.value = 'ee';
    tenantCreds.ready.clear();
    appCreds.ready.clear();
    policyState.clientPortalSsoProviders = null;
    policyState.fail = false;
    warn.mockReset();
    portalDomains.length = 0;
    getTenantIdBySlugMock.mockReset();
  });

  it('EE with app Google and Microsoft and no saved list offers both', async () => {
    appCreds.ready.add('google');
    appCreds.ready.add('azure-ad');
    await expect(discoverClientPortalSsoProviders('tenant-a')).resolves.toEqual(['google', 'azure-ad']);
  });

  it('counts a tenant-owned Keycloak realm as available', async () => {
    tenantCreds.ready.add('keycloak');
    await expect(listClientPortalAvailableSsoProviders('tenant-a')).resolves.toEqual(['keycloak']);
    await expect(discoverClientPortalSsoProviders('tenant-a')).resolves.toEqual(['keycloak']);
  });

  it('counts tenant credentials or app credentials per provider', async () => {
    tenantCreds.ready.add('azure-ad');
    appCreds.ready.add('google');
    appCreds.ready.add('keycloak');
    await expect(listClientPortalAvailableSsoProviders('tenant-a')).resolves.toEqual([
      'google',
      'azure-ad',
      'keycloak',
    ]);
  });

  it('narrows discovery to the saved list even when other app credentials exist', async () => {
    appCreds.ready.add('google');
    appCreds.ready.add('azure-ad');
    policyState.clientPortalSsoProviders = ['azure-ad'];
    await expect(discoverClientPortalSsoProviders('tenant-a')).resolves.toEqual(['azure-ad']);
    // Availability is unaffected by the list: the settings card still lists both.
    await expect(listClientPortalAvailableSsoProviders('tenant-a')).resolves.toEqual(['google', 'azure-ad']);
  });

  it('an empty saved list offers nothing', async () => {
    appCreds.ready.add('google');
    policyState.clientPortalSsoProviders = [];
    await expect(discoverClientPortalSsoProviders('tenant-a')).resolves.toEqual([]);
  });

  it('offers nothing on CE', async () => {
    edition.value = 'ce';
    appCreds.ready.add('google');
    appCreds.ready.add('keycloak');
    tenantCreds.ready.add('azure-ad');
    await expect(listClientPortalAvailableSsoProviders('tenant-a')).resolves.toEqual([]);
    await expect(discoverClientPortalSsoProviders('tenant-a')).resolves.toEqual([]);
  });

  it('sign-in page list resolves the tenant from slug or vanity domain and applies the saved list', async () => {
    appCreds.ready.add('google');
    appCreds.ready.add('azure-ad');
    policyState.clientPortalSsoProviders = ['azure-ad'];

    getTenantIdBySlugMock.mockResolvedValueOnce('tenant-a');
    await expect(getClientPortalSignInSsoProviders({ tenantSlug: 'abc123def456' })).resolves.toEqual(['azure-ad']);

    portalDomains.push({ domain: 'portal.example.test', tenant: 'tenant-a', status: 'active' });
    await expect(getClientPortalSignInSsoProviders({ portalDomain: 'portal.example.test' })).resolves.toEqual([
      'azure-ad',
    ]);
  });

  it('sign-in page list is empty when the tenant cannot be resolved, and when the lookup throws', async () => {
    appCreds.ready.add('google');
    getTenantIdBySlugMock.mockResolvedValueOnce(undefined);
    await expect(getClientPortalSignInSsoProviders({ tenantSlug: 'abc123def456' })).resolves.toEqual([]);

    getTenantIdBySlugMock.mockResolvedValueOnce('tenant-a');
    policyState.fail = true;
    await expect(getClientPortalSignInSsoProviders({ tenantSlug: 'abc123def456' })).resolves.toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
