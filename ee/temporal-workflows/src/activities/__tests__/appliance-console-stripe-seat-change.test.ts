import type Stripe from 'stripe';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MockActivityEnvironment } from '@temporalio/testing';

const stripeMocks = vi.hoisted(() => ({
  retrieve: vi.fn(),
  update: vi.fn(),
}));

vi.mock('../../config/stripeClient', () => ({
  createWorkerStripeClient: () => ({
    subscriptions: { retrieve: stripeMocks.retrieve, update: stripeMocks.update },
  }),
}));

import { planSeatChange, stripeUpdateSeatQuantity } from '../appliance-console-stripe-activities';

const activity = new MockActivityEnvironment();

function subscription(status: Stripe.Subscription.Status, quantity: number): Stripe.Subscription {
  return {
    id: 'sub_appliance',
    status,
    items: { data: [{ id: 'si_seat', quantity, price: { id: 'price_appliance_seat' } }] },
  } as unknown as Stripe.Subscription;
}

beforeAll(() => {
  vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_fake');
  vi.stubEnv('STRIPE_PRICE_ID_APPLIANCE_PRO_USER_MONTHLY', 'price_appliance_seat');
});
afterAll(() => vi.unstubAllEnvs());
beforeEach(() => {
  stripeMocks.retrieve.mockReset();
  stripeMocks.update.mockReset();
});

describe('planSeatChange (same rule as the customer portal and hosted seat changes)', () => {
  it('charges an increase on a live subscription now and fails if the charge cannot be collected', () => {
    expect(planSeatChange('active', 5, 8)).toEqual({
      billing: 'charged_now',
      params: { proration_behavior: 'always_invoice', payment_behavior: 'error_if_incomplete' },
    });
  });
  it('credits a decrease on the next invoice', () => {
    expect(planSeatChange('active', 5, 3)).toEqual({
      billing: 'credited_next_invoice',
      params: { proration_behavior: 'create_prorations' },
    });
  });
  it('never charges while trialing, in either direction', () => {
    expect(planSeatChange('trialing', 5, 8).params).toEqual({ proration_behavior: 'none' });
    expect(planSeatChange('trialing', 5, 2).params).toEqual({ proration_behavior: 'none' });
  });
  it('is a no-op for the same count', () => {
    expect(planSeatChange('active', 5, 5)).toEqual({ billing: 'unchanged', params: {} });
  });
});

describe('stripeUpdateSeatQuantity', () => {
  it('applies the plan to the per-seat line and reports how it was billed', async () => {
    stripeMocks.retrieve.mockResolvedValue(subscription('active', 5));
    stripeMocks.update.mockResolvedValue(subscription('active', 8));
    const res = await activity.run(stripeUpdateSeatQuantity, { stripeSubId: 'sub_appliance', seats: 8 });
    expect(res).toEqual({ stripeSubId: 'sub_appliance', itemId: 'si_seat', priceId: 'price_appliance_seat', seats: 8, billing: 'charged_now' });
    expect(stripeMocks.update).toHaveBeenCalledWith('sub_appliance', {
      items: [{ id: 'si_seat', quantity: 8 }],
      proration_behavior: 'always_invoice',
      payment_behavior: 'error_if_incomplete',
    });
  });

  it('skips Stripe when the count is unchanged', async () => {
    stripeMocks.retrieve.mockResolvedValue(subscription('active', 5));
    const res = await activity.run(stripeUpdateSeatQuantity, { stripeSubId: 'sub_appliance', seats: 5 });
    expect(res).toMatchObject({ seats: 5, billing: 'unchanged' });
    expect(stripeMocks.update).not.toHaveBeenCalled();
  });

  it('turns a declined immediate charge into a non-retryable seat_payment_failed failure', async () => {
    stripeMocks.retrieve.mockResolvedValue(subscription('active', 5));
    stripeMocks.update.mockRejectedValue(
      Object.assign(new Error('Your card was declined.'), { type: 'StripeCardError', code: 'card_declined', decline_code: 'generic_decline' }),
    );
    await expect(activity.run(stripeUpdateSeatQuantity, { stripeSubId: 'sub_appliance', seats: 8 })).rejects.toMatchObject({
      type: 'seat_payment_failed',
      nonRetryable: true,
    });
  });

  it('refuses a cancelled subscription before touching Stripe', async () => {
    stripeMocks.retrieve.mockResolvedValue(subscription('canceled', 5));
    await expect(activity.run(stripeUpdateSeatQuantity, { stripeSubId: 'sub_appliance', seats: 8 })).rejects.toMatchObject({
      type: 'subscription_not_active',
    });
    expect(stripeMocks.update).not.toHaveBeenCalled();
  });
});
