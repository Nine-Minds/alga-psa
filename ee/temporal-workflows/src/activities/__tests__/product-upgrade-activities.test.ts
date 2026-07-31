import type Stripe from 'stripe';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../db/product-upgrade-operations.js', () => ({
  applyRbacDelta: vi.fn(),
  backfillClientTaxDefaults: vi.fn(),
  backfillPsaSeeds: vi.fn(),
  ensureSlaParity: vi.fn(),
  flipProductCode: vi.fn(),
  preflightProductUpgrade: vi.fn(),
  verifyProductUpgrade: vi.fn(),
}));

import {
  product_upgrade_stripe_swap,
  type ProductUpgradeStripeClient,
  type ProductUpgradeStripeSwapDependencies,
} from '../product-upgrade-activities.js';

const env = {
  STRIPE_ALGADESK_USER_PRICE_ID: 'price_algadesk_month',
  STRIPE_ALGADESK_USER_ANNUAL_PRICE_ID: 'price_algadesk_year',
  STRIPE_ALGAPSA_USER_PRICE_ID: 'price_algapsa_month',
  STRIPE_ALGAPSA_USER_ANNUAL_PRICE_ID: 'price_algapsa_year',
} as NodeJS.ProcessEnv;

function subscription(overrides: Partial<Stripe.Subscription> = {}): Stripe.Subscription {
  return {
    id: 'sub_license',
    status: 'active',
    items: {
      data: [{
        id: 'si_users',
        quantity: 7,
        price: {
          id: 'price_algadesk_month',
          recurring: { interval: 'month' },
        },
      }],
    },
    ...overrides,
  } as unknown as Stripe.Subscription;
}

function dependencies(liveSubscription: Stripe.Subscription) {
  const update = vi.fn(async () => liveSubscription);
  const cancel = vi.fn();
  const del = vi.fn();
  const subscriptionItemDel = vi.fn();
  const scheduleCreate = vi.fn();
  const scheduleUpdate = vi.fn();
  const scheduleCancel = vi.fn();
  const stripe = {
    subscriptions: {
      retrieve: vi.fn(async () => liveSubscription),
      update,
      cancel,
      del,
    },
    subscriptionItems: { del: subscriptionItemDel },
    subscriptionSchedules: {
      create: scheduleCreate,
      update: scheduleUpdate,
      cancel: scheduleCancel,
    },
  } as unknown as ProductUpgradeStripeClient;
  const deps: ProductUpgradeStripeSwapDependencies = {
    stripe,
    env,
    log: { info: vi.fn(), error: vi.fn() },
    loadCanonicalSubscription: vi.fn(async () => ({
      stripe_subscription_external_id: 'sub_license',
      stripe_subscription_item_id: 'si_users',
      stripe_price_id: 'internal-price-id',
      status: 'active',
      quantity: 7,
      metadata: {},
    })),
  };

  return {
    deps,
    update,
    cancel,
    del,
    subscriptionItemDel,
    scheduleCreate,
    scheduleUpdate,
    scheduleCancel,
  };
}

describe('product_upgrade_stripe_swap', () => {
  it('refuses a live subscription that is not active without mutating Stripe', async () => {
    const setup = dependencies(subscription({ status: 'past_due' }));

    await expect(product_upgrade_stripe_swap('tenant-1', setup.deps)).rejects.toMatchObject({
      type: 'ProductUpgradeStripeRefusal',
      nonRetryable: true,
    });
    expect(setup.update).not.toHaveBeenCalled();
  });

  it('refuses an unknown source price without mutating Stripe', async () => {
    const live = subscription();
    live.items.data[0].price.id = 'price_unrelated_addon';
    const setup = dependencies(live);

    await expect(product_upgrade_stripe_swap('tenant-1', setup.deps)).rejects.toMatchObject({
      type: 'ProductUpgradeStripeRefusal',
      nonRetryable: true,
    });
    expect(setup.update).not.toHaveBeenCalled();
  });

  it('returns already-target without issuing an update', async () => {
    const live = subscription();
    live.items.data[0].price.id = 'price_algapsa_month';
    const setup = dependencies(live);

    await expect(product_upgrade_stripe_swap('tenant-1', setup.deps)).resolves.toEqual({
      swapped: false,
      reason: 'already-target',
    });
    expect(setup.update).not.toHaveBeenCalled();
  });

  it('updates only the existing user item, omitting quantity so Stripe preserves live seats', async () => {
    const setup = dependencies(subscription());

    await expect(product_upgrade_stripe_swap('tenant-1', setup.deps)).resolves.toEqual({
      swapped: true,
    });
    expect(setup.update).toHaveBeenCalledTimes(1);
    expect(setup.update).toHaveBeenCalledWith('sub_license', {
      items: [{ id: 'si_users', price: 'price_algapsa_month' }],
      proration_behavior: 'always_invoice',
      metadata: { product_code: 'psa' },
    });

    const payload = setup.update.mock.calls[0][1] as Record<string, any>;
    expect(payload.items[0]).not.toHaveProperty('quantity');
    expect(payload).not.toHaveProperty('cancel_at_period_end');
    expect(payload).not.toHaveProperty('cancel_at');
    expect(payload).not.toHaveProperty('pause_collection');
    for (const key of [
      'addon_key',
      'premium_trial',
      'premium_trial_end',
      'scheduled_quantity',
      'schedule_id',
    ]) {
      expect(payload.metadata).not.toHaveProperty(key);
    }
    expect(setup.cancel).not.toHaveBeenCalled();
    expect(setup.del).not.toHaveBeenCalled();
    expect(setup.subscriptionItemDel).not.toHaveBeenCalled();
    expect(setup.scheduleCreate).not.toHaveBeenCalled();
    expect(setup.scheduleUpdate).not.toHaveBeenCalled();
    expect(setup.scheduleCancel).not.toHaveBeenCalled();
  });

  it('selects the annual target for an annual AlgaDesk item', async () => {
    const live = subscription();
    live.items.data[0].price.id = 'price_algadesk_year';
    live.items.data[0].price.recurring = { interval: 'year' } as Stripe.Price.Recurring;
    const setup = dependencies(live);

    await product_upgrade_stripe_swap('tenant-1', setup.deps);

    expect(setup.update).toHaveBeenCalledWith(
      'sub_license',
      expect.objectContaining({
        items: [{ id: 'si_users', price: 'price_algapsa_year' }],
      }),
    );
  });
});
