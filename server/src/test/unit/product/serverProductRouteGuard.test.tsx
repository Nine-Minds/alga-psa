import { describe, expect, it, vi } from 'vitest';

const getCurrentTenantProductMock = vi.fn();

vi.mock('@/lib/productAccess', () => ({
  getCurrentTenantProduct: getCurrentTenantProductMock,
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
});
