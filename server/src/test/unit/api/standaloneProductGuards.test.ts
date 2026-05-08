import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@alga-psa/auth', () => ({
  getSession: vi.fn(),
}));

vi.mock('@/lib/productAccess', async () => {
  const actual = await vi.importActual<typeof import('@/lib/productAccess')>('@/lib/productAccess');
  return {
    ...actual,
    assertTenantProductAccess: vi.fn(),
  };
});

import { getSession } from '@alga-psa/auth';
import {
  ProductAccessError,
  assertTenantProductAccess,
} from '@/lib/productAccess';
import { assertSessionProductAccess } from '@/lib/api/standaloneProductGuards';

describe('assertSessionProductAccess', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns structured PRODUCT_ACCESS_DENIED when product gate denies', async () => {
    vi.mocked(getSession).mockResolvedValue({ user: { tenant: 'tenant-a' } } as any);
    vi.mocked(assertTenantProductAccess).mockRejectedValue(
      new ProductAccessError('integrations', 'algadesk', 'Denied for this product'),
    );

    const response = await assertSessionProductAccess({
      capability: 'integrations',
      allowedProducts: ['psa'],
    });

    expect(response).not.toBeNull();
    expect(response?.status).toBe(403);
    await expect(response?.json()).resolves.toEqual({
      error: {
        code: 'PRODUCT_ACCESS_DENIED',
        message: 'Denied for this product',
        details: {
          capability: 'integrations',
          productCode: 'algadesk',
        },
      },
    });
  });

  it('returns null when tenant product is allowed', async () => {
    vi.mocked(getSession).mockResolvedValue({ user: { tenant: 'tenant-a' } } as any);
    vi.mocked(assertTenantProductAccess).mockResolvedValue('psa');

    const response = await assertSessionProductAccess({
      capability: 'extensions',
      allowedProducts: ['psa'],
    });

    expect(response).toBeNull();
  });
});
