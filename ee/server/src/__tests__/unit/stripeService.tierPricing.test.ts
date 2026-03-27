import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StripeService } from '../../lib/stripe/StripeService';

const getConnectionMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/db/db', () => ({
  getConnection: getConnectionMock,
}));

function createTenantKnex(planByTenant: Record<string, string>) {
  return ((table: string) => {
    if (table !== 'tenants') {
      throw new Error(`Unexpected table ${table}`);
    }

    return {
      where: (_column: string, tenantId: string) => ({
        select: (_field: string) => ({
          first: async () => ({ plan: planByTenant[tenantId] }),
        }),
      }),
    };
  }) as any;
}

function createService(planByTenant: Record<string, string>) {
  const service = new StripeService() as any;

  service.config = {
    licensePriceId: 'price_legacy_user',
    soloBasePriceId: 'price_solo_month',
    soloBaseAnnualPriceId: 'price_solo_year',
    proBasePriceId: 'price_pro_base',
    proUserPriceId: 'price_pro_user',
    proBaseAnnualPriceId: 'price_pro_base_year',
    proUserAnnualPriceId: 'price_pro_user_year',
    premiumBasePriceId: 'price_premium_base',
    premiumUserPriceId: 'price_premium_user',
    premiumBaseAnnualPriceId: 'price_premium_base_year',
    premiumUserAnnualPriceId: 'price_premium_user_year',
    earlyAdoptersBasePriceId: null,
    earlyAdoptersUserPriceId: null,
    earlyAdoptersBaseAnnualPriceId: null,
    earlyAdoptersUserAnnualPriceId: null,
  };

  service.stripe = {
    checkout: {
      sessions: {
        create: vi.fn().mockResolvedValue({
          id: 'cs_test_123',
          client_secret: 'cs_secret_123',
        }),
      },
    },
  };
  service.getOrImportCustomer = vi.fn().mockResolvedValue({
    stripe_customer_external_id: 'cus_test_123',
  });

  getConnectionMock.mockResolvedValue(createTenantKnex(planByTenant));

  return service;
}

describe('StripeService tier pricing', () => {
  beforeEach(() => {
    getConnectionMock.mockReset();
  });

  it('returns a base-only price shape for Solo', () => {
    const service = createService({});

    expect(service.getTierPriceIds('solo', 'month')).toEqual({
      basePriceId: 'price_solo_month',
      userPriceId: null,
    });
    expect(service.getTierPriceIds('solo', 'year')).toEqual({
      basePriceId: 'price_solo_year',
      userPriceId: null,
    });
    expect(service.getTierPriceIds('pro', 'month')).toEqual({
      basePriceId: 'price_pro_base',
      userPriceId: 'price_pro_user',
    });
  });

  it('creates a single checkout line item for Solo pricing', async () => {
    const service = createService({ 'tenant-solo': 'solo' });

    await service.createLicenseCheckoutSession('tenant-solo', 4, 'month');

    expect(service.stripe.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        line_items: [{ price: 'price_solo_month', quantity: 1 }],
      }),
    );
  });

  it('keeps base plus per-user checkout line items for Pro pricing', async () => {
    const service = createService({ 'tenant-pro': 'pro' });

    await service.createLicenseCheckoutSession('tenant-pro', 4, 'month');

    expect(service.stripe.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        line_items: [
          { price: 'price_pro_base', quantity: 1 },
          { price: 'price_pro_user', quantity: 4 },
        ],
      }),
    );
  });
});
