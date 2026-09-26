import { describe, expect, it } from 'vitest';
import { computeDrift, findPerSeatItem, toBillingView, dashboardUrl } from '@ee/lib/applianceConsole/stripeBilling';

function sub(overrides: Record<string, unknown> = {}): any {
  return {
    id: 'sub_123',
    status: 'active',
    livemode: false,
    customer: 'cus_9',
    cancel_at: null,
    cancel_at_period_end: false,
    pause_collection: null,
    current_period_end: 1_800_000_000,
    items: {
      data: [
        { id: 'si_base', quantity: 1, price: { id: 'price_base', recurring: { interval: 'month' } } },
        { id: 'si_seats', quantity: 12, price: { id: 'price_pro_user_month', recurring: { interval: 'month' } } },
      ],
    },
    ...overrides,
  };
}

const env = { STRIPE_PRICE_ID_APPLIANCE_PRO_USER_MONTHLY: 'price_pro_user_month' } as unknown as NodeJS.ProcessEnv;

describe('stripeBilling', () => {
  it('finds the per-seat line by configured price id, else the single line', () => {
    expect(findPerSeatItem(sub(), env)?.id).toBe('si_seats');
    const single = sub({ items: { data: [{ id: 'si_only', quantity: 3, price: { id: 'price_x', recurring: { interval: 'year' } } }] } });
    expect(findPerSeatItem(single, {} as NodeJS.ProcessEnv)?.id).toBe('si_only');
    expect(findPerSeatItem(sub(), {} as NodeJS.ProcessEnv)).toBeNull();
  });

  it('maps a subscription to the console view with dashboard links', () => {
    const view = toBillingView(sub({ pause_collection: { behavior: 'void', resumes_at: 1_700_000_000 } }), env);
    expect(view).toMatchObject({
      subscription_id: 'sub_123',
      status: 'active',
      seat_quantity: 12,
      per_seat_item_id: 'si_seats',
      price_id: 'price_pro_user_month',
      interval: 'month',
      customer_id: 'cus_9',
      current_period_end: 1_800_000_000,
      pause_collection: { behavior: 'void', resumes_at: 1_700_000_000 },
      dashboard_subscription_url: 'https://dashboard.stripe.com/test/subscriptions/sub_123',
      dashboard_customer_url: 'https://dashboard.stripe.com/test/customers/cus_9',
      livemode: false,
    });
    expect(dashboardUrl(true, 'subscriptions/sub_1')).toBe('https://dashboard.stripe.com/subscriptions/sub_1');
  });

  it('flags seat and status drift between Stripe and the entitlement', () => {
    const view = toBillingView(sub(), env);
    expect(computeDrift(view, { seats: 12, active: true })).toEqual({ seats_mismatch: false, status_mismatch: false });
    expect(computeDrift(view, { seats: 10, active: true })).toEqual({ seats_mismatch: true, status_mismatch: false });
    expect(computeDrift(toBillingView(sub({ status: 'canceled' }), env), { seats: 12, active: true })).toEqual({
      seats_mismatch: false,
      status_mismatch: true,
    });
    // Unlimited seats in C4 never count as drift.
    expect(computeDrift(view, { seats: null, active: true }).seats_mismatch).toBe(false);
    expect(computeDrift(null, { seats: 1, active: true })).toEqual({ seats_mismatch: false, status_mismatch: false });
  });
});
