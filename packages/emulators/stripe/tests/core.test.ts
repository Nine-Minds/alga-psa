import { describe, expect, it } from 'vitest';
import { VirtualClock, seededRng } from '@alga-psa/emulator-host';
import type { HostEnv } from '@alga-psa/emulator-host';
import { StripeEmulatorCore } from '../src/core';

function makeCore(): { core: StripeEmulatorCore; clock: VirtualClock; env: HostEnv } {
  const clock = new VirtualClock();
  const env: HostEnv = {
    clock,
    rng: seededRng(1),
    log: () => {},
  };
  return { core: new StripeEmulatorCore(env), clock, env };
}

const BASE = 'http://127.0.0.1:4050';

function seedSession(core: StripeEmulatorCore): string {
  const session = core.createCheckoutSession(
    {
      mode: 'payment',
      line_items: [{ price_data: { currency: 'usd', unit_amount: 1200 }, quantity: 1 }],
      success_url: 'http://localhost:3000/success?session_id={CHECKOUT_SESSION_ID}',
      cancel_url: 'http://localhost:3000/billing',
      metadata: { invoice_id: 'inv-1', tenant_id: 'tenant-1' },
    },
    BASE,
  );
  return session.id;
}

describe('stripe emulator pure core', () => {

  it('creates deterministic ids and computes totals from nested line items', () => {
    const { core } = makeCore();
    const session = core.createCheckoutSession(
      {
        mode: 'payment',
        line_items: [{ price_data: { currency: 'usd', unit_amount: 1999 }, quantity: 3 }],
        success_url: 'http://localhost:3000/success',
        metadata: {},
      },
      BASE,
    );
    expect(session.id).toMatch(/^cs_/);
    // Mirrors 2024-12-18.acacia: no PaymentIntent until confirmation.
    expect(session.payment_intent).toBeNull();
    expect(session.amount_total).toBe(5997);
    expect(session.url).toBe(`${BASE}/checkout/sessions/${session.id}`);

    core.completeSession(session.id);
    const completed = core.getCheckoutSession(session.id);
    expect(completed.payment_intent).toMatch(/^pi_/);
    expect(core.paymentIntents.get(completed.payment_intent!)?.status).toBe('succeeded');
  });

  it('completeSession is idempotent: one paid event per transition', () => {
    const { core } = makeCore();
    const sessionId = seedSession(core);
    const first = core.completeSession(sessionId);
    const second = core.completeSession(sessionId);
    expect(first.id).toMatch(/^evt_/);
    expect(first.data.object.payment_status).toBe('paid');
    expect(core.listEvents()).toHaveLength(2);
    expect(core.getCheckoutSession(sessionId).status).toBe('complete');
    // Both calls settle the same session deterministically.
    expect(second.data.object.id).toBe(sessionId);
    expect(second.data.object.payment_status).toBe('paid');
  });

  it('failSession keeps the intent retryable and records a card error', () => {
    const { core } = makeCore();
    const sessionId = seedSession(core);
    core.failSession(sessionId);
    const session = core.getCheckoutSession(sessionId);
    expect(session.payment_intent).toMatch(/^pi_/);
    const intent = core.paymentIntents.get(session.payment_intent!)!;
    expect(intent.status).toBe('requires_payment_method');
    expect(intent.last_payment_error?.code).toBe('card_declined');
    core.completeSession(sessionId);
    expect(core.getCheckoutSession(sessionId).payment_status).toBe('paid');
  });

  it('armOperationFault consumes exactly the requested number of uses', () => {
    const { core } = makeCore();
    core.armOperationFault({ operation: 'checkout.sessions.create', status: 500, code: 'api_error', message: 'down', remaining: 2 });
    expect(core.consumeOperationFault('checkout.sessions.create')?.remaining).toBe(1);
    expect(core.consumeOperationFault('checkout.sessions.create')?.remaining).toBe(0);
    expect(core.consumeOperationFault('checkout.sessions.create')).toBeNull();
  });

  it('an expired session cannot be completed (pay rejects an invalid state)', () => {
    const { core } = makeCore();
    const sessionId = seedSession(core);
    core.expireSession(sessionId);
    expect(core.getCheckoutSession(sessionId).status).toBe('expired');
    expect(() => core.completeSession(sessionId)).toThrow(/expired/i);
    // The session stays expired, never payable again.
    expect(core.getCheckoutSession(sessionId).payment_status).toBe('unpaid');
  });

  it('a completed session cannot be expired (expire rejects an invalid state)', () => {
    const { core } = makeCore();
    const sessionId = seedSession(core);
    core.completeSession(sessionId);
    expect(core.getCheckoutSession(sessionId).status).toBe('complete');
    expect(() => core.expireSession(sessionId)).toThrow(/completed/i);
  });

  it('expireSession is idempotent for an already-expired session', () => {
    const { core } = makeCore();
    const sessionId = seedSession(core);
    core.expireSession(sessionId);
    const events = core.listEvents().length;
    const again = core.expireSession(sessionId);
    expect(again.type).toBe('checkout.session.expired');
    expect(core.getCheckoutSession(sessionId).status).toBe('expired');
    expect(core.listEvents()).toHaveLength(events + 1);
  });

  it('failSession rejects a session that is no longer open', () => {
    const { core } = makeCore();
    const sessionId = seedSession(core);
    core.expireSession(sessionId);
    expect(() => core.failSession(sessionId)).toThrow(/open/i);
  });

  it('reset returns to the deterministic default credentials', () => {
    const { core } = makeCore();
    core.configure({ secretKey: 'sk_test_custom', webhookSecret: 'whsec_custom', webhookTargets: ['http://x/webhook'] });
    core.reset();
    expect(core.config()).toMatchObject({
      secretKey: 'sk_test_algasim',
      webhookSecret: 'whsec_algasim',
      publishableKey: 'pk_test_algasim',
      webhookTargets: [],
    });
  });
});
