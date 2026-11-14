import { beforeEach, describe, expect, it, vi } from 'vitest';

// The one read behind every product-surface decision. Mocked at its boundary so the guards' decisions are
// tested against the registry's real data.
const loadProductPrincipal = vi.fn();
vi.mock('@shared/services/productPrincipal', () => ({
  loadProductPrincipal: (...args: unknown[]) => loadProductPrincipal(...args),
}));
vi.mock('@alga-psa/db', () => ({ tenantDb: vi.fn() }));
vi.mock('@alga-psa/db/admin', () => ({ getAdminConnection: vi.fn() }));
vi.mock('@alga-psa/auth', () => ({ getSession: vi.fn(async () => ({ user: { id: 'user-1', tenant: 'tenant-1' } })) }));

import { assertPsaOnlyTenantAccess, ProductAccessError as SharedProductAccessError } from '@shared/services/productAccessGuard';
import { assertTenantProductAccess, ProductAccessError, getCurrentProductPrincipal } from '../../../lib/productAccess';
import { CO_MANAGED_SEAT_SURFACE } from '@shared/services/productSurfaceKinds';

const ordinary = { rawProductCode: 'psa', surfaceKind: null };
const seat = { rawProductCode: 'psa', surfaceKind: CO_MANAGED_SEAT_SURFACE };

describe('server-action product guards resolve per principal (S12 F029)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('assertPsaOnlyTenantAccess', () => {
    it('refuses a seat principal on a closed surface', async () => {
      loadProductPrincipal.mockResolvedValue(seat);
      await expect(assertPsaOnlyTenantAccess({ tenantId: 't1', userId: 'u1' }, 'billing_actions')).rejects.toBeInstanceOf(SharedProductAccessError);
      await expect(assertPsaOnlyTenantAccess({ tenantId: 't1', userId: 'u1' }, 'extension_actions')).rejects.toMatchObject({ code: 'PRODUCT_ACCESS_DENIED', status: 403 });
      await expect(assertPsaOnlyTenantAccess({ tenantId: 't1', userId: 'u1' }, 'document_management_actions')).rejects.toBeInstanceOf(SharedProductAccessError);
    });

    it('allows a seat principal on an operational surface', async () => {
      loadProductPrincipal.mockResolvedValue(seat);
      await expect(assertPsaOnlyTenantAccess({ tenantId: 't1', userId: 'u1' }, 'scheduling_time_actions')).resolves.toBeUndefined();
    });

    it('asks for the principal, not only the tenant, when a user is named', async () => {
      loadProductPrincipal.mockResolvedValue(ordinary);
      await assertPsaOnlyTenantAccess({ tenantId: 't1', userId: 'u1' }, 'billing_actions');
      expect(loadProductPrincipal).toHaveBeenCalledWith({ tenantId: 't1', userId: 'u1' });
    });

    it('answers for an ordinary principal exactly as before, by tenant alone or with a user', async () => {
      loadProductPrincipal.mockResolvedValue(ordinary);
      await expect(assertPsaOnlyTenantAccess('t1', 'billing_actions')).resolves.toBeUndefined();
      await expect(assertPsaOnlyTenantAccess({ tenantId: 't1', userId: 'u1' }, 'billing_actions')).resolves.toBeUndefined();
      expect(loadProductPrincipal).toHaveBeenNthCalledWith(1, { tenantId: 't1' });

      loadProductPrincipal.mockResolvedValue({ rawProductCode: 'algadesk', surfaceKind: null });
      await expect(assertPsaOnlyTenantAccess('t1', 'billing_actions')).rejects.toBeInstanceOf(SharedProductAccessError);
      loadProductPrincipal.mockResolvedValue({ rawProductCode: 'nonsense', surfaceKind: null });
      await expect(assertPsaOnlyTenantAccess('t1', 'billing_actions')).rejects.toBeInstanceOf(SharedProductAccessError);
    });

    it('refuses a seat principal of a tenant that is not psa for every capability', async () => {
      loadProductPrincipal.mockResolvedValue({ rawProductCode: 'algadesk', surfaceKind: CO_MANAGED_SEAT_SURFACE });
      await expect(assertPsaOnlyTenantAccess({ tenantId: 't1', userId: 'u1' }, 'scheduling_time_actions')).rejects.toBeInstanceOf(SharedProductAccessError);
    });
  });

  describe('assertTenantProductAccess', () => {
    it('refuses a seat principal on a closed surface and allows it on an operational one', async () => {
      loadProductPrincipal.mockResolvedValue(seat);
      await expect(assertTenantProductAccess({ tenantId: 't1', userId: 'u1', capability: 'email_oauth', allowedProducts: ['psa'] })).rejects.toBeInstanceOf(ProductAccessError);
      await expect(assertTenantProductAccess({ tenantId: 't1', userId: 'u1', capability: 'scheduling_time_actions', allowedProducts: ['psa'] })).resolves.toBe('psa');
    });

    it('still honours the allowed products for a seat principal', async () => {
      loadProductPrincipal.mockResolvedValue(seat);
      await expect(assertTenantProductAccess({ tenantId: 't1', userId: 'u1', capability: 'scheduling_time_actions', allowedProducts: ['algadesk'] })).rejects.toBeInstanceOf(ProductAccessError);
    });
  });

  describe('getCurrentProductPrincipal', () => {
    it('is the session user in the session tenant, with the principal kind the one read found', async () => {
      loadProductPrincipal.mockResolvedValue(seat);
      await expect(getCurrentProductPrincipal()).resolves.toEqual({ productCode: 'psa', surfaceKind: CO_MANAGED_SEAT_SURFACE });
      expect(loadProductPrincipal).toHaveBeenCalledWith({ tenantId: 'tenant-1', userId: 'user-1' });
    });

    it('is an ordinary principal for an ordinary user', async () => {
      loadProductPrincipal.mockResolvedValue({ rawProductCode: 'co_managed', surfaceKind: null });
      await expect(getCurrentProductPrincipal()).resolves.toEqual({ productCode: 'co_managed', surfaceKind: null });
    });
  });
});
