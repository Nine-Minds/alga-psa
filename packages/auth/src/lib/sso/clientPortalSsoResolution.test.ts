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

const { resolveClientPortalSsoTenantContext } = await import('./clientPortalSsoResolution');

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
