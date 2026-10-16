import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@alga-psa/core/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const c4 = vi.hoisted(() => ({
  revokeApplianceEntitlement: vi.fn(),
  updateApplianceEntitlementSeats: vi.fn(),
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

describe('appliance subscription lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    c4.revokeApplianceEntitlement.mockResolvedValue({ revoked: true });
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

  it('syncs seats when the quantity changed or the sub came back to life', () => {
    const sub = subscription();
    expect(decideLifecycleAction(event('customer.subscription.updated', sub, { items: {} }), sub)).toEqual({ action: 'sync-seats', seats: 5 });
    expect(decideLifecycleAction(event('customer.subscription.updated', sub, { status: 'unpaid' }), sub)).toEqual({ action: 'sync-seats', seats: 5 });
    expect(decideLifecycleAction(event('customer.subscription.updated', sub, { metadata: {} }), sub)).toEqual({ action: 'none' });
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
});
