import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@alga-psa/core/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const c4 = vi.hoisted(() => ({
  AlgaLicenseHttpError: class AlgaLicenseHttpError extends Error {
    constructor(message: string, readonly status: number) {
      super(message);
    }
  },
  revokeApplianceEntitlement: vi.fn(),
  reactivateApplianceEntitlement: vi.fn(),
  updateApplianceEntitlementSeats: vi.fn(),
}));

vi.mock('@ee/lib/applianceConsole/algaLicenseAdminClient', () => c4);

import logger from '@alga-psa/core/logger';
import {
  decideLifecycleAction,
  handleApplianceSubscriptionEvent,
  tenantIdFromSubscription,
} from '@ee/lib/applianceConsole/applianceSubscriptionLifecycle';

const TENANT = '4ead4fab-a3a5-4803-8905-bc5cd15ca6cb';

function subscription(overrides: Record<string, unknown> = {}): any {
  return {
    object: 'subscription',
    id: 'sub_app',
    status: 'active',
    metadata: { deploymentType: 'appliance', appliance_tenant_id: TENANT },
    items: { data: [{ id: 'si_1', quantity: 5, price: { id: 'price_seat', recurring: { interval: 'month' } } }] },
    ...overrides,
  };
}

function event(type: string, object: unknown, previous_attributes?: Record<string, unknown>): any {
  return { id: 'evt_1', type, data: { object, ...(previous_attributes ? { previous_attributes } : {}) } };
}

function deps() {
  return {
    revoke: c4.revokeApplianceEntitlement,
    reactivate: c4.reactivateApplianceEntitlement,
    syncSeats: c4.updateApplianceEntitlementSeats,
  };
}

const stripe = { subscriptions: { retrieve: vi.fn() } } as any;

describe('appliance subscription lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    c4.revokeApplianceEntitlement.mockResolvedValue({ revoked: true });
    c4.reactivateApplianceEntitlement.mockResolvedValue({ reactivated: true });
    // Stripe state "now" defaults to echoing the event's own subscription.
    stripe.subscriptions.retrieve.mockReset();
    c4.updateApplianceEntitlementSeats.mockResolvedValue({ stripe_sub_id: 'sub_app', tier: 'pro', seats: 5 });
  });

  it('reads the tenant id from either nm-store metadata key', () => {
    expect(tenantIdFromSubscription({ metadata: { appliance_tenant_id: TENANT } })).toBe(TENANT);
    expect(tenantIdFromSubscription({ metadata: { tenantId: TENANT } })).toBe(TENANT);
    expect(tenantIdFromSubscription({ metadata: {} })).toBeNull();
  });

  it('revokes on deletion and on lapse to unpaid/canceled', () => {
    expect(decideLifecycleAction(event('customer.subscription.deleted', subscription()), subscription())).toEqual({ action: 'revoke' });
    const lapsed = subscription({ status: 'unpaid' });
    expect(decideLifecycleAction(event('customer.subscription.updated', lapsed, { status: 'past_due' }), lapsed)).toEqual({ action: 'revoke' });
  });

  it('reactivates only on a lapsed→live transition, carrying seats when there is a per-seat item', () => {
    const sub = subscription();
    const upd = (prev?: Record<string, unknown>) => event('customer.subscription.updated', sub, prev);
    expect(decideLifecycleAction(upd({ status: 'unpaid' }), sub)).toEqual({ action: 'reactivate', seats: 5 });
    expect(decideLifecycleAction(upd({ status: 'canceled', items: {} }), sub)).toEqual({ action: 'reactivate', seats: 5 });
    const trialing = subscription({ status: 'trialing' });
    expect(decideLifecycleAction(event('customer.subscription.updated', trialing, { status: 'incomplete_expired' }), trialing)).toEqual({ action: 'reactivate', seats: 5 });
    const flat = subscription({ items: { data: [] } });
    expect(decideLifecycleAction(event('customer.subscription.updated', flat, { status: 'canceled' }), flat)).toEqual({ action: 'reactivate' });
  });

  it('does not reactivate on routine live updates (no status transition)', () => {
    const sub = subscription();
    const upd = (prev?: Record<string, unknown>) => event('customer.subscription.updated', sub, prev);
    expect(decideLifecycleAction(upd(), sub)).toEqual({ action: 'none' });
    expect(decideLifecycleAction(upd({ metadata: {} }), sub)).toEqual({ action: 'none' });
    expect(decideLifecycleAction(upd({ status: 'trialing' }), sub)).toEqual({ action: 'none' });
  });

  it('syncs seats only when the quantity changed on a live sub with no status transition', () => {
    const sub = subscription();
    expect(decideLifecycleAction(event('customer.subscription.updated', sub, { items: {} }), sub)).toEqual({ action: 'sync-seats', seats: 5 });
  });

  it('does nothing for non-lapsed, non-live statuses such as past_due', () => {
    const pastDue = subscription({ status: 'past_due' });
    expect(decideLifecycleAction(event('customer.subscription.updated', pastDue, { status: 'active' }), pastDue)).toEqual({ action: 'none' });
  });

  describe('reactivation gate: previous status must be one this handler revokes on', () => {
    const seatItems = { data: [{ id: 'si_1', quantity: 5, price: { id: 'price_seat', recurring: { interval: 'month' } } }] };
    const decide = (sub: any, prev: Record<string, unknown>) =>
      decideLifecycleAction(event('customer.subscription.updated', sub, prev), sub);

    it.each(['past_due', 'incomplete', 'paused'])('%s → active with no item change is none', (from) => {
      expect(decide(subscription(), { status: from })).toEqual({ action: 'none' });
    });

    it.each(['past_due', 'incomplete', 'paused'])('%s → active with items changed and a seat line is sync-seats, not reactivate', (from) => {
      expect(decide(subscription({ items: seatItems }), { status: from, items: {} })).toEqual({ action: 'sync-seats', seats: 5 });
    });

    it('past_due → active with items changed but no seat line is none', () => {
      expect(decide(subscription({ items: { data: [] } }), { status: 'past_due', items: {} })).toEqual({ action: 'none' });
    });

    it.each(['unpaid', 'canceled', 'incomplete_expired'])('%s → active reactivates with and without a seat line', (from) => {
      expect(decide(subscription(), { status: from })).toEqual({ action: 'reactivate', seats: 5 });
      expect(decide(subscription({ items: { data: [] } }), { status: from })).toEqual({ action: 'reactivate' });
    });

    it('handler: previous past_due never calls reactivate', async () => {
      const active = subscription();
      stripe.subscriptions.retrieve.mockResolvedValue(active);
      const outcome = await handleApplianceSubscriptionEvent(event('customer.subscription.updated', active, { status: 'past_due' }), stripe, deps());
      expect(outcome.action).toBe('none');
      expect(c4.reactivateApplianceEntitlement).not.toHaveBeenCalled();
      expect(c4.updateApplianceEntitlementSeats).not.toHaveBeenCalled();
    });
  });

  it('ignores hosted subscriptions', async () => {
    const hosted = subscription({ metadata: { tenant_id: 'hosted-tenant' } });
    const outcome = await handleApplianceSubscriptionEvent(event('customer.subscription.deleted', hosted), stripe);
    expect(outcome.handled).toBe(false);
    expect(c4.revokeApplianceEntitlement).not.toHaveBeenCalled();
  });

  it('calls C4 revoke for a deleted appliance subscription and audits it', async () => {
    const audit = vi.fn().mockResolvedValue(undefined);
    const outcome = await handleApplianceSubscriptionEvent(event('customer.subscription.deleted', subscription()), stripe, {
      ...deps(),
      audit,
    });
    expect(outcome).toMatchObject({ handled: true, tenantId: TENANT, subscriptionId: 'sub_app', action: 'revoke' });
    expect(c4.revokeApplianceEntitlement).toHaveBeenCalledWith('sub_app');
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'revoke', subscription_id: 'sub_app', tenant_id: TENANT }));
  });

  it('resolves the subscription for invoice events without acting on payment_failed', async () => {
    stripe.subscriptions.retrieve.mockResolvedValue(subscription());
    const invoiceEvent = event('invoice.payment_failed', { object: 'invoice', subscription: 'sub_app' });
    const outcome = await handleApplianceSubscriptionEvent(invoiceEvent, stripe, deps());
    expect(stripe.subscriptions.retrieve).toHaveBeenCalledWith('sub_app');
    expect(outcome).toMatchObject({ handled: true, action: 'none' });
    expect(c4.reactivateApplianceEntitlement).not.toHaveBeenCalled();
  });

  it('unpaid → revoke, then active with a seat line → reactivate before syncSeats', async () => {
    const unpaid = subscription({ status: 'unpaid' });
    stripe.subscriptions.retrieve.mockResolvedValue(unpaid);
    await handleApplianceSubscriptionEvent(event('customer.subscription.updated', unpaid, { status: 'active' }), stripe, deps());
    expect(c4.revokeApplianceEntitlement).toHaveBeenCalledWith('sub_app');

    const active = subscription({ items: { data: [{ id: 'si_1', quantity: 7, price: { id: 'price_seat', recurring: { interval: 'month' } } }] } });
    stripe.subscriptions.retrieve.mockResolvedValue(active);
    const outcome = await handleApplianceSubscriptionEvent(event('customer.subscription.updated', active, { status: 'unpaid' }), stripe, deps());
    expect(outcome).toMatchObject({ action: 'reactivate', seats: 7 });
    expect(c4.reactivateApplianceEntitlement).toHaveBeenCalledWith('sub_app');
    expect(c4.updateApplianceEntitlementSeats).toHaveBeenCalledWith(TENANT, 7);
    expect(c4.reactivateApplianceEntitlement.mock.invocationCallOrder[0]).toBeLessThan(
      c4.updateApplianceEntitlementSeats.mock.invocationCallOrder[0],
    );
  });

  it.each(['canceled', 'unpaid'])('flat subscription %s → active reactivates without a seat sync', async (from) => {
    const flat = subscription({ items: { data: [] } });
    stripe.subscriptions.retrieve.mockResolvedValue(flat);
    const outcome = await handleApplianceSubscriptionEvent(event('customer.subscription.updated', flat, { status: from }), stripe, deps());
    expect(outcome.action).toBe('reactivate');
    expect(c4.reactivateApplianceEntitlement).toHaveBeenCalledWith('sub_app');
    expect(c4.updateApplianceEntitlementSeats).not.toHaveBeenCalled();
  });

  it('a routine live update (no status/items change) calls neither reactivate nor syncSeats', async () => {
    const active = subscription();
    stripe.subscriptions.retrieve.mockResolvedValue(active);
    const outcome = await handleApplianceSubscriptionEvent(event('customer.subscription.updated', active, { metadata: {} }), stripe, deps());
    expect(outcome.action).toBe('none');
    await handleApplianceSubscriptionEvent(event('customer.subscription.updated', active), stripe, deps());
    expect(c4.reactivateApplianceEntitlement).not.toHaveBeenCalled();
    expect(c4.updateApplianceEntitlementSeats).not.toHaveBeenCalled();
  });

  it('a quantity change with no status change calls syncSeats only', async () => {
    const active = subscription();
    stripe.subscriptions.retrieve.mockResolvedValue(active);
    const outcome = await handleApplianceSubscriptionEvent(event('customer.subscription.updated', active, { items: {} }), stripe, deps());
    expect(outcome).toMatchObject({ action: 'sync-seats', seats: 5 });
    expect(c4.reactivateApplianceEntitlement).not.toHaveBeenCalled();
    expect(c4.updateApplianceEntitlementSeats).toHaveBeenCalledWith(TENANT, 5);
  });

  it('succeeds on duplicate delivery of the same reactivation event', async () => {
    const active = subscription();
    stripe.subscriptions.retrieve.mockResolvedValue(active);
    const evt = event('customer.subscription.updated', active, { status: 'unpaid' });
    await expect(handleApplianceSubscriptionEvent(evt, stripe, deps())).resolves.toMatchObject({ action: 'reactivate' });
    await expect(handleApplianceSubscriptionEvent(evt, stripe, deps())).resolves.toMatchObject({ action: 'reactivate' });
    expect(c4.reactivateApplianceEntitlement).toHaveBeenCalledTimes(2);
  });

  it('a stale updated(active) after the sub was deleted decides on Stripe\'s current state and revokes', async () => {
    const stale = subscription({ status: 'active' });
    stripe.subscriptions.retrieve.mockResolvedValue(subscription({ status: 'canceled' }));
    const outcome = await handleApplianceSubscriptionEvent(event('customer.subscription.updated', stale, { status: 'unpaid' }), stripe, deps());
    expect(outcome).toMatchObject({ action: 'revoke' });
    expect(c4.reactivateApplianceEntitlement).not.toHaveBeenCalled();
    expect(c4.revokeApplianceEntitlement).toHaveBeenCalledWith('sub_app');
  });

  it('treats a C4 404 on reactivate as nothing to do: warns, action none, no seat sync, no throw', async () => {
    const active = subscription();
    stripe.subscriptions.retrieve.mockResolvedValue(active);
    c4.reactivateApplianceEntitlement.mockRejectedValue(new c4.AlgaLicenseHttpError('HTTP 404 not_found', 404));
    const outcome = await handleApplianceSubscriptionEvent(event('customer.subscription.updated', active, { status: 'unpaid' }), stripe, deps());
    expect(outcome).toMatchObject({ handled: true, action: 'none' });
    expect(outcome.seats).toBeUndefined();
    expect(c4.updateApplianceEntitlementSeats).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('sub_app'));
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining(TENANT));
  });

  it('propagates a C4 500 on reactivate so Stripe retries, and skips the seat sync', async () => {
    const active = subscription();
    stripe.subscriptions.retrieve.mockResolvedValue(active);
    c4.reactivateApplianceEntitlement.mockRejectedValue(new c4.AlgaLicenseHttpError('HTTP 500', 500));
    await expect(
      handleApplianceSubscriptionEvent(event('customer.subscription.updated', active, { status: 'unpaid' }), stripe, deps()),
    ).rejects.toThrow('HTTP 500');
    expect(c4.updateApplianceEntitlementSeats).not.toHaveBeenCalled();
  });

  it('still reactivates an active sub with no tenant id, skipping the seat sync with a warning', async () => {
    const orphan = subscription({ metadata: { deploymentType: 'appliance' } });
    stripe.subscriptions.retrieve.mockResolvedValue(orphan);
    const outcome = await handleApplianceSubscriptionEvent(event('customer.subscription.updated', orphan, { status: 'unpaid' }), stripe, deps());
    expect(outcome.action).toBe('reactivate');
    expect(outcome.seats).toBeUndefined();
    expect(c4.reactivateApplianceEntitlement).toHaveBeenCalledWith('sub_app');
    expect(c4.updateApplianceEntitlementSeats).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('no tenant id'));
  });
});
