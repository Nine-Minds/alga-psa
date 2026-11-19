import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveCoManagedPurchaseDiscovery } from '../../lib/co-managed/purchaseDiscovery';
import { getCoManagedPurchaseDiscoveryAction } from '../../lib/actions/coManagedPurchaseDiscoveryActions';

const mocks = vi.hoisted(() => ({
  surface: vi.fn(), permission: vi.fn(), license: vi.fn(), tenantRow: vi.fn(), tenantDbArgs: [] as string[],
  user: { user_id: 'actor', tenant: 'sponsor', user_type: 'internal' } as Record<string, unknown>,
}));
vi.mock('@alga-psa/auth', () => ({ withAuth: (handler: any) => () => handler(mocks.user, { tenant: mocks.user.tenant }) }));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: mocks.permission }));
vi.mock('@alga-psa/licensing', () => ({ isCoManagedPurchaseSurfaceOpen: mocks.surface, getLicenseStateRow: mocks.license }));
vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async (tenant: string) => ({ knex: { tenant } }),
  tenantDb: (_knex: unknown, tenant: string) => ({ table: (name: string) => { mocks.tenantDbArgs.push(`${tenant}:${name}`); return { first: mocks.tenantRow }; } }),
}));

const principal = () => mocks.user as { user_type: string; tenant?: string };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.tenantDbArgs = [];
  Object.assign(mocks.user, { tenant: 'sponsor', user_type: 'internal' });
  mocks.surface.mockResolvedValue(true);
  mocks.permission.mockResolvedValue(true);
  mocks.license.mockResolvedValue(null);
  mocks.tenantRow.mockResolvedValue({ product_code: 'psa', plan: 'pro', billing_source: 'stripe' });
});

describe('co-managed first-purchase discovery (commercial eligibility)', () => {
  it('a hosted Pro PSA internal account administrator with the surface open is eligible', async () => {
    expect(await resolveCoManagedPurchaseDiscovery(principal(), 'sponsor')).toEqual({ eligible: true });
    expect(mocks.permission).toHaveBeenCalledWith(expect.anything(), 'account_management', 'read');
    expect(mocks.permission).toHaveBeenCalledWith(expect.anything(), 'account_management', 'update');
    // The sponsor's own tenant row was read; nothing here asks for co_management permission.
    expect(mocks.tenantDbArgs).toEqual(['sponsor:tenants']);
    expect(mocks.permission).not.toHaveBeenCalledWith(expect.anything(), 'co_management', expect.anything());
  });

  it.each([
    ['client portal actor', () => { mocks.user.user_type = 'client'; }, 'not_internal'],
    ['another tenant\'s principal', () => { mocks.user.tenant = 'other'; }, 'tenant_mismatch'],
    ['release flag / kill switch / missing price', () => { mocks.surface.mockResolvedValue(false); }, 'surface_closed'],
    ['no account update', () => { mocks.permission.mockImplementation(async (_u: unknown, _r: string, action: string) => action === 'read'); }, 'no_permission'],
    ['no account read', () => { mocks.permission.mockImplementation(async (_u: unknown, _r: string, action: string) => action === 'update'); }, 'no_permission'],
    ['non-Pro plan', () => { mocks.tenantRow.mockResolvedValue({ product_code: 'psa', plan: 'solo', billing_source: 'stripe' }); }, 'not_hosted_pro'],
    ['manual billing', () => { mocks.tenantRow.mockResolvedValue({ product_code: 'psa', plan: 'pro', billing_source: 'manual' }); }, 'not_hosted_pro'],
    ['an unrelated product', () => { mocks.tenantRow.mockResolvedValue({ product_code: 'algadesk', plan: 'pro', billing_source: 'stripe' }); }, 'not_hosted_pro'],
    ['a co-managed customer workspace', () => { mocks.tenantRow.mockResolvedValue({ product_code: 'co_managed', plan: 'pro', billing_source: 'stripe' }); }, 'not_hosted_pro'],
    ['a self-hosted license', () => { mocks.license.mockResolvedValue({ license: 'row' }); }, 'self_host'],
  ])('%s: closed', async (_name, arrange, reason) => {
    arrange();
    expect(await resolveCoManagedPurchaseDiscovery(principal(), 'sponsor')).toEqual({ eligible: false, reason });
  });

  it('a missing permission reads no tenant data and never probes the offer', async () => {
    mocks.permission.mockResolvedValue(false);
    expect(await resolveCoManagedPurchaseDiscovery(principal(), 'sponsor')).toEqual({ eligible: false, reason: 'no_permission' });
    expect(mocks.tenantDbArgs).toEqual([]);
    expect(mocks.surface).not.toHaveBeenCalled();
  });

  it('answers sidebar discovery for a retained tenant with no plan while the offer probe would stall', async () => {
    mocks.tenantRow.mockResolvedValue({ product_code: 'psa', plan: null, billing_source: 'stripe' });
    const probeStarted = Promise.withResolvers<string>();
    mocks.surface.mockImplementation(() => {
      probeStarted.resolve('offer probe started');
      return new Promise<boolean>(() => {});
    });

    expect(await Promise.race([getCoManagedPurchaseDiscoveryAction(), probeStarted.promise])).toBe(false);
  });

  it('the sidebar action answers with the same decision as a bare boolean (no billing data)', async () => {
    expect(await getCoManagedPurchaseDiscoveryAction()).toBe(true);
    mocks.tenantRow.mockResolvedValue({ product_code: 'psa', plan: 'pro', billing_source: 'manual' });
    expect(await getCoManagedPurchaseDiscoveryAction()).toBe(false);
  });
});
