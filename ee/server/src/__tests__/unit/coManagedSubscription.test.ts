import type Stripe from 'stripe';
import { describe, expect, it } from 'vitest';
import { assertCoManagedPrice, coManagedSnapshotFromStripe, isCoManagedSubscription } from '../../lib/stripe/coManagedSubscription';

const now = new Date('2026-09-06T12:00:00Z');
const end = now.getTime() / 1000 + 3600;

function price(overrides: Record<string, unknown> = {}) {
  return { id: 'price_co_managed', type: 'recurring', currency: 'usd', unit_amount: 1149, billing_scheme: 'per_unit',
    recurring: { interval: 'month', interval_count: 1, usage_type: 'licensed' }, ...overrides };
}

function subscription(overrides: Record<string, unknown> = {}): Stripe.Subscription {
  return {
    id: 'sub_co_managed', customer: 'cus_sponsor', status: 'active', current_period_end: end,
    metadata: { tenant_id: 'sponsor', subscription_kind: 'co_managed' },
    latest_invoice: { id: 'invoice', status: 'paid' },
    items: { data: [{ id: 'si_co_managed', quantity: 5, price: price() }] },
    ...overrides,
  } as unknown as Stripe.Subscription;
}

function input(sub = subscription()) {
  return { subscription: sub, baseSubscriptions: [subscription({ id: 'sub_pro', metadata: {},
    items: { data: [{ price: { id: 'price_pro' }, quantity: 8 }] } })],
  sponsorTenant: 'sponsor', customerId: 'cus_sponsor', coManagedPriceId: 'price_co_managed', proPriceIds: ['price_pro'], now };
}

describe('co-managed Stripe entitlement adapter', () => {
  it('identifies the dedicated subscription by its kind, never the MSP Pro item', () => {
    expect(isCoManagedSubscription(subscription(), undefined)).toBe(true);
    expect(isCoManagedSubscription(input().baseSubscriptions[0], 'price_co_managed')).toBe(false);
  });

  it('counts only customer seats and bounds validity by the Pro subscription', () => {
    const fixture = input();
    Object.assign(fixture.baseSubscriptions[0], { current_period_end: end - 60 });
    expect(coManagedSnapshotFromStripe(fixture)).toEqual({ capacity: 5, active: true, validUntil: new Date((end - 60) * 1000) });
  });

  it('carries the purchase operation id so reconciliation can close only that operation', () => {
    const snapshot = coManagedSnapshotFromStripe(input(subscription({
      metadata: { tenant_id: 'sponsor', subscription_kind: 'co_managed', operation_id: 'op-1' } })));
    expect(snapshot.operationId).toBe('op-1');
    expect(coManagedSnapshotFromStripe(input()).operationId).toBeUndefined();
  });

  it.each([
    { customer: 'another-customer' }, { metadata: {} },
    { metadata: { tenant_id: 'another-tenant', subscription_kind: 'co_managed' } },
    { items: { data: [] } },
  ])('rejects an unowned or misidentified subscription %j', (changes) => {
    expect(() => coManagedSnapshotFromStripe(input(subscription(changes)))).toThrow('owner or SKU');
  });

  // R1: currency and amount are not constants of this module; the configured price object decides.
  it.each([{ currency: 'eur' }, { currency: 'jpy', unit_amount: 1500 }, { unit_amount: 1499 }])(
    'accepts any configured currency or amount %j', (changes) => {
      expect(() => assertCoManagedPrice(price(changes) as unknown as Stripe.Price, 'price_co_managed')).not.toThrow();
    });

  it.each([
    { id: 'different-price' }, { type: 'one_time' }, { unit_amount: 0 }, { billing_scheme: 'tiered' },
    { recurring: { interval: 'year', interval_count: 1, usage_type: 'licensed' } },
    { recurring: { interval: 'month', interval_count: 2, usage_type: 'licensed' } },
    { recurring: { interval: 'month', interval_count: 1, usage_type: 'metered' } },
  ])('rejects a price that is not a simple monthly per-seat price %j', (changes) => {
    expect(() => assertCoManagedPrice(price(changes) as unknown as Stripe.Price, 'price_co_managed')).toThrow('monthly licensed per-seat');
  });

  it('is inactive without a paid latest invoice or a live Pro subscription', () => {
    expect(coManagedSnapshotFromStripe(input(subscription({ latest_invoice: { id: 'i', status: 'open' } }))).active).toBe(false);
    const fixture = input();
    fixture.baseSubscriptions = [];
    expect(coManagedSnapshotFromStripe(fixture).active).toBe(false);
  });
});
