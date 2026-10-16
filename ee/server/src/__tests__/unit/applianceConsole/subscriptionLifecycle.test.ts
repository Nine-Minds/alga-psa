import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@alga-psa/core/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const c4 = vi.hoisted(() => ({
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

  it('reactivates on any live status, carrying seats when there is a per-seat item', () => {
    const sub = subscription();
    const upd = (prev?: Record<string, unknown>) => event('customer.subscription.updated', sub, prev);
    expect(decideLifecycleAction(upd({ status: 'unpaid' }), sub)).toEqual({ action: 'reactivate', seats: 5 });
    expect(decideLifecycleAction(upd({ items: {} }), sub)).toEqual({ action: 'reactivate', seats: 5 });
    expect(decideLifecycleAction(upd(), sub)).toEqual({ action: 'reactivate', seats: 5 });
    const trialing = subscription({ status: 'trialing' });
    expect(decideLifecycleAction(event('customer.subscription.updated', trialing), trialing)).toEqual({ action: 'reactivate', seats: 5 });
    const flat = subscription({ items: { data: [] } });
    expect(decideLifecycleAction(event('customer.subscription.updated', flat, { status: 'canceled' }), flat)).toEqual({ action: 'reactivate' });
  });

  it('does nothing for non-lapsed, non-live statuses such as past_due', () => {
    const pastDue = subscription({ status: 'past_due' });
    expect(decideLifecycleAction(event('customer.subscription.updated', pastDue, { status: 'active' }), pastDue)).toEqual({ action: 'none' });
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

  it('reactivates on an active update with no previous_attributes (retry / out-of-order)', async () => {
    const active = subscription();
    stripe.subscriptions.retrieve.mockResolvedValue(active);
    await handleApplianceSubscriptionEvent(event('customer.subscription.updated', active), stripe, deps());
    expect(c4.reactivateApplianceEntitlement).toHaveBeenCalledWith('sub_app');
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

  it('propagates a reactivate failure so Stripe retries, and skips the seat sync', async () => {
    const active = subscription();
    stripe.subscriptions.retrieve.mockResolvedValue(active);
    c4.reactivateApplianceEntitlement.mockRejectedValue(new Error('alga-license down'));
    await expect(
      handleApplianceSubscriptionEvent(event('customer.subscription.updated', active, { status: 'unpaid' }), stripe, deps()),
    ).rejects.toThrow('alga-license down');
    expect(c4.updateApplianceEntitlementSeats).not.toHaveBeenCalled();
  });

  it('still reactivates an active sub with no tenant id, skipping the seat sync with a warning', async () => {
    const orphan = subscription({ metadata: { deploymentType: 'appliance' } });
    stripe.subscriptions.retrieve.mockResolvedValue(orphan);
    const outcome = await handleApplianceSubscriptionEvent(event('customer.subscription.updated', orphan, { items: {} }), stripe, deps());
    expect(outcome.action).toBe('reactivate');
    expect(outcome.seats).toBeUndefined();
    expect(c4.reactivateApplianceEntitlement).toHaveBeenCalledWith('sub_app');
    expect(c4.updateApplianceEntitlementSeats).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('no tenant id'));
  });
});
