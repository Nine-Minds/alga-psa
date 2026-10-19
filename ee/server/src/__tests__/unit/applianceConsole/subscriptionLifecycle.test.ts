import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@alga-psa/core/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const c4 = vi.hoisted(() => ({
  revokeApplianceEntitlement: vi.fn(),
  updateApplianceEntitlementSeats: vi.fn(),
  syncApplianceSubscriptionState: vi.fn(),
}));

vi.mock('@ee/lib/applianceConsole/algaLicenseAdminClient', () => c4);

import {
  decideLifecycleAction,
  handleApplianceSubscriptionEvent,
  tenantIdFromSubscription,
} from '@ee/lib/applianceConsole/applianceSubscriptionLifecycle';

const PERIOD_END = 1_790_000_000;
const TENANT = '4ead4fab-a3a5-4803-8905-bc5cd15ca6cb';

function subscription(overrides: Record<string, unknown> = {}): any {
  return {
    object: 'subscription',
    id: 'sub_app',
    status: 'active',
    metadata: { deploymentType: 'appliance', appliance_tenant_id: TENANT },
    cancel_at_period_end: false,
    cancel_at: null,
    canceled_at: null,
    items: { data: [{ id: 'si_1', quantity: 5, current_period_end: PERIOD_END, price: { id: 'price_seat', recurring: { interval: 'month' } } }] },
    ...overrides,
  };
}

function event(type: string, object: unknown, previous_attributes?: Record<string, unknown>): any {
  return { id: 'evt_1', type, created: 1_789_000_000, data: { object, ...(previous_attributes ? { previous_attributes } : {}) } };
}

const stripe = { subscriptions: { retrieve: vi.fn() } } as any;

describe('appliance subscription lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    c4.revokeApplianceEntitlement.mockResolvedValue({ revoked: true });
    c4.updateApplianceEntitlementSeats.mockResolvedValue({ stripe_sub_id: 'sub_app', tier: 'pro', seats: 5 });
    c4.syncApplianceSubscriptionState.mockResolvedValue({ updated: true });
  });

  it('reads the tenant id from either nm-store metadata key', () => {
    expect(tenantIdFromSubscription({ metadata: { appliance_tenant_id: TENANT } })).toBe(TENANT);
    expect(tenantIdFromSubscription({ metadata: { tenantId: TENANT } })).toBe(TENANT);
    expect(tenantIdFromSubscription({ metadata: {} })).toBeNull();
  });

  it('revokes on deletion and on lapse to unpaid/canceled', () => {
    expect(decideLifecycleAction(event('customer.subscription.deleted', subscription()), subscription())).toMatchObject({ action: 'revoke' });
    const lapsed = subscription({ status: 'unpaid' });
    expect(decideLifecycleAction(event('customer.subscription.updated', lapsed, { status: 'past_due' }), lapsed)).toMatchObject({ action: 'revoke' });
  });

  it('syncs seats when the quantity changed or the sub came back to life', () => {
    const sub = subscription();
    expect(decideLifecycleAction(event('customer.subscription.updated', sub, { items: {} }), sub)).toMatchObject({ action: 'sync-seats', seats: 5 });
    expect(decideLifecycleAction(event('customer.subscription.updated', sub, { status: 'unpaid' }), sub)).toMatchObject({ action: 'sync-seats', seats: 5 });
    expect(decideLifecycleAction(event('customer.subscription.updated', sub, { metadata: {} }), sub)).toMatchObject({ action: 'none' });
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
      revoke: c4.revokeApplianceEntitlement,
      syncSeats: c4.updateApplianceEntitlementSeats,
      syncState: c4.syncApplianceSubscriptionState,
      audit,
    });
    expect(outcome).toMatchObject({ handled: true, tenantId: TENANT, subscriptionId: 'sub_app', action: 'revoke' });
    expect(c4.revokeApplianceEntitlement).toHaveBeenCalledWith('sub_app');
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'revoke', subscription_id: 'sub_app', tenant_id: TENANT }));
  });

  it('resolves the subscription for invoice events and syncs seats on reactivation', async () => {
    stripe.subscriptions.retrieve.mockResolvedValue(subscription());
    const invoiceEvent = event('invoice.payment_failed', { object: 'invoice', subscription: 'sub_app' });
    const outcome = await handleApplianceSubscriptionEvent(invoiceEvent, stripe);
    expect(stripe.subscriptions.retrieve).toHaveBeenCalledWith('sub_app');
    expect(outcome).toMatchObject({ handled: true, action: 'none' });

    const revived = subscription();
    const out2 = await handleApplianceSubscriptionEvent(event('customer.subscription.updated', revived, { status: 'unpaid' }), stripe);
    expect(out2.action).toBe('sync-seats');
    expect(c4.updateApplianceEntitlementSeats).toHaveBeenCalledWith(TENANT, 5);
  });

  it('does not sync seats without a tenant id in metadata', async () => {
    const orphan = subscription({ metadata: { deploymentType: 'appliance' } });
    const outcome = await handleApplianceSubscriptionEvent(event('customer.subscription.updated', orphan, { items: {} }), stripe);
    expect(outcome.action).toBe('none');
    expect(c4.updateApplianceEntitlementSeats).not.toHaveBeenCalled();
  });
  describe('state mirroring', () => {
    const deps = (over: Record<string, unknown> = {}) => ({
      revoke: c4.revokeApplianceEntitlement,
      syncSeats: c4.updateApplianceEntitlementSeats,
      syncState: c4.syncApplianceSubscriptionState,
      ...over,
    });

    it('cancel-at-period-end request: mirrors state, does NOT revoke', async () => {
      const sub = subscription({ cancel_at_period_end: true, cancel_at: PERIOD_END });
      const ev = event('customer.subscription.updated', sub, { cancel_at_period_end: false, cancel_at: null });
      expect(decideLifecycleAction(ev, sub)).toEqual({
        action: 'none',
        state: { status: 'active', cancel_at_period_end: true, cancel_at: PERIOD_END, canceled_at: null, current_period_end: PERIOD_END },
      });
      const outcome = await handleApplianceSubscriptionEvent(ev, stripe, deps());
      expect(outcome.action).toBe('none');
      expect(c4.revokeApplianceEntitlement).not.toHaveBeenCalled();
      expect(c4.syncApplianceSubscriptionState).toHaveBeenCalledWith('sub_app', expect.objectContaining({ cancel_at_period_end: true, cancel_at: PERIOD_END }));
    });

    it('scheduled cancel via cancel_at (not period end) also does not revoke', async () => {
      const sub = subscription({ cancel_at: PERIOD_END + 100 });
      await handleApplianceSubscriptionEvent(event('customer.subscription.updated', sub, { cancel_at: null }), stripe, deps());
      expect(c4.revokeApplianceEntitlement).not.toHaveBeenCalled();
      expect(c4.syncApplianceSubscriptionState).toHaveBeenCalledWith('sub_app', expect.objectContaining({ cancel_at: PERIOD_END + 100 }));
    });

    it('undo cancel: mirrors cleared flags, no revoke', async () => {
      const sub = subscription();
      const ev = event('customer.subscription.updated', sub, { cancel_at_period_end: true, cancel_at: PERIOD_END });
      await handleApplianceSubscriptionEvent(ev, stripe, deps());
      expect(c4.revokeApplianceEntitlement).not.toHaveBeenCalled();
      expect(c4.syncApplianceSubscriptionState).toHaveBeenCalledWith('sub_app', {
        status: 'active', cancel_at_period_end: false, cancel_at: null, canceled_at: null, current_period_end: PERIOD_END,
      });
    });

    it('immediate cancel (deleted): revokes, then mirrors canceled with canceled_at', async () => {
      const sub = subscription({ status: 'canceled', canceled_at: 1_789_000_000 });
      const order: string[] = [];
      c4.revokeApplianceEntitlement.mockImplementation(async () => { order.push('revoke'); });
      c4.syncApplianceSubscriptionState.mockImplementation(async () => { order.push('state'); });
      await handleApplianceSubscriptionEvent(event('customer.subscription.deleted', sub), stripe, deps());
      expect(order).toEqual(['revoke', 'state']);
      expect(c4.syncApplianceSubscriptionState).toHaveBeenCalledWith('sub_app', {
        status: 'canceled', cancel_at_period_end: false, cancel_at: null, canceled_at: 1_789_000_000, current_period_end: PERIOD_END,
      });
    });

    it('deleted at period end (was pending cancel): revokes and keeps the cancel flags', async () => {
      const sub = subscription({ status: 'canceled', cancel_at_period_end: true, cancel_at: PERIOD_END, canceled_at: PERIOD_END });
      await handleApplianceSubscriptionEvent(event('customer.subscription.deleted', sub), stripe, deps());
      expect(c4.revokeApplianceEntitlement).toHaveBeenCalledWith('sub_app');
      expect(c4.syncApplianceSubscriptionState).toHaveBeenCalledWith('sub_app', expect.objectContaining({ status: 'canceled', cancel_at_period_end: true, canceled_at: PERIOD_END }));
    });

    it('deleted payload without canceled_at falls back to the event time and forces canceled', async () => {
      const sub = subscription({ status: 'active' });
      await handleApplianceSubscriptionEvent(event('customer.subscription.deleted', sub), stripe, deps());
      expect(c4.syncApplianceSubscriptionState).toHaveBeenCalledWith('sub_app', expect.objectContaining({ status: 'canceled', canceled_at: 1_789_000_000 }));
    });

    it('updated into unpaid: revokes and mirrors', async () => {
      const sub = subscription({ status: 'unpaid' });
      await handleApplianceSubscriptionEvent(event('customer.subscription.updated', sub, { status: 'past_due' }), stripe, deps());
      expect(c4.revokeApplianceEntitlement).toHaveBeenCalledWith('sub_app');
      expect(c4.syncApplianceSubscriptionState).toHaveBeenCalledWith('sub_app', expect.objectContaining({ status: 'unpaid' }));
    });

    it('created: mirrors state (no revoke, no seat sync)', async () => {
      const outcome = await handleApplianceSubscriptionEvent(event('customer.subscription.created', subscription()), stripe, deps());
      expect(outcome).toMatchObject({ handled: true, action: 'none' });
      expect(c4.syncApplianceSubscriptionState).toHaveBeenCalledWith('sub_app', expect.objectContaining({ status: 'active', current_period_end: PERIOD_END }));
      expect(c4.revokeApplianceEntitlement).not.toHaveBeenCalled();
      expect(c4.updateApplianceEntitlementSeats).not.toHaveBeenCalled();
    });

    it('seat sync still works alongside the mirror', async () => {
      const sub = subscription();
      await handleApplianceSubscriptionEvent(event('customer.subscription.updated', sub, { items: {} }), stripe, deps());
      expect(c4.updateApplianceEntitlementSeats).toHaveBeenCalledWith(TENANT, 5);
      expect(c4.syncApplianceSubscriptionState).toHaveBeenCalledTimes(1);
    });

    it('reads current_period_end from the legacy subscription field when items lack it', async () => {
      const sub = subscription({ current_period_end: 42, items: { data: [{ id: 'si_1', quantity: 5, price: { id: 'p' } }] } });
      await handleApplianceSubscriptionEvent(event('customer.subscription.created', sub), stripe, deps());
      expect(c4.syncApplianceSubscriptionState).toHaveBeenCalledWith('sub_app', expect.objectContaining({ current_period_end: 42 }));
    });

    it('does not mirror state for invoice events', async () => {
      stripe.subscriptions.retrieve.mockResolvedValue(subscription());
      await handleApplianceSubscriptionEvent(event('invoice.payment_failed', { object: 'invoice', subscription: 'sub_app' }), stripe, deps());
      expect(c4.syncApplianceSubscriptionState).not.toHaveBeenCalled();
    });
  });
});
