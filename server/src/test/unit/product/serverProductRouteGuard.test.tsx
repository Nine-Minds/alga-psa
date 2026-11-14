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

  describe('the server-side surface gate (S12 F029)', () => {
    afterEach(() => {
      principalOverride = null;
    });

    const NOT_FOUND = /NEXT_HTTP_ERROR_FALLBACK;404|NEXT_NOT_FOUND/;

    // /msp/settings, /msp/technician-dispatch and /msp/schedule carry no per-page guard of their own.
    it.each(['/msp/settings', '/msp/settings/users', '/msp/technician-dispatch', '/msp/schedule', '/msp/dashboard/widgets', '/msp/anything-unmatched'])(
      'hits notFound() for a seat principal on %s, before any page renders',
      async (pathname) => {
        const mod = await import('@/lib/serverProductRouteGuard');
        expect(() => mod.assertPrincipalRouteOpen({ productCode: 'psa', surfaceKind: 'co_managed_seat' }, pathname)).toThrow(NOT_FOUND);

        principalOverride = { productCode: 'psa', surfaceKind: 'co_managed_seat' };
        await expect(mod.enforcePrincipalSurfaceRoute(pathname)).rejects.toThrow(NOT_FOUND);
      },
    );

    // next/navigation's redirect() throws NEXT_REDIRECT with the target in its digest.
    const REDIRECT_TO_TICKETS = expect.objectContaining({ message: 'NEXT_REDIRECT', digest: expect.stringMatching(/;\/msp\/tickets;/) });

    // Sign-in, `/`, `/msp` and the logo send every user to the MSP home; a seat technician lands in its surface.
    it.each(['/msp', '/msp/dashboard', '/msp/dashboard?from=signin', '/desk/dashboard'])(
      'redirects a seat principal asking for the MSP home (%s) to its own home, not a not-found page',
      async (pathname) => {
        const mod = await import('@/lib/serverProductRouteGuard');
        expect(() => mod.assertPrincipalRouteOpen({ productCode: 'psa', surfaceKind: 'co_managed_seat' }, pathname)).toThrowError(REDIRECT_TO_TICKETS);

        principalOverride = { productCode: 'psa', surfaceKind: 'co_managed_seat' };
        await expect(mod.enforcePrincipalSurfaceRoute(pathname)).rejects.toEqual(REDIRECT_TO_TICKETS);
      },
    );

    it('answers not found for the home of a kind that declares none', async () => {
      const mod = await import('@/lib/serverProductRouteGuard');
      expect(() => mod.assertPrincipalRouteOpen({ productCode: 'psa', surfaceKind: 'unregistered_kind' }, '/msp/dashboard')).toThrow(NOT_FOUND);
    });

    it.each(['/msp/tickets', '/msp/tickets/abc', '/msp/projects', '/msp/assets', '/msp/documents', '/msp/time-entry'])(
      'lets a seat principal through on the operational route %s',
      async (pathname) => {
        const mod = await import('@/lib/serverProductRouteGuard');
        principalOverride = { productCode: 'psa', surfaceKind: 'co_managed_seat' };
        await expect(mod.enforcePrincipalSurfaceRoute(pathname)).resolves.toBeUndefined();
      },
    );

    it.each(['psa', 'algadesk', 'co_managed'])('never acts on an ordinary %s principal, whatever the route', async (productCode) => {
      const mod = await import('@/lib/serverProductRouteGuard');
      principalOverride = { productCode };
      for (const pathname of ['/msp/settings', '/msp/technician-dispatch', '/msp/schedule', '/msp/projects', '/msp/billing', '/msp/anything-unmatched']) {
        expect(() => mod.assertPrincipalRouteOpen({ productCode } as never, pathname)).not.toThrow();
        await expect(mod.enforcePrincipalSurfaceRoute(pathname)).resolves.toBeUndefined();
      }
    });

    it('runs from the @surface slot on every navigation, and from the layout on a hard load', async () => {
      const slot = (await import('@/app/msp/@surface/[...catchAll]/page')).default;
      principalOverride = { productCode: 'psa', surfaceKind: 'co_managed_seat' };
      await expect(slot({ params: Promise.resolve({ catchAll: ['settings', 'users'] }) })).rejects.toThrow(NOT_FOUND);
      await expect(slot({ params: Promise.resolve({ catchAll: ['tickets', 'abc'] }) })).resolves.toBeNull();
      await expect(slot({ params: Promise.resolve({ catchAll: ['billing'] }) })).rejects.toThrow(NOT_FOUND);

      principalOverride = { productCode: 'psa' };
      await expect(slot({ params: Promise.resolve({ catchAll: ['settings'] }) })).resolves.toBeNull();

      const { readFileSync } = await import('node:fs');
      const { join } = await import('node:path');
      const layout = readFileSync(join(__dirname, '../../../app/msp/layout.tsx'), 'utf8');
      expect(layout).toContain('assertPrincipalRouteOpen(principal, pathname)');
      expect(layout).toContain('{surface}');

      // Next refuses to start when parallel slots put an optional and a required catch-all, or two slug names,
      // at one level: the gate's segment must be the same required catch-all as @modal's.
      const { readdirSync } = await import('node:fs');
      const slots = join(__dirname, '../../../app/msp');
      const catchAllSegments = ['@modal', '@surface']
        .flatMap((slot) => readdirSync(join(slots, slot)).filter((entry) => entry.startsWith('[')));
      expect(new Set(catchAllSegments)).toEqual(new Set(['[...catchAll]']));
    });
  });
});
