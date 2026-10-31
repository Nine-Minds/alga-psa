import type Stripe from 'stripe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const gate = vi.hoisted(() => ({ admits: vi.fn(async () => ({ admitted: false })) }));
vi.mock('@alga-psa/core/capability', async (importOriginal: () => Promise<Record<string, unknown>>) => ({
  ...(await importOriginal()),
  admits: gate.admits,
}));
vi.mock('@alga-psa/licensing', async (importOriginal: () => Promise<Record<string, unknown>>) => ({
  ...(await importOriginal()),
  recordCoManagedPaymentFailure: vi.fn(async () => undefined),
}));

import { dispatchPaymentEvent } from '../../lib/stripe/paymentEventRegistry';
import { createCoManagedPaymentHandlers, isCoManagedUpgradePaymentEvent } from '../../lib/stripe/coManagedPaymentEvents';
import { INDEPENDENT_UPGRADE_SOURCE } from '../../lib/stripe/coManagedUpgradeSource';

const event = (type: string, object: Record<string, unknown>) => ({ id: 'evt_1', type, data: { object } }) as unknown as Stripe.Event;
const owned = { tenant_id: 't', operation_id: 'op', source: INDEPENDENT_UPGRADE_SOURCE };
const upgradeSession = event('checkout.session.completed', { id: 'cs_1', metadata: owned });
const expiredSession = event('checkout.session.expired', { id: 'cs_1', metadata: owned });
const failedInvoice = event('invoice.payment_failed', { subscription_details: { metadata: owned } });
const ordinary = event('customer.subscription.updated', { id: 'sub_pro', metadata: { tenant_id: 't' }, items: { data: [{ price: { id: 'price_pro' } }] } });
// Same email-looking data but no marker: ownership is never proved by email.
const lookalike = event('checkout.session.completed', { id: 'cs_2', customer_email: 'admin@example.com', metadata: { tenant_id: 't' } });
const forbiddenKnex = new Proxy((() => undefined) as (...args: unknown[]) => unknown, {
  get() { throw new Error('unexpected database access on the webhook path'); },
  apply() { throw new Error('unexpected database access on the webhook path'); },
}) as never;

function setup() {
  const upgradePayment = vi.fn(async () => true);
  const handlers = createCoManagedPaymentHandlers({
    priceId: () => undefined, sync: vi.fn(), finalizeCheckout: vi.fn(), upgradePayment,
  });
  return { upgradePayment, handlers };
}

beforeEach(() => { delete process.env.FORCE_CAPABILITIES; gate.admits.mockReset(); gate.admits.mockResolvedValue({ admitted: false }); });
afterEach(() => { delete process.env.FORCE_CAPABILITIES; });

describe('independent-upgrade payment handler', () => {
  it('claims on payload only, from tenant_id + source, never on email', () => {
    expect(isCoManagedUpgradePaymentEvent(upgradeSession)).toBe(true);
    expect(isCoManagedUpgradePaymentEvent(expiredSession)).toBe(true);
    expect(isCoManagedUpgradePaymentEvent(failedInvoice)).toBe(true);
    expect(isCoManagedUpgradePaymentEvent(ordinary)).toBe(false);
    expect(isCoManagedUpgradePaymentEvent(lookalike)).toBe(false);
  });

  it('is a no-op for non-co-managed events: no query, no capability lookup, no Stripe', async () => {
    const { handlers, upgradePayment } = setup();
    for (const e of [ordinary, lookalike]) {
      const outcome = await dispatchPaymentEvent(handlers.filter(h => h.name === 'co-managed-independent-upgrade'), { event: e, tenantId: 't', knex: forbiddenKnex });
      expect(outcome).toEqual({ consumed: false, handledBy: [], closed: [] });
    }
    expect(upgradePayment).not.toHaveBeenCalled();
    expect(gate.admits).not.toHaveBeenCalled();
  });

  it('flag off / no entitlement: claimed event falls through untouched', async () => {
    const { handlers, upgradePayment } = setup();
    gate.admits.mockResolvedValue({ admitted: false });
    const outcome = await dispatchPaymentEvent(handlers, { event: upgradeSession, tenantId: 't', knex: forbiddenKnex });
    expect(outcome.consumed).toBe(false);
    expect(outcome.closed).toContain('co-managed-independent-upgrade');
    expect(upgradePayment).not.toHaveBeenCalled();
  });

  it('FORCE_CAPABILITIES=co-managed:off kills it even when the gate would admit', async () => {
    process.env.FORCE_CAPABILITIES = 'co-managed:off';
    gate.admits.mockResolvedValue({ admitted: true });
    const { handlers, upgradePayment } = setup();
    const outcome = await dispatchPaymentEvent(handlers, { event: failedInvoice, tenantId: 't', knex: forbiddenKnex });
    expect(outcome.consumed).toBe(false);
    expect(upgradePayment).not.toHaveBeenCalled();
  });

  it('admitted tenant: reconciles and consumes; success/failed/expired all reach the reconciler', async () => {
    gate.admits.mockResolvedValue({ admitted: true });
    const { handlers, upgradePayment } = setup();
    for (const e of [upgradeSession, expiredSession, failedInvoice]) {
      const outcome = await dispatchPaymentEvent(handlers, { event: e, tenantId: 't', knex: {} as never });
      expect(outcome.consumed).toBe(true);
    }
    expect(upgradePayment).toHaveBeenCalledTimes(3);
  });

  it('refuses an event whose tenant_id differs from the webhook-resolved tenant', async () => {
    gate.admits.mockResolvedValue({ admitted: true });
    const { handlers, upgradePayment } = setup();
    const outcome = await dispatchPaymentEvent(handlers, { event: upgradeSession, tenantId: 'other', knex: {} as never });
    expect(outcome.consumed).toBe(false);
    expect(upgradePayment).not.toHaveBeenCalled();
  });

  it('continues to the default handlers when the reconciler says the event was not ours to apply', async () => {
    gate.admits.mockResolvedValue({ admitted: true });
    const { handlers, upgradePayment } = setup();
    upgradePayment.mockResolvedValue(false);
    const outcome = await dispatchPaymentEvent(handlers, { event: upgradeSession, tenantId: 't', knex: {} as never });
    expect(outcome.consumed).toBe(false);
  });
});
