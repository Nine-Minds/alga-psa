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
import { INDEPENDENT_UPGRADE_SOURCE } from './coManagedUpgradeSource';

export interface CoManagedPaymentDeps {
  /** Configured SKU; absent means the whole co-managed purchase path is inert. */
  priceId(): string | undefined;
  sync(tenantId: string, subscriptionId: string, db: Knex): Promise<void>;
  finalizeCheckout(session: Stripe.Checkout.Session, tenantId: string, db: Knex): Promise<void>;
  /** Independent-upgrade (L8b) reconciliation; resolved lazily so no Stripe client exists until needed.
   * Returns true when the event belonged to an authorised independent purchase and was applied. */
  upgradePayment?(event: Stripe.Event, tenantId: string, db: Knex): Promise<boolean>;
}

const UPGRADE_EVENTS = new Set(['checkout.session.completed', 'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed', 'checkout.session.expired', 'customer.subscription.created',
  'customer.subscription.updated', 'customer.subscription.deleted', 'invoice.paid', 'invoice.payment_failed']);

/** Pure payload test: ownership is proved by our own metadata marker, never by customer email. */
export function isCoManagedUpgradePaymentEvent(event: Stripe.Event): boolean {
  if (!UPGRADE_EVENTS.has(event.type)) return false;
  const object = event.data.object as any;
  const details = event.type.startsWith('invoice.') ? (object.subscription_details ?? object.parent?.subscription_details) : object;
  return details?.metadata?.source === INDEPENDENT_UPGRADE_SOURCE && Boolean(details?.metadata?.tenant_id);
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

/** Default reconciliation: loaded and constructed only when an admitted upgrade event arrives. */
async function defaultUpgradePayment(event: Stripe.Event, tenantId: string, db: Knex): Promise<boolean> {
  const { handleCoManagedUpgradePaymentEvent, independentCheckoutStripeContext } = await import('./coManagedUpgradeCheckout');
  const { stripe } = await independentCheckoutStripeContext();
  return handleCoManagedUpgradePaymentEvent(db, stripe, tenantId, event);
}

export function createCoManagedPaymentHandlers(deps: CoManagedPaymentDeps): PaymentEventHandler[] {
  const upgradePayment = deps.upgradePayment ?? defaultUpgradePayment;
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
    {
      // Independent upgrade (L8b). Claimed only by our metadata marker; admitted only for a tenant the
      // capability gate serves. Closed => fall through untouched (no co-managed query is ever run).
      name: 'co-managed-independent-upgrade',
      claims: (event) => isCoManagedUpgradePaymentEvent(event),
      admits: async ({ tenantId }) => killSwitchOpen() && (await admits('co-managed', tenantId)).admitted,
      consumeWhenClosed: false,
      async handle({ event, tenantId, knex }) {
        const object = event.data.object as any;
        const meta = (object.metadata ?? object.subscription_details?.metadata ?? object.parent?.subscription_details?.metadata) as Record<string, string> | undefined;
        // The event's own tenant claim must match the webhook-resolved tenant.
        if (meta?.tenant_id !== tenantId) return 'continue';
        return (await upgradePayment(event, tenantId, knex)) ? 'consumed' : 'continue';
      },
    },
  ];
}
