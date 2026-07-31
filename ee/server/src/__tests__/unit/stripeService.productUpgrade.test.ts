import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StripeService } from '../../lib/stripe/StripeService';

const getConnectionMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/db/db', () => ({
  getConnection: getConnectionMock,
}));

type Interval = 'month' | 'year';

function createProductUpgradeKnex(canonicalSubscription: Record<string, any> | null) {
  const builder: Record<string, any> = {};
  builder.where = vi.fn(() => builder);
  builder.whereIn = vi.fn(() => builder);
  builder.whereRaw = vi.fn(() => builder);
  builder.orderByRaw = vi.fn(() => builder);
  builder.first = vi.fn(async () => canonicalSubscription);

  return vi.fn((table: string) => {
    if (table !== 'stripe_subscriptions') {
      throw new Error(`Unexpected table ${table}`);
    }
    return builder;
  }) as any;
}

function createService(options: {
  interval?: Interval;
  currentPriceId?: string;
  canonicalStatus?: string;
  stripeStatus?: string;
  algadeskPriceId?: string | null;
  algadeskAnnualPriceId?: string | null;
  algapsaPriceId?: string | null;
  algapsaAnnualPriceId?: string | null;
  invoiceAmountDue?: number;
  hasCanonicalSubscription?: boolean;
} = {}) {
  const interval = options.interval ?? 'month';
  const sourcePriceId = interval === 'year' ? 'price_algadesk_year' : 'price_algadesk_month';
  const targetPriceId = interval === 'year' ? 'price_algapsa_year' : 'price_algapsa_month';
  const currentPriceId = options.currentPriceId ?? sourcePriceId;
  const canonicalStatus = options.canonicalStatus ?? 'active';
  const subscriptionId = 'sub_product_upgrade';
  const itemId = 'si_product_upgrade';
  const quantity = 4;

  const canonicalSubscription = {
    tenant: 'tenant-product-upgrade',
    stripe_subscription_external_id: subscriptionId,
    stripe_subscription_item_id: itemId,
    status: canonicalStatus,
    quantity,
    billing_interval: interval,
    metadata: {},
  };
  getConnectionMock.mockResolvedValue(createProductUpgradeKnex(
    options.hasCanonicalSubscription === false ? null : canonicalSubscription,
  ));

  const subscriptions = {
    retrieve: vi.fn().mockResolvedValue({
      id: subscriptionId,
      status: options.stripeStatus ?? 'active',
      customer: 'cus_product_upgrade',
      items: {
        data: [{
          id: itemId,
          quantity,
          price: {
            id: currentPriceId,
            recurring: { interval },
          },
        }],
      },
    }),
    update: vi.fn().mockResolvedValue({ id: subscriptionId }),
    cancel: vi.fn(),
    del: vi.fn(),
  };
  const subscriptionItems = { del: vi.fn() };
  const subscriptionSchedules = {
    create: vi.fn(),
    update: vi.fn(),
    cancel: vi.fn(),
    release: vi.fn(),
  };
  const prices = {
    retrieve: vi.fn(async (priceId: string) => ({
      id: priceId,
      unit_amount: priceId.includes('algadesk') ? 799 : 1499,
      currency: 'usd',
      recurring: { interval },
    })),
  };
  const invoices = {
    createPreview: vi.fn().mockResolvedValue({
      amount_due: options.invoiceAmountDue ?? 350,
      currency: 'usd',
    }),
  };

  const service = new StripeService() as any;
  service.config = {
    algadeskUserPriceId: options.algadeskPriceId === undefined
      ? 'price_algadesk_month'
      : options.algadeskPriceId,
    algadeskUserAnnualPriceId: options.algadeskAnnualPriceId === undefined
      ? 'price_algadesk_year'
      : options.algadeskAnnualPriceId,
    algapsaUserPriceId: options.algapsaPriceId === undefined
      ? 'price_algapsa_month'
      : options.algapsaPriceId,
    algapsaUserAnnualPriceId: options.algapsaAnnualPriceId === undefined
      ? 'price_algapsa_year'
      : options.algapsaAnnualPriceId,
  };
  service.stripe = {
    subscriptions,
    subscriptionItems,
    subscriptionSchedules,
    prices,
    invoices,
  };
  service.initPromise = Promise.resolve();

  return {
    service,
    subscriptions,
    subscriptionItems,
    subscriptionSchedules,
    prices,
    invoices,
    subscriptionId,
    itemId,
    quantity,
    sourcePriceId,
    targetPriceId,
  };
}

function expectNoDestructiveStripeCalls(context: ReturnType<typeof createService>) {
  expect(context.subscriptions.cancel).not.toHaveBeenCalled();
  expect(context.subscriptions.del).not.toHaveBeenCalled();
  expect(context.subscriptionItems.del).not.toHaveBeenCalled();
  expect(context.subscriptionSchedules.create).not.toHaveBeenCalled();
  expect(context.subscriptionSchedules.update).not.toHaveBeenCalled();
  expect(context.subscriptionSchedules.cancel).not.toHaveBeenCalled();
  expect(context.subscriptionSchedules.release).not.toHaveBeenCalled();
}

describe('StripeService AlgaDesk to AlgaPSA product upgrade', () => {
  beforeEach(() => {
    getConnectionMock.mockReset();
  });

  it('T031 previews mid-cycle monthly proration in dollars', async () => {
    const context = createService({ invoiceAmountDue: 350 });

    await expect(context.service.previewProductUpgrade('tenant-product-upgrade')).resolves.toEqual({
      currentProduct: 'algadesk',
      targetProduct: 'psa',
      seatCount: 4,
      billingInterval: 'month',
      currentPerSeat: 7.99,
      targetPerSeat: 14.99,
      prorationAmount: 3.5,
      currency: 'usd',
    });
    expect(context.invoices.createPreview).toHaveBeenCalledWith({
      customer: 'cus_product_upgrade',
      subscription: context.subscriptionId,
      subscription_details: {
        items: [{
          id: context.itemId,
          price: context.targetPriceId,
          quantity: context.quantity,
        }],
        proration_behavior: 'always_invoice',
      },
    });
    expect(context.subscriptions.update).not.toHaveBeenCalled();
    expectNoDestructiveStripeCalls(context);
  });

  it('T032 swaps the monthly item with the exact safe update payload', async () => {
    const context = createService();

    await expect(context.service.swapSubscriptionToPsaProduct('tenant-product-upgrade'))
      .resolves.toEqual({ swapped: true });

    expect(context.subscriptions.update).toHaveBeenCalledTimes(1);
    expect(context.subscriptions.update).toHaveBeenCalledWith(
      context.subscriptionId,
      {
        items: [{
          id: context.itemId,
          price: context.targetPriceId,
        }],
        proration_behavior: 'always_invoice',
        metadata: { product_code: 'psa' },
      },
    );

    const payload = context.subscriptions.update.mock.calls[0][1];
    // Seat preservation: quantity must be omitted so Stripe keeps the live count.
    expect(payload.items[0]).not.toHaveProperty('quantity');
    expect(payload).not.toHaveProperty('cancel_at_period_end');
    expect(payload).not.toHaveProperty('cancel_at');
    expect(payload).not.toHaveProperty('pause_collection');
    expect(payload.metadata).not.toHaveProperty('addon_key');
    expect(payload.metadata).not.toHaveProperty('premium_trial');
    expect(payload.metadata).not.toHaveProperty('premium_trial_end');
    expect(payload.metadata).not.toHaveProperty('scheduled_quantity');
    expect(payload.metadata).not.toHaveProperty('schedule_id');
    expectNoDestructiveStripeCalls(context);
  });

  it('T033 maps an annual AlgaDesk item to the annual AlgaPSA price', async () => {
    const context = createService({ interval: 'year' });

    await context.service.swapSubscriptionToPsaProduct('tenant-product-upgrade');

    expect(context.subscriptions.update).toHaveBeenCalledWith(
      context.subscriptionId,
      {
        items: [{
          id: context.itemId,
          price: 'price_algapsa_year',
        }],
        proration_behavior: 'always_invoice',
        metadata: { product_code: 'psa' },
      },
    );
    expectNoDestructiveStripeCalls(context);
  });

  it('T034 refuses an unrecognized source price without mutation', async () => {
    const context = createService({ currentPriceId: 'price_unknown' });

    await expect(context.service.swapSubscriptionToPsaProduct('tenant-product-upgrade'))
      .rejects.toThrow('is not the configured AlgaDesk month price');

    expect(context.subscriptions.update).not.toHaveBeenCalled();
    expectNoDestructiveStripeCalls(context);
  });

  it('T035 treats an already-target subscription as an idempotent no-op', async () => {
    const context = createService({ currentPriceId: 'price_algapsa_month' });

    await expect(context.service.swapSubscriptionToPsaProduct('tenant-product-upgrade'))
      .resolves.toEqual({ swapped: false, reason: 'already-target' });

    expect(context.subscriptions.update).not.toHaveBeenCalled();
    expectNoDestructiveStripeCalls(context);
  });

  it('T036 writes only product_code=psa metadata during the swap', async () => {
    const context = createService();

    await context.service.swapSubscriptionToPsaProduct('tenant-product-upgrade');

    const payload = context.subscriptions.update.mock.calls[0][1];
    expect(payload.metadata).toEqual({ product_code: 'psa' });
    expect(Object.keys(payload.metadata)).toEqual(['product_code']);
    expectNoDestructiveStripeCalls(context);
  });

  it('T037 reports a missing monthly AlgaPSA env var before any Stripe API call', async () => {
    const context = createService({ algapsaPriceId: null });

    await expect(context.service.swapSubscriptionToPsaProduct('tenant-product-upgrade'))
      .rejects.toThrow('STRIPE_ALGAPSA_USER_PRICE_ID environment variable is not configured');

    expect(context.subscriptions.retrieve).not.toHaveBeenCalled();
    expect(context.subscriptions.update).not.toHaveBeenCalled();
    expect(context.prices.retrieve).not.toHaveBeenCalled();
    expect(context.invoices.createPreview).not.toHaveBeenCalled();
    expectNoDestructiveStripeCalls(context);
  });

  it('refuses a non-active canonical subscription before any Stripe API call', async () => {
    const context = createService({ canonicalStatus: 'trialing' });

    await expect(context.service.swapSubscriptionToPsaProduct('tenant-product-upgrade'))
      .rejects.toThrow('Product upgrade requires an active subscription; found trialing');

    expect(context.subscriptions.retrieve).not.toHaveBeenCalled();
    expect(context.subscriptions.update).not.toHaveBeenCalled();
    expectNoDestructiveStripeCalls(context);
  });

  it('refuses when no canonical license subscription exists', async () => {
    const context = createService({ hasCanonicalSubscription: false });

    await expect(context.service.swapSubscriptionToPsaProduct('tenant-product-upgrade'))
      .rejects.toThrow('No canonical license subscription found for tenant tenant-product-upgrade');

    expect(context.subscriptions.retrieve).not.toHaveBeenCalled();
    expect(context.subscriptions.update).not.toHaveBeenCalled();
    expectNoDestructiveStripeCalls(context);
  });

  it('refuses when the live Stripe subscription is not active', async () => {
    const context = createService({ stripeStatus: 'past_due' });

    await expect(context.service.swapSubscriptionToPsaProduct('tenant-product-upgrade'))
      .rejects.toThrow('Product upgrade requires an active Stripe subscription; found past_due');

    expect(context.subscriptions.update).not.toHaveBeenCalled();
    expectNoDestructiveStripeCalls(context);
  });

  it('recognizes AlgaPSA monthly and annual prices as user items for webhooks', () => {
    const context = createService();

    expect(context.service.getKnownUserPriceExternalIds()).toEqual(
      expect.arrayContaining(['price_algapsa_month', 'price_algapsa_year']),
    );
  });

  it('returns null proration when Stripe invoice estimation fails', async () => {
    const context = createService();
    context.invoices.createPreview.mockRejectedValueOnce(new Error('preview unavailable'));

    const preview = await context.service.previewProductUpgrade('tenant-product-upgrade');

    expect(preview.prorationAmount).toBeNull();
    expect(context.subscriptions.update).not.toHaveBeenCalled();
    expectNoDestructiveStripeCalls(context);
  });
});
