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

function createUpgradeKnex(state: {
  existingSubscription: Record<string, any>;
  priceRecords: Record<string, Record<string, any>>;
  subscriptionUpdates: Array<{ criteria: Record<string, any>; values: Record<string, any> }>;
  tenantUpdates: Array<{ criteria: Record<string, any>; values: Record<string, any> }>;
  activeUserCount?: number;
}) {
  const knex = ((table: string) => {
    if (table === 'stripe_subscriptions') {
      return {
        where: (criteria: Record<string, any>) => ({
          first: async () => (
            criteria.tenant === state.existingSubscription.tenant &&
            criteria.stripe_customer_id === state.existingSubscription.stripe_customer_id &&
            criteria.status === state.existingSubscription.status
          )
            ? state.existingSubscription
            : null,
          update: async (values: Record<string, any>) => {
            state.subscriptionUpdates.push({ criteria, values });
            return 1;
          },
        }),
      };
    }

    if (table === 'stripe_prices') {
      return {
        where: (criteria: Record<string, any>) => ({
          first: async () => state.priceRecords[criteria.stripe_price_external_id] ?? null,
        }),
      };
    }

    if (table === 'tenants') {
      return {
        where: (criteria: Record<string, any>) => ({
          update: async (values: Record<string, any>) => {
            state.tenantUpdates.push({ criteria, values });
            return 1;
          },
        }),
      };
    }

    if (table === 'users') {
      return {
        where: (_criteria: Record<string, any>) => ({
          count: (_column: string) => ({
            first: async () => ({ count: String(state.activeUserCount ?? 1) }),
          }),
        }),
      };
    }

    throw new Error(`Unexpected table ${table}`);
  }) as any;

  knex.fn = {
    now: () => new Date('2026-03-26T00:00:00.000Z'),
  };

  return knex;
}

function createAddOnKnex(addOnRecord?: Record<string, any>) {
  return ((table: string) => {
    if (table !== 'tenant_addons') {
      throw new Error(`Unexpected table ${table}`);
    }

    return {
      where: (_criteria: Record<string, any>) => ({
        first: async () => addOnRecord ?? null,
      }),
    };
  }) as any;
}

function createTenantAddOnMutationKnex(state: {
  inserted?: Record<string, any>;
  merged?: Record<string, any>;
  updated?: Record<string, any>;
  where?: Record<string, any>;
}) {
  const knex = ((table: string) => {
    if (table !== 'tenant_addons') {
      throw new Error(`Unexpected table ${table}`);
    }

    return {
      insert: (values: Record<string, any>) => {
        state.inserted = values;
        return {
          onConflict: (_keys: string[]) => ({
            merge: (mergeValues: Record<string, any>) => {
              state.merged = mergeValues;
              return 1;
            },
          }),
        };
      },
      where: (criteria: Record<string, any>) => ({
        update: (values: Record<string, any>) => {
          state.where = criteria;
          state.updated = values;
          return 1;
        },
      }),
    };
  }) as any;

  knex.fn = {
    now: () => new Date('2026-03-26T00:00:00.000Z'),
  };

  return knex;
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
    aiAddOnPriceId: 'price_ai_addon',
    aiAddOnAnnualPriceId: 'price_ai_addon_year',
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

  it('forces licensed user count to 1 for Solo subscriptions', () => {
    const service = createService({});

    const quantity = service.getLicensedUserCountFromStripeItems(
      [{ quantity: 9, price: { id: 'price_solo_month' } }],
      'solo',
    );

    expect(quantity).toBe(1);
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

  it('upgrades Solo subscriptions to Pro base plus per-user pricing', async () => {
    const service = createService({});
    const subscriptionUpdates: Array<{ criteria: Record<string, any>; values: Record<string, any> }> = [];
    const tenantUpdates: Array<{ criteria: Record<string, any>; values: Record<string, any> }> = [];

    getConnectionMock.mockResolvedValue(
      createUpgradeKnex({
        existingSubscription: {
          tenant: 'tenant-solo',
          stripe_subscription_id: 'sub_db_1',
          stripe_subscription_external_id: 'sub_ext_1',
          stripe_subscription_item_id: 'si_solo_flat',
          stripe_customer_id: 'cust_db_1',
          stripe_price_id: 'price_record_solo',
          status: 'active',
          quantity: 1,
          stripe_base_item_id: null,
          stripe_base_price_id: null,
          billing_interval: 'month',
        },
        priceRecords: {
          price_pro_user: { stripe_price_id: 'price_record_pro_user' },
          price_pro_base: { stripe_price_id: 'price_record_pro_base' },
        },
        subscriptionUpdates,
        tenantUpdates,
        activeUserCount: 1,
      }),
    );

    service.getOrImportCustomer = vi.fn().mockResolvedValue({
      stripe_customer_id: 'cust_db_1',
      stripe_customer_external_id: 'cus_ext_1',
    });
    service.initPromise = Promise.resolve();
    service.stripe.subscriptions = {
      update: vi.fn().mockResolvedValue({
        items: {
          data: [
            { id: 'si_pro_user', quantity: 1, price: { id: 'price_pro_user' } },
            { id: 'si_pro_base', quantity: 1, price: { id: 'price_pro_base' } },
          ],
        },
      }),
      list: vi.fn().mockResolvedValue({
        data: [{ id: 'sub_ext_1' }],
      }),
    };

    const result = await service.upgradeTier('tenant-solo', 'pro', 'month');

    expect(result).toEqual({ success: true });
    expect(service.stripe.subscriptions.update).toHaveBeenCalledWith(
      'sub_ext_1',
      expect.objectContaining({
        items: [
          { id: 'si_solo_flat', deleted: true },
          { price: 'price_pro_base', quantity: 1 },
          { price: 'price_pro_user', quantity: 1 },
        ],
      }),
    );
    expect(subscriptionUpdates[0]?.values).toEqual(
      expect.objectContaining({
        stripe_subscription_item_id: 'si_pro_user',
        stripe_base_item_id: 'si_pro_base',
        stripe_base_price_id: 'price_record_pro_base',
      }),
    );
    expect(tenantUpdates[0]?.values).toEqual(
      expect.objectContaining({
        plan: 'pro',
      }),
    );
  });

  it('downgrades Pro subscriptions to a single Solo flat-rate item when only one user is active', async () => {
    const service = createService({});
    const subscriptionUpdates: Array<{ criteria: Record<string, any>; values: Record<string, any> }> = [];
    const tenantUpdates: Array<{ criteria: Record<string, any>; values: Record<string, any> }> = [];

    getConnectionMock.mockResolvedValue(
      createUpgradeKnex({
        existingSubscription: {
          tenant: 'tenant-pro',
          stripe_subscription_id: 'sub_db_2',
          stripe_subscription_external_id: 'sub_ext_2',
          stripe_subscription_item_id: 'si_pro_user',
          stripe_customer_id: 'cust_db_2',
          stripe_price_id: 'price_record_pro_user',
          status: 'active',
          quantity: 1,
          stripe_base_item_id: 'si_pro_base',
          stripe_base_price_id: 'price_record_pro_base',
          billing_interval: 'month',
        },
        priceRecords: {
          price_solo_month: { stripe_price_id: 'price_record_solo' },
        },
        subscriptionUpdates,
        tenantUpdates,
        activeUserCount: 1,
      }),
    );

    service.getOrImportCustomer = vi.fn().mockResolvedValue({
      stripe_customer_id: 'cust_db_2',
      stripe_customer_external_id: 'cus_ext_2',
    });
    service.initPromise = Promise.resolve();
    service.stripe.subscriptions = {
      update: vi.fn().mockResolvedValue({
        items: {
          data: [
            { id: 'si_solo_flat', quantity: 1, price: { id: 'price_solo_month' } },
          ],
        },
      }),
    };

    const result = await service.downgradeTier('tenant-pro', 'month');

    expect(result).toEqual({ success: true });
    expect(service.stripe.subscriptions.update).toHaveBeenCalledWith(
      'sub_ext_2',
      expect.objectContaining({
        items: [
          { id: 'si_pro_user', deleted: true },
          { id: 'si_pro_base', deleted: true },
          { price: 'price_solo_month', quantity: 1 },
        ],
      }),
    );
    expect(subscriptionUpdates[0]?.values).toEqual(
      expect.objectContaining({
        stripe_subscription_item_id: 'si_solo_flat',
        stripe_price_id: 'price_record_solo',
        stripe_base_item_id: null,
        stripe_base_price_id: null,
        quantity: 1,
      }),
    );
    expect(tenantUpdates[0]?.values).toEqual(
      expect.objectContaining({
        plan: 'solo',
        licensed_user_count: 1,
      }),
    );
  });

  it('blocks Pro to Solo downgrade when more than one active user remains', async () => {
    const service = createService({});

    getConnectionMock.mockResolvedValue(
      createUpgradeKnex({
        existingSubscription: {
          tenant: 'tenant-pro',
          stripe_subscription_id: 'sub_db_3',
          stripe_subscription_external_id: 'sub_ext_3',
          stripe_subscription_item_id: 'si_pro_user',
          stripe_customer_id: 'cust_db_3',
          stripe_price_id: 'price_record_pro_user',
          status: 'active',
          quantity: 3,
          stripe_base_item_id: 'si_pro_base',
          stripe_base_price_id: 'price_record_pro_base',
          billing_interval: 'month',
        },
        priceRecords: {},
        subscriptionUpdates: [],
        tenantUpdates: [],
        activeUserCount: 2,
      }),
    );

    service.initPromise = Promise.resolve();
    service.stripe.subscriptions = {
      update: vi.fn(),
    };

    const result = await service.downgradeTier('tenant-pro', 'month');

    expect(result).toEqual({
      success: false,
      error: 'Solo downgrade requires exactly 1 active internal user',
    });
    expect(service.stripe.subscriptions.update).not.toHaveBeenCalled();
  });

  it('creates an embedded checkout session for the AI add-on', async () => {
    const service = createService({});
    service.initPromise = Promise.resolve();

    const result = await service.purchaseAddOn('tenant-ai', 'ai_assistant', 'month');

    expect(result).toEqual({
      success: true,
      clientSecret: 'cs_secret_123',
      sessionId: 'cs_test_123',
    });
    expect(service.stripe.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        line_items: [{ price: service.config.aiAddOnPriceId, quantity: 1 }],
        metadata: expect.objectContaining({
          tenant_id: 'tenant-ai',
          addon_key: 'ai_assistant',
        }),
      }),
    );
  });

  it('cancels the stored AI add-on subscription', async () => {
    const service = createService({});
    service.initPromise = Promise.resolve();
    service.stripe.subscriptions = {
      cancel: vi.fn().mockResolvedValue({}),
    };
    getConnectionMock.mockResolvedValue(
      createAddOnKnex({
        metadata: {
          stripe_subscription_external_id: 'sub_addon_1',
        },
      }),
    );

    const result = await service.cancelAddOn('tenant-ai', 'ai_assistant');

    expect(result).toEqual({ success: true });
    expect(service.stripe.subscriptions.cancel).toHaveBeenCalledWith('sub_addon_1', { prorate: true });
  });

  it('activates the AI add-on from subscription.updated webhook metadata', async () => {
    const service = createService({});
    const state: {
      inserted?: Record<string, any>;
      merged?: Record<string, any>;
    } = {};

    await service.handleSubscriptionUpdated(
      {
        data: {
          object: {
            id: 'sub_addon_2',
            status: 'active',
            metadata: { addon_key: 'ai_assistant' },
            items: {
              data: [{ id: 'si_addon_2', price: { id: 'price_ai_addon' } }],
            },
          },
        },
      },
      'tenant-ai',
      createTenantAddOnMutationKnex(state),
    );

    expect(state.inserted).toEqual(
      expect.objectContaining({
        tenant: 'tenant-ai',
        addon_key: 'ai_assistant',
      }),
    );
    expect(state.merged).toEqual(
      expect.objectContaining({
        expires_at: null,
        metadata: expect.objectContaining({
          stripe_subscription_external_id: 'sub_addon_2',
          stripe_subscription_item_id: 'si_addon_2',
        }),
      }),
    );
  });

  it('deactivates the AI add-on from subscription.deleted webhook metadata', async () => {
    const service = createService({});
    const state: {
      updated?: Record<string, any>;
      where?: Record<string, any>;
    } = {};

    await service.handleSubscriptionDeleted(
      {
        data: {
          object: {
            id: 'sub_addon_2',
            status: 'canceled',
            metadata: { addon_key: 'ai_assistant' },
          },
        },
      },
      'tenant-ai',
      createTenantAddOnMutationKnex(state),
    );

    expect(state.where).toEqual({
      tenant: 'tenant-ai',
      addon_key: 'ai_assistant',
    });
    expect(state.updated).toEqual(
      expect.objectContaining({
        metadata: expect.objectContaining({
          stripe_subscription_external_id: 'sub_addon_2',
          status: 'canceled',
        }),
      }),
    );
  });
});
