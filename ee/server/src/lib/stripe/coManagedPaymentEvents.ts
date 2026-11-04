/**
 * Co-managed payment-event handlers for the registry in ./paymentEventRegistry.
 *
 * Admission order (cheapest first), so an ordinary PSA tenant's webhook runs ZERO co-managed
 * queries and cannot fail because the co-managed tables are missing:
 *   - `claims` reads only the event payload;
 *   - the co-managed handler is admitted by configuration (price id set) and the kill switch;
 *   - the base-Pro sponsor handler is additionally admitted by the capability gate
 *     (`admits`: release flag AND entitlement), which is flag-first and cached, so a flag-off tenant
 *     never reaches a co-managed table.
 */
import type Stripe from 'stripe';
import type { Knex } from 'knex';
import { admits, forcedValue } from '@alga-psa/core/capability';
import logger from '@alga-psa/core/logger';
import { recordCoManagedPaymentFailure } from '@alga-psa/licensing';
import { tenantDb } from '@alga-psa/db';
import { CO_MANAGED_SUBSCRIPTION_KIND } from './coManagedSubscription';
import type { PaymentEventHandler } from './paymentEventRegistry';

export interface CoManagedPaymentDeps {
  /** Configured SKU; absent means the whole co-managed purchase path is inert. */
  priceId(): string | undefined;
  sync(tenantId: string, subscriptionId: string, db: Knex): Promise<void>;
  finalizeCheckout(session: Stripe.Checkout.Session, tenantId: string, db: Knex): Promise<void>;
}

const SUBSCRIPTION_EVENTS = new Set(['customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted']);
const INVOICE_EVENTS = new Set(['invoice.paid', 'invoice.payment_failed']);
const SPONSOR_SYNC_EVENTS = new Set([...SUBSCRIPTION_EVENTS, ...INVOICE_EVENTS, 'checkout.session.completed']);

function invoiceSubscriptionId(invoice: any): string | undefined {
  const reference = invoice.subscription ?? invoice.parent?.subscription_details?.subscription;
  return typeof reference === 'string' ? reference : reference?.id;
}

/** Pure payload test: is this event about the dedicated co-managed seat pool? */
export function isCoManagedPaymentEvent(event: Stripe.Event, priceId?: string): boolean {
  const object = event.data.object as any;
  if (SUBSCRIPTION_EVENTS.has(event.type)) {
    return object.metadata?.subscription_kind === CO_MANAGED_SUBSCRIPTION_KIND ||
      Boolean(priceId && object.items?.data?.some((item: any) => item.price?.id === priceId));
  }
  if (event.type === 'checkout.session.completed') {
    return object.metadata?.subscription_kind === CO_MANAGED_SUBSCRIPTION_KIND;
  }
  if (INVOICE_EVENTS.has(event.type)) {
    const details = object.subscription_details ?? object.parent?.subscription_details;
    return details?.metadata?.subscription_kind === CO_MANAGED_SUBSCRIPTION_KIND ||
      Boolean(priceId && object.lines?.data?.some((line: any) => line.price?.id === priceId ||
        line.pricing?.price_details?.price === priceId));
  }
  return false;
}

function killSwitchOpen(): boolean {
  const state = forcedValue(process.env.FORCE_CAPABILITIES, 'co-managed');
  return state !== 'off' && state !== 'malformed';
}

export function createCoManagedPaymentHandlers(deps: CoManagedPaymentDeps): PaymentEventHandler[] {
  return [
    {
      name: 'co-managed-subscription',
      claims: (event) => isCoManagedPaymentEvent(event, deps.priceId()),
      // Configuration and kill switch only: the event itself proves the tenant participates, and
      // an existing pool keeps being reconciled even if the release flag is later turned off.
      admits: async () => Boolean(deps.priceId()) && killSwitchOpen(),
      // Never let a co-managed event fall through to the MSP's own seat handlers.
      consumeWhenClosed: true,
      async handle({ event, tenantId, knex }) {
        const object = event.data.object as any;
        if (event.type === 'checkout.session.completed') {
          await deps.finalizeCheckout(object as Stripe.Checkout.Session, tenantId, knex);
        } else if (SUBSCRIPTION_EVENTS.has(event.type)) {
          await deps.sync(tenantId, object.id, knex);
        } else {
          const subscriptionId = invoiceSubscriptionId(object);
          if (subscriptionId) {
            if (event.type === 'invoice.payment_failed') await recordCoManagedPaymentFailure(knex, tenantId);
            await deps.sync(tenantId, subscriptionId, knex);
          }
        }
        return 'consumed';
      },
    },
    {
      // Base Pro renewal or cancellation also moves sponsored capacity. Runs only for tenants the
      // capability admits; the MSP's own handler still processes the event afterwards.
      name: 'co-managed-sponsor-base',
      claims: (event) => SPONSOR_SYNC_EVENTS.has(event.type),
      admits: async ({ tenantId }) => Boolean(deps.priceId()) && (await admits('co-managed', tenantId)).admitted,
      consumeWhenClosed: false,
      async handle({ tenantId, knex }) {
        try {
          const entitlement = await tenantDb(knex, tenantId).table('co_managed_entitlements').first('source', 'source_reference');
          if (entitlement?.source === 'hosted') await deps.sync(tenantId, entitlement.source_reference, knex);
        } catch (error) {
          // Best effort: the MSP's own billing event must still be processed. Reconciliation is
          // idempotent and also runs on the next co-managed event.
          logger.error('[StripeService] Base-subscription co-managed sync failed', error);
        }
        return 'continue';
      },
    },
  ];
}
