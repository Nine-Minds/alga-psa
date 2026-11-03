/**
 * Stripe → C4 lifecycle for appliance subscriptions.
 *
 * nm-store creates appliance subscriptions (order checkout and portal upgrade)
 * with `deploymentType: 'appliance'` in the subscription metadata, but neither
 * nm-store nor the hosted webhook handler ever told C4 when one lapsed, so a
 * cancelled appliance kept receiving fresh Pro tokens at every check-in. The
 * hosted StripeService hands these events here before it tries to resolve a
 * hosted tenant (which appliance subscriptions never have).
 */

import type Stripe from 'stripe';
import logger from '@alga-psa/core/logger';
import {
  revokeApplianceEntitlement,
  setApplianceEntitlementPaymentState,
  syncApplianceSubscriptionState,
  updateApplianceEntitlementSeats,
} from './algaLicenseAdminClient';
import type { ApplianceSubscriptionPaymentState, ApplianceSubscriptionState } from './algaLicenseAdminClient';
import { findPerSeatItem } from './stripeBilling';

export const APPLIANCE_DEPLOYMENT_TYPE = 'appliance';

/** Sub statuses after which C4 must stop rolling tokens. */
const LAPSED_STATUSES = new Set<string>(['unpaid', 'canceled', 'incomplete_expired']);
/** Sub statuses that mean "paying" for entitlement purposes. */
const LIVE_STATUSES = new Set<string>(['active', 'trialing']);

/**
 *  - `mark-payment-failed` records "renewal payment failing" for the check-in
 *    banner. It NEVER revokes: Pro keeps running while Stripe retries.
 *  - `clear-payment-failed` records recovery (payment went through).
 */
export type ApplianceLifecycleAction = 'revoke' | 'sync-seats' | 'mark-payment-failed' | 'clear-payment-failed' | 'none';

export interface ApplianceLifecycleDecision {
  action: ApplianceLifecycleAction;
  seats?: number;
  /**
   * `revoke` only: the end followed failed payments (unpaid, or cancelled by
   * Stripe for non-payment). The handler records it, then revokes as before, so
   * the check-in says "Pro ended — payment failed" instead of "cancelled".
   */
  endReason?: 'payment_failed';
  /** `mark-payment-failed` only: Stripe's next retry (unix seconds) / hosted invoice URL, when the event carries them. */
  nextRetryAt?: number | null;
  updatePaymentUrl?: string | null;
  /** `sync-seats` only: the subscription also recovered from a failing payment. */
  clearsPaymentFailure?: boolean;
}

export interface ApplianceLifecycleOutcome {
  handled: boolean;
  tenantId: string | null;
  subscriptionId: string | null;
  action: ApplianceLifecycleAction;
  seats?: number;
  endReason?: 'payment_failed';
  /** Set for subscription.* events: the state mirrored to C4. */
  state?: ApplianceSubscriptionState;
}

export interface ApplianceLifecycleDeps {
  revoke: (stripeSubId: string) => Promise<unknown>;
  syncSeats: (tenantId: string, seats: number) => Promise<unknown>;
  setPaymentState: (stripeSubId: string, payment: ApplianceSubscriptionPaymentState) => Promise<unknown>;
  /** Mirror the subscription snapshot onto the C4 entitlement (display only, never revokes). */
  syncState: (stripeSubId: string, state: ApplianceSubscriptionState) => Promise<unknown>;
  audit?: (details: Record<string, unknown>) => Promise<void>;
}

const defaultDeps: ApplianceLifecycleDeps = {
  revoke: revokeApplianceEntitlement,
  syncSeats: updateApplianceEntitlementSeats,
  setPaymentState: setApplianceEntitlementPaymentState,
  syncState: syncApplianceSubscriptionState,
};

export function isApplianceSubscription(sub: { metadata?: Stripe.Metadata | null } | null | undefined): boolean {
  return sub?.metadata?.deploymentType === APPLIANCE_DEPLOYMENT_TYPE;
}

/** The registry tenant id nm-store stamped on the subscription (two paths, two keys). */
export function tenantIdFromSubscription(sub: { metadata?: Stripe.Metadata | null }): string | null {
  const meta = sub.metadata ?? {};
  const fromOrder = meta.appliance_tenant_id;
  const fromPortal = meta.tenantId;
  const value = (typeof fromOrder === 'string' && fromOrder.trim()) || (typeof fromPortal === 'string' && fromPortal.trim()) || '';
  return value || null;
}

/**
 * Resolve the subscription object for an event. Subscription events carry it
 * inline; invoice events reference it by id and need a retrieve.
 */
export async function resolveApplianceSubscription(
  event: Stripe.Event,
  stripe: Pick<Stripe, 'subscriptions'>,
): Promise<Stripe.Subscription | null> {
  const object = event.data.object as {
    object?: string;
    subscription?: string | { id: string } | null;
    metadata?: Stripe.Metadata | null;
    subscription_details?: { metadata?: Stripe.Metadata | null } | null;
  };
  if (object.object === 'subscription') {
    return isApplianceSubscription(object) ? (object as unknown as Stripe.Subscription) : null;
  }
  if (object.object === 'invoice' && object.subscription) {
    // Invoices snapshot the subscription's metadata. When it is there and says
    // "not an appliance" (every hosted renewal, incl. each invoice.paid), skip
    // the Stripe retrieve: hosted processing must not pay for this path.
    const snapshot = object.subscription_details?.metadata;
    if (snapshot && typeof snapshot === 'object' && !isApplianceSubscription({ metadata: snapshot })) return null;
    const id = typeof object.subscription === 'string' ? object.subscription : object.subscription.id;
    const sub = await stripe.subscriptions.retrieve(id);
    return isApplianceSubscription(sub) ? sub : null;
  }
  return null;
}

/**
 * Snapshot of the subscription for C4's display mirror. A deleted event always
 * mirrors `canceled` (Stripe's payload already says so, but don't depend on it).
 * `current_period_end` is per-item in this Stripe API version; fall back to the
 * legacy subscription-level field for older API versions.
 */
export function subscriptionStateSnapshot(event: Stripe.Event, sub: Stripe.Subscription): ApplianceSubscriptionState {
  const deleted = event.type === 'customer.subscription.deleted';
  const periodEnd =
    sub.items?.data?.[0]?.current_period_end ??
    (sub as unknown as { current_period_end?: number }).current_period_end ??
    null;
  return {
    status: deleted ? 'canceled' : sub.status,
    cancel_at_period_end: !!sub.cancel_at_period_end,
    cancel_at: sub.cancel_at ?? null,
    canceled_at: sub.canceled_at ?? (deleted ? event.created ?? null : null),
    current_period_end: periodEnd,
  };
}

const isSubscriptionEvent = (event: Stripe.Event) => event.type.startsWith('customer.subscription.');

/**
 * Pure decision: what does this event mean for the C4 entitlement?
 *
 * Revoke ONLY when the subscription actually ends (deleted, or updated into a
 * LAPSED status). A cancel *request* (`cancel_at_period_end` false→true, or
 * `cancel_at` set) and its undo leave the customer paid-through, so they fall
 * through to 'none' (or a seat sync) and are only mirrored via `state`.
 */
function decideLifecycleActionCore(
  event: Stripe.Event,
  sub: Stripe.Subscription,
  env: NodeJS.ProcessEnv = process.env,
): ApplianceLifecycleDecision {
  // Stripe ended it for non-payment (retries exhausted → unpaid, or cancelled by dunning settings).
  const endedForPayment =
    sub.status === 'unpaid' || sub.cancellation_details?.reason === 'payment_failed';
  const revoke = (): ApplianceLifecycleDecision =>
    endedForPayment ? { action: 'revoke', endReason: 'payment_failed' } : { action: 'revoke' };

  if (event.type === 'customer.subscription.deleted') return revoke();

  if (event.type === 'customer.subscription.updated') {
    if (LAPSED_STATUSES.has(sub.status)) return revoke();

    // Payment failing, Stripe still retrying: tell the appliance, keep Pro.
    // (The subscription event carries no retry date; invoice.payment_failed does.)
    if (sub.status === 'past_due') return { action: 'mark-payment-failed' };

    const previous = (event.data.previous_attributes ?? {}) as { status?: string; items?: unknown };
    const item = findPerSeatItem(sub, env);
    const seats = item?.quantity ?? null;

    const cameBackToLife =
      LIVE_STATUSES.has(sub.status) && typeof previous.status === 'string' && !LIVE_STATUSES.has(previous.status);
    const quantityChanged = previous.items !== undefined;

    if ((cameBackToLife || quantityChanged) && seats != null) {
      return cameBackToLife ? { action: 'sync-seats', seats, clearsPaymentFailure: true } : { action: 'sync-seats', seats };
    }
    // Back to life with no seat line (flat sub): nothing to sync, but the
    // failing-payment banner must still clear.
    if (cameBackToLife) return { action: 'clear-payment-failed' };
    return { action: 'none' };
  }

  if (event.type === 'invoice.payment_failed') {
    const invoice = event.data.object as { next_payment_attempt?: number | null; hosted_invoice_url?: string | null };
    return {
      action: 'mark-payment-failed',
      // null = Stripe has no further retry scheduled.
      nextRetryAt: typeof invoice.next_payment_attempt === 'number' ? invoice.next_payment_attempt : null,
      ...(invoice.hosted_invoice_url ? { updatePaymentUrl: invoice.hosted_invoice_url } : {}),
    };
  }

  // A payment went through (any invoice on this subscription).
  if (event.type === 'invoice.paid') return { action: 'clear-payment-failed' };

  return { action: 'none' };
}

export function decideLifecycleAction(
  event: Stripe.Event,
  sub: Stripe.Subscription,
  env: NodeJS.ProcessEnv = process.env,
): ApplianceLifecycleDecision {
  const decision = decideLifecycleActionCore(event, sub, env);
  return isSubscriptionEvent(event) ? { ...decision, state: subscriptionStateSnapshot(event, sub) } : decision;
}

export async function handleApplianceSubscriptionEvent(
  event: Stripe.Event,
  stripe: Pick<Stripe, 'subscriptions'>,
  deps: ApplianceLifecycleDeps = defaultDeps,
): Promise<ApplianceLifecycleOutcome> {
  const sub = await resolveApplianceSubscription(event, stripe);
  if (!sub) return { handled: false, tenantId: null, subscriptionId: null, action: 'none' };

  const tenantId = tenantIdFromSubscription(sub);
  const decision = decideLifecycleAction(event, sub);
  const outcome: ApplianceLifecycleOutcome = {
    handled: true,
    tenantId,
    subscriptionId: sub.id,
    action: decision.action,
    seats: decision.seats,
    endReason: decision.endReason,
    state: decision.state,
  };

  logger.info(`[ApplianceLifecycle] ${event.type} sub=${sub.id} tenant=${tenantId ?? 'unknown'} action=${decision.action}`);

  if (decision.action === 'revoke') {
    await deps.revoke(sub.id);
    // After the revoke, so a payment-state failure (e.g. C4 not yet upgraded)
    // can never stop the lapse itself; the thrown error still makes Stripe redeliver.
    // The retry date is explicitly cleared: there are no more retries.
    if (decision.endReason) {
      await deps.setPaymentState(sub.id, { state: 'failed', next_retry_at: null });
    }
  } else if (decision.action === 'sync-seats') {
    if (!tenantId) {
      logger.warn(`[ApplianceLifecycle] cannot sync seats for ${sub.id}: no tenant id in subscription metadata`);
      outcome.action = 'none';
    } else {
      await deps.syncSeats(tenantId, decision.seats!);
      if (decision.clearsPaymentFailure) await deps.setPaymentState(sub.id, { state: 'ok' });
    }
  } else if (decision.action === 'mark-payment-failed') {
    await deps.setPaymentState(sub.id, {
      state: 'failed',
      ...(decision.nextRetryAt !== undefined ? { next_retry_at: decision.nextRetryAt } : {}),
      ...(decision.updatePaymentUrl !== undefined ? { update_payment_url: decision.updatePaymentUrl } : {}),
    });
  } else if (decision.action === 'clear-payment-failed') {
    await deps.setPaymentState(sub.id, { state: 'ok' });
  }

  // Mirror on every subscription event (not just transitions) so C4 self-heals.
  // After revoke/seats: a failure here must not skip those, and Stripe's retry
  // re-runs all three idempotently.
  if (decision.state) {
    await deps.syncState(sub.id, decision.state);
  }

  if (deps.audit) {
    await deps.audit({
      event_id: event.id,
      event_type: event.type,
      subscription_id: sub.id,
      tenant_id: tenantId,
      action: outcome.action,
      end_reason: outcome.endReason ?? null,
      seats: outcome.seats ?? null,
      status: sub.status,
      cancel_at_period_end: decision.state?.cancel_at_period_end ?? null,
    }).catch(() => undefined);
  }

  return outcome;
}
