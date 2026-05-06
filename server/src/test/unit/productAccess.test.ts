import { beforeEach, describe, expect, it, vi } from 'vitest';

const getSessionMock = vi.fn();
const getAdminConnectionMock = vi.fn();
const tenantQueryFirstMock = vi.fn();

vi.mock('@alga-psa/auth', () => ({
  getSession: getSessionMock,
}));

vi.mock('@alga-psa/db/admin', () => ({
  getAdminConnection: getAdminConnectionMock,
}));

describe('product access helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    getAdminConnectionMock.mockResolvedValue((table: string) => {
      expect(table).toBe('tenants');
      return {
        where: () => ({
          select: () => ({
            first: tenantQueryFirstMock,
          }),
        }),
      };
    });
  });

  it('returns psa when tenant product_code is null', async () => {
    tenantQueryFirstMock.mockResolvedValue({ product_code: null });

    const { getTenantProduct } = await import('../../lib/productAccess');
    await expect(getTenantProduct('tenant-1')).resolves.toBe('psa');
  });

  it('returns algadesk when tenant product_code is configured', async () => {
    tenantQueryFirstMock.mockResolvedValue({ product_code: 'algadesk' });

    const { getTenantProduct } = await import('../../lib/productAccess');
    await expect(getTenantProduct('tenant-1')).resolves.toBe('algadesk');
  });

  it('throws structured ProductAccessError for unknown product_code', async () => {
    tenantQueryFirstMock.mockResolvedValue({ product_code: 'legacy' });

    const { getTenantProduct, ProductAccessError } = await import('../../lib/productAccess');
    await expect(getTenantProduct('tenant-1')).rejects.toBeInstanceOf(ProductAccessError);
  });

  it('assertProductAccess allows configured product capability', async () => {
    const { assertProductAccess } = await import('../../lib/productAccess');
    const resolved = assertProductAccess({
      capability: 'tickets.read',
      productCode: 'algadesk',
      allowedProducts: ['psa', 'algadesk'],
    });

    expect(resolved).toBe('algadesk');
  });

  it('assertProductAccess throws ProductAccessError with stable fields when denied', async () => {
    const { assertProductAccess, ProductAccessError } = await import('../../lib/productAccess');

    try {
      assertProductAccess({
        capability: 'billing.read',
        productCode: 'algadesk',
        allowedProducts: ['psa'],
      });
      throw new Error('Expected assertProductAccess to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(ProductAccessError);
      expect(error).toMatchObject({
        name: 'ProductAccessError',
        status: 403,
        statusCode: 403,
        code: 'PRODUCT_ACCESS_DENIED',
        capability: 'billing.read',
        productCode: 'algadesk',
      });
    }
  });

  it('toProductAccessDeniedResponse returns structured 403 payload', async () => {
    const { ProductAccessError, toProductAccessDeniedResponse } = await import('../../lib/productAccess');
    const error = new ProductAccessError('billing.read', 'algadesk');
    const response = toProductAccessDeniedResponse(error);
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload).toMatchObject({
      error: {
        code: 'PRODUCT_ACCESS_DENIED',
        details: {
          capability: 'billing.read',
          productCode: 'algadesk',
        },
      },
    });
  });

  it('getCurrentTenantProduct falls back to psa when no session tenant is available', async () => {
    getSessionMock.mockResolvedValue({ user: {} });

    const { getCurrentTenantProduct } = await import('../../lib/productAccess');
    await expect(getCurrentTenantProduct()).resolves.toBe('psa');
  });

  it('getCurrentTenantProduct resolves tenant product from session tenant', async () => {
    getSessionMock.mockResolvedValue({ user: { tenant: 'tenant-123' } });
    tenantQueryFirstMock.mockResolvedValue({ product_code: 'algadesk' });

    const { getCurrentTenantProduct } = await import('../../lib/productAccess');
    await expect(getCurrentTenantProduct()).resolves.toBe('algadesk');
  });
});
