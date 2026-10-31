import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@alga-psa/core/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const c4 = vi.hoisted(() => ({
  revokeApplianceEntitlement: vi.fn(),
  updateApplianceEntitlementSeats: vi.fn(),
  setApplianceEntitlementPaymentState: vi.fn(),
}));

vi.mock('@ee/lib/applianceConsole/algaLicenseAdminClient', () => c4);

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

const stripe = { subscriptions: { retrieve: vi.fn() } } as any;
const deps = () => ({
  revoke: c4.revokeApplianceEntitlement,
  syncSeats: c4.updateApplianceEntitlementSeats,
  setPaymentState: c4.setApplianceEntitlementPaymentState,
});

describe('appliance subscription lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    c4.revokeApplianceEntitlement.mockResolvedValue({ revoked: true });
    c4.updateApplianceEntitlementSeats.mockResolvedValue({ stripe_sub_id: 'sub_app', tier: 'pro', seats: 5 });
    c4.setApplianceEntitlementPaymentState.mockResolvedValue({ updated: true });
  });

  it('reads the tenant id from either nm-store metadata key', () => {
    expect(tenantIdFromSubscription({ metadata: { appliance_tenant_id: TENANT } })).toBe(TENANT);
    expect(tenantIdFromSubscription({ metadata: { tenantId: TENANT } })).toBe(TENANT);
    expect(tenantIdFromSubscription({ metadata: {} })).toBeNull();
  });

  it('revokes on deletion and on lapse to unpaid/canceled', () => {
    expect(decideLifecycleAction(event('customer.subscription.deleted', subscription()), subscription())).toEqual({ action: 'revoke' });
    const canceled = subscription({ status: 'canceled' });
    expect(decideLifecycleAction(event('customer.subscription.updated', canceled, { status: 'active' }), canceled)).toEqual({ action: 'revoke' });
  });

  describe('payment failure', () => {
    it('invoice.payment_failed marks (never revokes) and carries the retry date and hosted invoice URL', () => {
      const inv = { object: 'invoice', subscription: 'sub_app', next_payment_attempt: 1_790_000_000, hosted_invoice_url: 'https://pay.stripe.test/i/1' };
      expect(decideLifecycleAction(event('invoice.payment_failed', inv), subscription())).toEqual({
        action: 'mark-payment-failed',
        nextRetryAt: 1_790_000_000,
        updatePaymentUrl: 'https://pay.stripe.test/i/1',
      });
    });

    it('invoice.payment_failed with no further retry scheduled records a null retry date', () => {
      const inv = { object: 'invoice', subscription: 'sub_app', next_payment_attempt: null };
      expect(decideLifecycleAction(event('invoice.payment_failed', inv), subscription())).toEqual({
        action: 'mark-payment-failed',
        nextRetryAt: null,
      });
    });

    it('past_due marks only: no revoke, and no retry date so the stored one is kept', () => {
      const pastDue = subscription({ status: 'past_due' });
      expect(decideLifecycleAction(event('customer.subscription.updated', pastDue, { status: 'active' }), pastDue)).toEqual({ action: 'mark-payment-failed' });
    });

    it('unpaid keeps the revoke and records endReason payment_failed', () => {
      const unpaid = subscription({ status: 'unpaid' });
      expect(decideLifecycleAction(event('customer.subscription.updated', unpaid, { status: 'past_due' }), unpaid)).toEqual({
        action: 'revoke',
        endReason: 'payment_failed',
      });
    });

    it('a deletion by Stripe for non-payment records endReason; a plain cancellation does not', () => {
      const dunned = subscription({ status: 'canceled', cancellation_details: { reason: 'payment_failed' } });
      expect(decideLifecycleAction(event('customer.subscription.deleted', dunned), dunned)).toEqual({ action: 'revoke', endReason: 'payment_failed' });
      const manual = subscription({ status: 'canceled', cancellation_details: { reason: 'cancellation_requested' } });
      expect(decideLifecycleAction(event('customer.subscription.deleted', manual), manual)).toEqual({ action: 'revoke' });
    });

    it('invoice.paid clears; recovery to active from past_due clears alongside the seat sync', () => {
      expect(decideLifecycleAction(event('invoice.paid', { object: 'invoice', subscription: 'sub_app' }), subscription())).toEqual({ action: 'clear-payment-failed' });
      const sub = subscription();
      expect(decideLifecycleAction(event('customer.subscription.updated', sub, { status: 'past_due' }), sub)).toEqual({
        action: 'sync-seats', seats: 5, clearsPaymentFailure: true,
      });
      const flat = subscription({ items: { data: [] } });
      expect(decideLifecycleAction(event('customer.subscription.updated', flat, { status: 'past_due' }), flat)).toEqual({ action: 'clear-payment-failed' });
    });

    it('handler: payment_failed marks via C4 and does not revoke', async () => {
      stripe.subscriptions.retrieve.mockResolvedValue(subscription());
      const inv = { object: 'invoice', subscription: 'sub_app', next_payment_attempt: 1_790_000_000, hosted_invoice_url: 'https://pay.stripe.test/i/1' };
      const out = await handleApplianceSubscriptionEvent(event('invoice.payment_failed', inv), stripe, deps());
      expect(out.action).toBe('mark-payment-failed');
      expect(c4.setApplianceEntitlementPaymentState).toHaveBeenCalledWith('sub_app', {
        state: 'failed', next_retry_at: 1_790_000_000, update_payment_url: 'https://pay.stripe.test/i/1',
      });
      expect(c4.revokeApplianceEntitlement).not.toHaveBeenCalled();
    });

    it('handler: past_due marks without overwriting the retry date', async () => {
      const pastDue = subscription({ status: 'past_due' });
      await handleApplianceSubscriptionEvent(event('customer.subscription.updated', pastDue, { status: 'active' }), stripe, deps());
      expect(c4.setApplianceEntitlementPaymentState).toHaveBeenCalledWith('sub_app', { state: 'failed' });
      expect(c4.revokeApplianceEntitlement).not.toHaveBeenCalled();
    });

    it('handler: unpaid revokes first, then records the end reason with the retry date cleared', async () => {
      const unpaid = subscription({ status: 'unpaid' });
      const out = await handleApplianceSubscriptionEvent(event('customer.subscription.updated', unpaid, { status: 'past_due' }), stripe, deps());
      expect(out).toMatchObject({ action: 'revoke', endReason: 'payment_failed' });
      expect(c4.revokeApplianceEntitlement).toHaveBeenCalledWith('sub_app');
      expect(c4.setApplianceEntitlementPaymentState).toHaveBeenCalledWith('sub_app', { state: 'failed', next_retry_at: null });
      expect(c4.revokeApplianceEntitlement.mock.invocationCallOrder[0]).toBeLessThan(
        c4.setApplianceEntitlementPaymentState.mock.invocationCallOrder[0],
      );
    });

    it('handler: a plain cancellation revokes without touching payment state', async () => {
      await handleApplianceSubscriptionEvent(event('customer.subscription.deleted', subscription({ status: 'canceled' })), stripe, deps());
      expect(c4.revokeApplianceEntitlement).toHaveBeenCalled();
      expect(c4.setApplianceEntitlementPaymentState).not.toHaveBeenCalled();
    });

    it('handler: recovery clears the payment state (invoice.paid, and back-to-active with seat sync)', async () => {
      stripe.subscriptions.retrieve.mockResolvedValue(subscription());
      await handleApplianceSubscriptionEvent(event('invoice.paid', { object: 'invoice', subscription: 'sub_app' }), stripe, deps());
      expect(c4.setApplianceEntitlementPaymentState).toHaveBeenLastCalledWith('sub_app', { state: 'ok' });

      c4.setApplianceEntitlementPaymentState.mockClear();
      await handleApplianceSubscriptionEvent(event('customer.subscription.updated', subscription(), { status: 'past_due' }), stripe, deps());
      expect(c4.updateApplianceEntitlementSeats).toHaveBeenCalledWith(TENANT, 5);
      expect(c4.setApplianceEntitlementPaymentState).toHaveBeenCalledWith('sub_app', { state: 'ok' });
    });

    it('skips the Stripe retrieve for an invoice whose subscription metadata says hosted', async () => {
      const hostedInvoice = { object: 'invoice', subscription: 'sub_hosted', subscription_details: { metadata: { tenant_id: 't1' } } };
      const out = await handleApplianceSubscriptionEvent(event('invoice.paid', hostedInvoice), stripe, deps());
      expect(out.handled).toBe(false);
      expect(stripe.subscriptions.retrieve).not.toHaveBeenCalled();
    });
  });

  it('syncs seats when the quantity changed or the sub came back to life', () => {
    const sub = subscription();
    expect(decideLifecycleAction(event('customer.subscription.updated', sub, { items: {} }), sub)).toEqual({ action: 'sync-seats', seats: 5 });
    expect(decideLifecycleAction(event('customer.subscription.updated', sub, { status: 'unpaid' }), sub)).toEqual({ action: 'sync-seats', seats: 5, clearsPaymentFailure: true });
    expect(decideLifecycleAction(event('customer.subscription.updated', sub, { metadata: {} }), sub)).toEqual({ action: 'none' });
  });

  it('ignores hosted subscriptions', async () => {
    const hosted = subscription({ metadata: { tenant_id: 'hosted-tenant' } });
    const outcome = await handleApplianceSubscriptionEvent(event('customer.subscription.deleted', hosted), stripe, deps());
    expect(outcome.handled).toBe(false);
    expect(c4.revokeApplianceEntitlement).not.toHaveBeenCalled();
  });

  it('calls C4 revoke for a deleted appliance subscription and audits it', async () => {
    const audit = vi.fn().mockResolvedValue(undefined);
    const outcome = await handleApplianceSubscriptionEvent(event('customer.subscription.deleted', subscription()), stripe, {
      revoke: c4.revokeApplianceEntitlement,
      syncSeats: c4.updateApplianceEntitlementSeats,
      setPaymentState: c4.setApplianceEntitlementPaymentState,
      audit,
    });
    expect(outcome).toMatchObject({ handled: true, tenantId: TENANT, subscriptionId: 'sub_app', action: 'revoke' });
    expect(c4.revokeApplianceEntitlement).toHaveBeenCalledWith('sub_app');
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'revoke', subscription_id: 'sub_app', tenant_id: TENANT }));
  });

  it('resolves the subscription for invoice events and syncs seats on reactivation', async () => {
    stripe.subscriptions.retrieve.mockResolvedValue(subscription());
    const invoiceEvent = event('invoice.payment_failed', { object: 'invoice', subscription: 'sub_app' });
    const outcome = await handleApplianceSubscriptionEvent(invoiceEvent, stripe, deps());
    expect(stripe.subscriptions.retrieve).toHaveBeenCalledWith('sub_app');
    expect(outcome).toMatchObject({ handled: true, action: 'mark-payment-failed' });

    const revived = subscription();
    const out2 = await handleApplianceSubscriptionEvent(event('customer.subscription.updated', revived, { status: 'unpaid' }), stripe, deps());
    expect(out2.action).toBe('sync-seats');
    expect(c4.updateApplianceEntitlementSeats).toHaveBeenCalledWith(TENANT, 5);
  });

  it('does not sync seats without a tenant id in metadata', async () => {
    const orphan = subscription({ metadata: { deploymentType: 'appliance' } });
    const outcome = await handleApplianceSubscriptionEvent(event('customer.subscription.updated', orphan, { items: {} }), stripe, deps());
    expect(outcome.action).toBe('none');
    expect(c4.updateApplianceEntitlementSeats).not.toHaveBeenCalled();
  });
});
