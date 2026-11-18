/**
 * Payment-event registry (CM L8a, replacing DO-NOT-PORT #15).
 *
 * The webhook path must cost an ordinary PSA tenant nothing. Handlers therefore declare, in order:
 *   1. `claims(event)`   — pure, payload-only, no I/O. "Is this event mine?"
 *   2. `admits(ctx)`     — cheapest-first gate (configuration, kill switch, capability). Only a
 *                          tenant that passes it is ever allowed to cause a handler's queries.
 *   3. `handle(ctx)`     — the work; reports whether the event is consumed.
 *
 * A claimed-but-not-admitted event is CONSUMED as a no-op when the handler says so: a co-managed
 * subscription event must never fall through to the MSP's own Pro seat handlers, even while the
 * capability is switched off.
 *
 * The registry knows nothing about co-managed; any future payment-adjacent capability registers
 * the same way. Handlers here are pure functions of their inputs, so the registry is unit-testable
 * without Stripe or a database.
 */
import type Stripe from 'stripe';
import type { Knex } from 'knex';

export interface PaymentEventContext {
  event: Stripe.Event;
  tenantId: string;
  knex: Knex;
}

export interface PaymentEventHandler {
  name: string;
  claims(event: Stripe.Event): boolean;
  admits(ctx: Pick<PaymentEventContext, 'tenantId'>): Promise<boolean>;
  /** When claimed but not admitted: true = swallow the event, false = let the next handler run. */
  consumeWhenClosed: boolean;
  /** Return 'consumed' to stop default handling, 'continue' to let it run. */
  handle(ctx: PaymentEventContext): Promise<'consumed' | 'continue'>;
}

export interface PaymentEventOutcome {
  consumed: boolean;
  handledBy: string[];
  closed: string[];
}

export async function dispatchPaymentEvent(
  handlers: readonly PaymentEventHandler[],
  ctx: PaymentEventContext,
): Promise<PaymentEventOutcome> {
  const outcome: PaymentEventOutcome = { consumed: false, handledBy: [], closed: [] };
  for (const handler of handlers) {
    if (!handler.claims(ctx.event)) continue;
    if (!(await handler.admits({ tenantId: ctx.tenantId }))) {
      outcome.closed.push(handler.name);
      if (handler.consumeWhenClosed) { outcome.consumed = true; return outcome; }
      continue;
    }
    outcome.handledBy.push(handler.name);
    if ((await handler.handle(ctx)) === 'consumed') { outcome.consumed = true; return outcome; }
  }
  return outcome;
}
