import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@alga-psa/core/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const c4 = vi.hoisted(() => ({
  AlgaLicenseHttpError: class AlgaLicenseHttpError extends Error {
    constructor(message: string, readonly status: number, readonly code?: string) {
      super(message);
    }
  },
  revokeApplianceEntitlement: vi.fn(),
  reactivateApplianceEntitlement: vi.fn(),
  updateApplianceEntitlementSeats: vi.fn(),
  syncApplianceSubscriptionState: vi.fn(),
}));

vi.mock('@ee/lib/applianceConsole/algaLicenseAdminClient', () => c4);

import logger from '@alga-psa/core/logger';
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

// alga-license's real "no entitlement" 404 carries code 'not_found'; Fastify's unknown-route 404 has none.
const notFound = () => new c4.AlgaLicenseHttpError('HTTP 404 — No active entitlement (not_found)', 404, 'not_found');
const routeMissing = () => new c4.AlgaLicenseHttpError('HTTP 404 Route not found', 404);

function deps() {
  return {
    revoke: c4.revokeApplianceEntitlement,
    reactivate: c4.reactivateApplianceEntitlement,
    syncSeats: c4.updateApplianceEntitlementSeats,
    syncState: c4.syncApplianceSubscriptionState,
  };
}

// The decision also carries the state mirror; these branch tests assert the action only.
const decideAction = (e: any, sub: any) => {
  const { state: _state, ...rest } = decideLifecycleAction(e, sub);
  return rest;
};

const stripe = { subscriptions: { retrieve: vi.fn() } } as any;

describe('appliance subscription lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    c4.revokeApplianceEntitlement.mockResolvedValue({ revoked: true });
    c4.reactivateApplianceEntitlement.mockResolvedValue({ reactivated: true });
    // Stripe state "now" defaults to echoing the event's own subscription.
    stripe.subscriptions.retrieve.mockReset();
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

  it('reactivates only on a lapsed→live transition, carrying seats when there is a per-seat item', () => {
    const sub = subscription();
    const upd = (prev?: Record<string, unknown>) => event('customer.subscription.updated', sub, prev);
    expect(decideAction(upd({ status: 'unpaid' }), sub)).toEqual({ action: 'reactivate', seats: 5 });
    expect(decideAction(upd({ status: 'canceled', items: {} }), sub)).toEqual({ action: 'reactivate', seats: 5 });
    const trialing = subscription({ status: 'trialing' });
    expect(decideAction(event('customer.subscription.updated', trialing, { status: 'incomplete_expired' }), trialing)).toEqual({ action: 'reactivate', seats: 5 });
    const flat = subscription({ items: { data: [] } });
    expect(decideAction(event('customer.subscription.updated', flat, { status: 'canceled' }), flat)).toEqual({ action: 'reactivate' });
  });

  it('does not reactivate on routine live updates (no status transition)', () => {
    const sub = subscription();
    const upd = (prev?: Record<string, unknown>) => event('customer.subscription.updated', sub, prev);
    expect(decideAction(upd(), sub)).toEqual({ action: 'none' });
    expect(decideAction(upd({ metadata: {} }), sub)).toEqual({ action: 'none' });
    expect(decideAction(upd({ status: 'trialing' }), sub)).toEqual({ action: 'none' });
  });

  it('syncs seats only when the quantity changed on a live sub with no status transition', () => {
    const sub = subscription();
    expect(decideAction(event('customer.subscription.updated', sub, { items: {} }), sub)).toEqual({ action: 'sync-seats', seats: 5 });
    expect(decideAction(event('customer.subscription.updated', sub, { metadata: {} }), sub)).toEqual({ action: 'none' });
  });

  it('does nothing for non-lapsed, non-live statuses such as past_due', () => {
    const pastDue = subscription({ status: 'past_due' });
    expect(decideAction(event('customer.subscription.updated', pastDue, { status: 'active' }), pastDue)).toEqual({ action: 'none' });
  });

  describe('reactivation gate: previous status must be one this handler revokes on', () => {
    const seatItems = { data: [{ id: 'si_1', quantity: 5, price: { id: 'price_seat', recurring: { interval: 'month' } } }] };
    const decide = (sub: any, prev: Record<string, unknown>) =>
      decideAction(event('customer.subscription.updated', sub, prev), sub);

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
    c4.reactivateApplianceEntitlement.mockRejectedValue(notFound());
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

  describe('seat sync 404 (entitlement inactive/absent) is terminal, other errors retry', () => {
    const seatChange = () => {
      const active = subscription();
      stripe.subscriptions.retrieve.mockResolvedValue(active);
      return event('customer.subscription.updated', active, { items: {} });
    };
    const reactivation = () => {
      const active = subscription();
      stripe.subscriptions.retrieve.mockResolvedValue(active);
      return event('customer.subscription.updated', active, { status: 'unpaid' });
    };

    it('sync-seats: 404 resolves with action none, no seats, and a warning', async () => {
      c4.updateApplianceEntitlementSeats.mockRejectedValue(notFound());
      const outcome = await handleApplianceSubscriptionEvent(seatChange(), stripe, deps());
      expect(outcome).toMatchObject({ handled: true, action: 'none' });
      expect(outcome.seats).toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('[ApplianceLifecycle]'));
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('seats not synced'));
    });

    it('sync-seats: a generic error is rethrown', async () => {
      c4.updateApplianceEntitlementSeats.mockRejectedValue(new Error('network down'));
      await expect(handleApplianceSubscriptionEvent(seatChange(), stripe, deps())).rejects.toThrow('network down');
    });

    it('sync-seats: a 5xx is rethrown', async () => {
      c4.updateApplianceEntitlementSeats.mockRejectedValue(new c4.AlgaLicenseHttpError('HTTP 502', 502));
      await expect(handleApplianceSubscriptionEvent(seatChange(), stripe, deps())).rejects.toThrow('HTTP 502');
    });

    it('reactivate: a seat-sync 404 keeps action reactivate with no seats', async () => {
      c4.updateApplianceEntitlementSeats.mockRejectedValue(notFound());
      const outcome = await handleApplianceSubscriptionEvent(reactivation(), stripe, deps());
      expect(outcome).toMatchObject({ handled: true, action: 'reactivate' });
      expect(outcome.seats).toBeUndefined();
      expect(c4.reactivateApplianceEntitlement).toHaveBeenCalledWith('sub_app');
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('seats not synced'));
    });

    it('reactivate: a generic seat-sync error is rethrown', async () => {
      c4.updateApplianceEntitlementSeats.mockRejectedValue(new Error('network down'));
      await expect(handleApplianceSubscriptionEvent(reactivation(), stripe, deps())).rejects.toThrow('network down');
    });
  });

  describe('route-missing 404 (no not_found code) is retryable, not tolerated', () => {
    const seatChange = () => {
      const active = subscription();
      stripe.subscriptions.retrieve.mockResolvedValue(active);
      return event('customer.subscription.updated', active, { items: {} });
    };
    const reactivation = () => {
      const active = subscription();
      stripe.subscriptions.retrieve.mockResolvedValue(active);
      return event('customer.subscription.updated', active, { status: 'unpaid' });
    };
    const loudError = () =>
      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('alga-license lacks route — deploy alga-license first'));

    it('reactivate: route-missing 404 throws, skips seat sync and state mirror, logs the cause', async () => {
      c4.reactivateApplianceEntitlement.mockRejectedValue(routeMissing());
      await expect(handleApplianceSubscriptionEvent(reactivation(), stripe, deps())).rejects.toThrow('HTTP 404');
      expect(c4.updateApplianceEntitlementSeats).not.toHaveBeenCalled();
      expect(c4.syncApplianceSubscriptionState).not.toHaveBeenCalled();
      loudError();
    });

    it('sync-seats: route-missing 404 throws and logs the cause', async () => {
      c4.updateApplianceEntitlementSeats.mockRejectedValue(routeMissing());
      await expect(handleApplianceSubscriptionEvent(seatChange(), stripe, deps())).rejects.toThrow('HTTP 404');
      loudError();
    });

    it('post-reactivate seat sync: route-missing 404 throws and logs the cause', async () => {
      c4.updateApplianceEntitlementSeats.mockRejectedValue(routeMissing());
      await expect(handleApplianceSubscriptionEvent(reactivation(), stripe, deps())).rejects.toThrow('HTTP 404');
      expect(c4.reactivateApplianceEntitlement).toHaveBeenCalledWith('sub_app');
      loudError();
    });

    it('state mirror: route-missing 404 throws and logs the cause', async () => {
      c4.syncApplianceSubscriptionState.mockRejectedValue(routeMissing());
      await expect(handleApplianceSubscriptionEvent(seatChange(), stripe, deps())).rejects.toThrow('HTTP 404');
      loudError();
    });

    it('operator-revoked but Stripe-live sub: seat change is tolerated (real not_found), no reactivate', async () => {
      c4.updateApplianceEntitlementSeats.mockRejectedValue(notFound());
      const outcome = await handleApplianceSubscriptionEvent(seatChange(), stripe, deps());
      expect(outcome).toMatchObject({ handled: true, action: 'none' });
      expect(c4.reactivateApplianceEntitlement).not.toHaveBeenCalled();
      expect(c4.revokeApplianceEntitlement).not.toHaveBeenCalled();
      expect(logger.error).not.toHaveBeenCalled();
    });
  });

  describe('state mirroring', () => {
    it('cancel-at-period-end request: mirrors state, does NOT revoke', async () => {
      const sub = subscription({ cancel_at_period_end: true, cancel_at: PERIOD_END });
      stripe.subscriptions.retrieve.mockResolvedValue(sub); // `updated` decides on Stripe's current state
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
      stripe.subscriptions.retrieve.mockResolvedValue(sub); // `updated` decides on Stripe's current state
      await handleApplianceSubscriptionEvent(event('customer.subscription.updated', sub, { cancel_at: null }), stripe, deps());
      expect(c4.revokeApplianceEntitlement).not.toHaveBeenCalled();
      expect(c4.syncApplianceSubscriptionState).toHaveBeenCalledWith('sub_app', expect.objectContaining({ cancel_at: PERIOD_END + 100 }));
    });

    it('undo cancel: mirrors cleared flags, no revoke', async () => {
      const sub = subscription();
      stripe.subscriptions.retrieve.mockResolvedValue(sub); // `updated` decides on Stripe's current state
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
      stripe.subscriptions.retrieve.mockResolvedValue(sub); // `updated` decides on Stripe's current state
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
      stripe.subscriptions.retrieve.mockResolvedValue(sub); // `updated` decides on Stripe's current state
      await handleApplianceSubscriptionEvent(event('customer.subscription.updated', sub, { items: {} }), stripe, deps());
      expect(c4.updateApplianceEntitlementSeats).toHaveBeenCalledWith(TENANT, 5);
      expect(c4.syncApplianceSubscriptionState).toHaveBeenCalledTimes(1);
    });

    it('reactivation: reactivate, then seats, then state mirror (state carries the live status)', async () => {
      const active = subscription();
      stripe.subscriptions.retrieve.mockResolvedValue(active);
      const order: string[] = [];
      c4.reactivateApplianceEntitlement.mockImplementation(async () => { order.push('reactivate'); });
      c4.updateApplianceEntitlementSeats.mockImplementation(async () => { order.push('seats'); });
      c4.syncApplianceSubscriptionState.mockImplementation(async () => { order.push('state'); });
      const outcome = await handleApplianceSubscriptionEvent(event('customer.subscription.updated', active, { status: 'unpaid' }), stripe, deps());
      expect(order).toEqual(['reactivate', 'seats', 'state']);
      expect(outcome.state).toMatchObject({ status: 'active' });
      expect(c4.syncApplianceSubscriptionState).toHaveBeenCalledWith('sub_app', expect.objectContaining({ status: 'active' }));
    });

    it('flat reactivation still mirrors state (no seat sync)', async () => {
      const flat = subscription({ items: { data: [] } });
      stripe.subscriptions.retrieve.mockResolvedValue(flat);
      await handleApplianceSubscriptionEvent(event('customer.subscription.updated', flat, { status: 'canceled' }), stripe, deps());
      expect(c4.reactivateApplianceEntitlement).toHaveBeenCalledWith('sub_app');
      expect(c4.updateApplianceEntitlementSeats).not.toHaveBeenCalled();
      expect(c4.syncApplianceSubscriptionState).toHaveBeenCalledTimes(1);
    });

    it('reactivate 404 is a no-op but the state mirror still runs', async () => {
      const active = subscription();
      stripe.subscriptions.retrieve.mockResolvedValue(active);
      c4.reactivateApplianceEntitlement.mockRejectedValue(notFound());
      await handleApplianceSubscriptionEvent(event('customer.subscription.updated', active, { status: 'unpaid' }), stripe, deps());
      expect(c4.syncApplianceSubscriptionState).toHaveBeenCalledTimes(1);
    });

    it('a failing state mirror rejects after reactivate and seats already ran; a retry re-runs all idempotently', async () => {
      const active = subscription();
      stripe.subscriptions.retrieve.mockResolvedValue(active);
      const evt = event('customer.subscription.updated', active, { status: 'unpaid' });
      c4.syncApplianceSubscriptionState.mockRejectedValueOnce(new c4.AlgaLicenseHttpError('HTTP 500', 500));
      await expect(handleApplianceSubscriptionEvent(evt, stripe, deps())).rejects.toThrow('HTTP 500');
      expect(c4.reactivateApplianceEntitlement).toHaveBeenCalledTimes(1);
      expect(c4.updateApplianceEntitlementSeats).toHaveBeenCalledTimes(1);
      await expect(handleApplianceSubscriptionEvent(evt, stripe, deps())).resolves.toMatchObject({ action: 'reactivate' });
      expect(c4.reactivateApplianceEntitlement).toHaveBeenCalledTimes(2);
    });

    it('a seat-sync failure on reactivation skips the state mirror but reactivate already ran', async () => {
      const active = subscription();
      stripe.subscriptions.retrieve.mockResolvedValue(active);
      c4.updateApplianceEntitlementSeats.mockRejectedValue(new Error('network down'));
      await expect(
        handleApplianceSubscriptionEvent(event('customer.subscription.updated', active, { status: 'unpaid' }), stripe, deps()),
      ).rejects.toThrow('network down');
      expect(c4.reactivateApplianceEntitlement).toHaveBeenCalledTimes(1);
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
