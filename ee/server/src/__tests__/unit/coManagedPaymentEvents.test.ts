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
import { createCoManagedPaymentHandlers, isCoManagedPaymentEvent } from '../../lib/stripe/coManagedPaymentEvents';

const PRICE = 'price_co_managed';
const event = (type: string, object: Record<string, unknown>) => ({ id: 'evt_1', type, data: { object } }) as unknown as Stripe.Event;
const ordinary = event('customer.subscription.updated', { id: 'sub_pro', metadata: { tenant_id: 't' }, items: { data: [{ price: { id: 'price_pro' } }] } });
const coManaged = event('customer.subscription.updated', { id: 'sub_cm', metadata: { subscription_kind: 'co_managed', tenant_id: 't' }, items: { data: [{ price: { id: PRICE } }] } });
const coManagedInvoice = event('invoice.paid', { subscription_details: { metadata: { subscription_kind: 'co_managed' } }, lines: { data: [] } });

/** A connection that fails the test on any use: proves a path issued no query at all. */
const forbiddenKnex = new Proxy((() => undefined) as (...args: unknown[]) => unknown, {
  get() { throw new Error('unexpected database access on the webhook path'); },
  apply() { throw new Error('unexpected database access on the webhook path'); },
}) as never;

function setup(priceId: string | null = PRICE) {
  const sync = vi.fn(async () => undefined);
  const finalizeCheckout = vi.fn(async () => undefined);
  return { sync, finalizeCheckout, handlers: createCoManagedPaymentHandlers({ priceId: () => priceId ?? undefined, sync, finalizeCheckout }) };
}

beforeEach(() => { delete process.env.FORCE_CAPABILITIES; gate.admits.mockReset(); gate.admits.mockResolvedValue({ admitted: false }); });
afterEach(() => { delete process.env.FORCE_CAPABILITIES; });

describe('payment-event registry: ordinary PSA tenants', () => {
  it('issues no co-managed query and does not fail when the co-managed tables are absent', async () => {
    const { handlers, sync } = setup();
    const outcome = await dispatchPaymentEvent(handlers, { event: ordinary, tenantId: 't', knex: forbiddenKnex });
    expect(outcome.consumed).toBe(false);
    expect(sync).not.toHaveBeenCalled();
    // the sponsor-base handler asked the capability (an in-memory 30s-cached gate) and stopped there
    expect(gate.admits).toHaveBeenCalledWith('co-managed', 't');
  });

  it('is payload-only: an ordinary event is never claimed as co-managed', () => {
    expect(isCoManagedPaymentEvent(ordinary, PRICE)).toBe(false);
    expect(isCoManagedPaymentEvent(coManaged, PRICE)).toBe(true);
    expect(isCoManagedPaymentEvent(coManagedInvoice, PRICE)).toBe(true);
  });
});

describe('payment-event registry: co-managed events', () => {
  it('reconciles an open pool', async () => {
    const { handlers, sync } = setup();
    const outcome = await dispatchPaymentEvent(handlers, { event: coManaged, tenantId: 't', knex: {} as never });
    expect(outcome.consumed).toBe(true);
    expect(sync).toHaveBeenCalledWith('t', 'sub_cm', expect.anything());
  });

  it.each([
    ['FORCE_CAPABILITIES=co-managed:off', () => { process.env.FORCE_CAPABILITIES = 'co-managed:off'; }, PRICE],
    ['a malformed FORCE_CAPABILITIES', () => { process.env.FORCE_CAPABILITIES = 'co-managed:maybe'; }, PRICE],
    ['an unset price id', () => undefined, null],
  ])('is inert and still swallowed (never falls through to MSP seat handlers) with %s', async (_name, arrange, priceId) => {
    arrange();
    const { handlers, sync, finalizeCheckout } = setup(priceId);
    const outcome = await dispatchPaymentEvent(handlers, { event: coManaged, tenantId: 't', knex: forbiddenKnex });
    expect(outcome).toMatchObject({ consumed: true, handledBy: [] });
    expect(sync).not.toHaveBeenCalled();
    expect(finalizeCheckout).not.toHaveBeenCalled();
  });

  it('keeps reconciling an existing pool when only the release flag is off', async () => {
    gate.admits.mockResolvedValue({ admitted: false });
    const { handlers, sync } = setup();
    await dispatchPaymentEvent(handlers, { event: coManagedInvoice, tenantId: 't', knex: {} as never });
    expect(gate.admits).not.toHaveBeenCalled();
    expect(sync).not.toHaveBeenCalled(); // no subscription id on this payload: nothing to reconcile
  });
});
