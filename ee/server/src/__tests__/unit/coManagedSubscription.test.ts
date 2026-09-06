import type Stripe from 'stripe';
import { describe, expect, it } from 'vitest';
import { coManagedSnapshotFromStripe, isCoManagedSubscription } from '../../lib/stripe/coManagedSubscription';

const now = new Date('2026-09-06T12:00:00Z');
const end = now.getTime() / 1000 + 3600;

function subscription(overrides: Record<string, unknown> = {}): Stripe.Subscription {
  return {
    id: 'sub_co_managed', customer: 'cus_sponsor', status: 'active', current_period_end: end,
    metadata: { tenant_id: 'sponsor', subscription_kind: 'co_managed' },
    latest_invoice: { id: 'invoice', status: 'paid' },
    items: { data: [{ id: 'si_co_managed', quantity: 5, price: { id: 'price_co_managed', currency: 'usd',
      unit_amount: 1149, recurring: { interval: 'month', interval_count: 1, usage_type: 'licensed' } } }] },
    ...overrides,
  } as unknown as Stripe.Subscription;
}

function input(sub = subscription()) {
  return { subscription: sub, baseSubscriptions: [subscription({ id: 'sub_pro', metadata: {},
    items: { data: [{ price: { id: 'price_pro' }, quantity: 8 }] } })],
  sponsorTenant: 'sponsor', customerId: 'cus_sponsor', coManagedPriceId: 'price_co_managed', proPriceIds: ['price_pro'], now };
}

describe('co-managed Stripe entitlement adapter', () => {
  it('recognizes the dedicated SKU even when its metadata is missing', () => {
    expect(isCoManagedSubscription(subscription({ metadata: {} }), 'price_co_managed')).toBe(true);
    expect(isCoManagedSubscription(subscription(), undefined)).toBe(true);
    expect(isCoManagedSubscription(input().baseSubscriptions[0], 'price_co_managed')).toBe(false);
  });

  it('counts only customer seats and bounds validity by the Pro subscription', () => {
    const fixture = input();
    Object.assign(fixture.baseSubscriptions[0], { current_period_end: end - 60 });
    expect(coManagedSnapshotFromStripe(fixture)).toEqual({ capacity: 5, active: true, validUntil: new Date((end - 60) * 1000) });
  });

  it.each([
    { customer: 'another-customer' }, { metadata: {} },
    { metadata: { tenant_id: 'another-tenant', subscription_kind: 'co_managed' } },
    { items: { data: [] } },
  ])('rejects an unowned or misidentified subscription %j', (changes) => {
    expect(() => coManagedSnapshotFromStripe(input(subscription(changes)))).toThrow('owner or SKU');
  });

  it.each([
    { currency: 'eur' }, { unit_amount: 1499 }, { id: 'different-price' },
    { recurring: { interval: 'year', interval_count: 1, usage_type: 'licensed' } },
    { recurring: { interval: 'month', interval_count: 2, usage_type: 'licensed' } },
    { recurring: { interval: 'month', interval_count: 1, usage_type: 'metered' } },
  ])('rejects an incorrect price contract %j', (changes) => {
    const fixture = input();
    Object.assign(fixture.subscription.items.data[0].price, changes);
    expect(() => coManagedSnapshotFromStripe(fixture)).toThrow('USD monthly licensed price');
  });

  it.each(['past_due', 'unpaid', 'canceled', 'incomplete', 'trialing'])('does not grant capacity for %s', (status) => {
    expect(coManagedSnapshotFromStripe(input(subscription({ status }))).active).toBe(false);
  });

  it.each([null, 'in_unexpanded', { status: 'open' }])('requires verified paid invoice data: %j', (latest_invoice) => {
    expect(coManagedSnapshotFromStripe(input(subscription({ latest_invoice }))).active).toBe(false);
  });

  it('supports item-level periods returned by newer Stripe API versions', () => {
    const fixture = input();
    Object.assign(fixture.subscription, { current_period_end: undefined });
    fixture.subscription.items.data[0].current_period_end = end;
    expect(coManagedSnapshotFromStripe(fixture).validUntil).toEqual(new Date(end * 1000));
  });

  it('does not treat co-managed capacity or an add-on as its own sponsoring Pro subscription', () => {
    const fixture = input();
    fixture.baseSubscriptions = [subscription()];
    expect(coManagedSnapshotFromStripe(fixture).active).toBe(false);
    fixture.baseSubscriptions = [subscription({ metadata: { addon_key: 'ai_assistant' },
      items: { data: [{ price: { id: 'price_pro' } }] } })];
    expect(coManagedSnapshotFromStripe(fixture).active).toBe(false);
  });
});
