import { describe, expect, it } from 'vitest';
import { portalPurchaseIdOfEvent } from '../../../lib/stripe/coManagedFulfillment';

const event = (type: string, object: unknown) => ({ type, data: { object } }) as any;

describe('portalPurchaseIdOfEvent (F009 webhook routing, payload only)', () => {
  it('reads our marker from sessions, subscriptions and invoice subscription snapshots', () => {
    expect(portalPurchaseIdOfEvent(event('checkout.session.completed', { metadata: { portal_purchase_id: 'p1' } }))).toBe('p1');
    expect(portalPurchaseIdOfEvent(event('customer.subscription.deleted', { metadata: { portal_purchase_id: 'p2' } }))).toBe('p2');
    expect(portalPurchaseIdOfEvent(event('invoice.paid', { subscription_details: { metadata: { portal_purchase_id: 'p3' } } }))).toBe('p3');
    expect(portalPurchaseIdOfEvent(event('invoice.payment_failed', { parent: { subscription_details: { metadata: { portal_purchase_id: 'p4' } } } }))).toBe('p4');
  });

  it('ignores unmarked, malformed and unrelated events', () => {
    expect(portalPurchaseIdOfEvent(event('invoice.paid', { metadata: { portal_purchase_id: 'top-level-not-trusted' } }))).toBeNull();
    expect(portalPurchaseIdOfEvent(event('customer.subscription.updated', { metadata: { tenant_id: 't1' } }))).toBeNull();
    expect(portalPurchaseIdOfEvent(event('customer.subscription.updated', { metadata: { portal_purchase_id: '' } }))).toBeNull();
    expect(portalPurchaseIdOfEvent(event('customer.subscription.updated', { metadata: { portal_purchase_id: 'x'.repeat(101) } }))).toBeNull();
    expect(portalPurchaseIdOfEvent(event('customer.updated', { metadata: { portal_purchase_id: 'p1' } }))).toBeNull();
  });
});
