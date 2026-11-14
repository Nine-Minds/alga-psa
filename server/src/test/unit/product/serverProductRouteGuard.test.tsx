import { afterEach, describe, expect, it, vi } from 'vitest';

const getCurrentTenantProductMock = vi.fn();
// Set by a test of a principal kind. Unset, the principal is the tenant's product alone, as for any MSP user.
let principalOverride: { productCode: string; surfaceKind?: string | null } | null = null;

vi.mock('@/lib/productAccess', () => ({
  getCurrentTenantProduct: getCurrentTenantProductMock,
  getCurrentProductPrincipal: async () => principalOverride ?? { productCode: await getCurrentTenantProductMock() },
}));

describe('serverProductRouteGuard', () => {
  it('resolves algadesk product and route behavior for explicit pathnames', async () => {
    getCurrentTenantProductMock.mockResolvedValue('algadesk');
    const mod = await import('@/lib/serverProductRouteGuard');

    const result = await mod.resolveServerProductRouteBehavior({ pathname: '/msp/projects' });

    expect(result).toEqual({ productCode: 'algadesk', behavior: 'upgrade_boundary' });
  });

  it('resolves psa route behavior as allowed for representative excluded algadesk paths', async () => {
    getCurrentTenantProductMock.mockResolvedValue('psa');
    const mod = await import('@/lib/serverProductRouteGuard');

    const result = await mod.resolveServerProductRouteBehavior({ pathname: '/client-portal/projects' });

    expect(result).toEqual({ productCode: 'psa', behavior: 'allowed' });
  });

  it.each([['co_managed', 'allowed'], ['psa', 'allowed'], ['algadesk', 'upgrade_boundary']])('resolves %s on /client-portal/projects as %s', async (product, behavior) => {
    getCurrentTenantProductMock.mockResolvedValue(product);
    const mod = await import('@/lib/serverProductRouteGuard');

    expect(await mod.resolveServerProductRouteBehavior({ pathname: '/client-portal/projects' })).toEqual({ productCode: product, behavior });
  });

  describe('for a seat principal', () => {
    const seat = { productCode: 'psa', surfaceKind: 'co_managed_seat' };

    afterEach(() => {
      principalOverride = null;
    });

    it.each([
      ['/msp/tickets', 'allowed'],
      ['/msp/projects', 'allowed'],
      ['/msp/assets', 'allowed'],
      ['/msp/documents', 'allowed'],
      ['/msp/time-entry', 'allowed'],
      ['/msp/billing', 'not_found'],
      ['/msp/settings', 'not_found'],
      ['/msp/settings/users', 'not_found'],
      ['/msp/technician-dispatch', 'not_found'],
      ['/msp/schedule', 'not_found'],
      ['/msp/reports', 'not_found'],
      ['/msp/co-managed', 'not_found'],
      ['/msp/anything-unmatched', 'not_found'],
    ])('resolves %s as %s', async (pathname, behavior) => {
      principalOverride = seat;
      const mod = await import('@/lib/serverProductRouteGuard');

      expect(await mod.resolveServerProductRouteBehavior({ pathname })).toEqual({
        productCode: 'psa',
        surfaceKind: 'co_managed_seat',
        behavior,
      });
    });

    it('answers not_found through the guard that pages and layouts call', async () => {
      principalOverride = seat;
      const mod = await import('@/lib/serverProductRouteGuard');

      await expect(mod.enforceServerProductRoute({ pathname: '/msp/billing', scope: 'msp' })).rejects.toThrow();
      await expect(mod.enforceServerProductRoute({ pathname: '/msp/tickets', scope: 'msp' })).resolves.toBeNull();
    });
  });
});
