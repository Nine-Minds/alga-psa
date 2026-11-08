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
  AlgaLicenseHttpError,
  reactivateApplianceEntitlement,
  revokeApplianceEntitlement,
  syncApplianceSubscriptionState,
  updateApplianceEntitlementSeats,
  type ApplianceSubscriptionState,
} from './algaLicenseAdminClient';
import { findPerSeatItem } from './stripeBilling';

export const APPLIANCE_DEPLOYMENT_TYPE = 'appliance';

/** Sub statuses after which C4 must stop rolling tokens. */
const LAPSED_STATUSES = new Set<string>(['unpaid', 'canceled', 'incomplete_expired']);
/** Sub statuses that mean "paying" for entitlement purposes. */
const LIVE_STATUSES = new Set<string>(['active', 'trialing']);

export type LifecycleAction = 'revoke' | 'reactivate' | 'sync-seats' | 'none';

export interface ApplianceLifecycleOutcome {
  handled: boolean;
  tenantId: string | null;
  subscriptionId: string | null;
  action: LifecycleAction;
  seats?: number;
  /** Set for subscription.* events: the state mirrored to C4. */
  state?: ApplianceSubscriptionState;
}

export interface ApplianceLifecycleDeps {
  revoke: (stripeSubId: string) => Promise<unknown>;
  /** Re-enable a revoked entitlement, keyed by subscription id (idempotent in C4). */
  reactivate: (stripeSubId: string) => Promise<unknown>;
  syncSeats: (tenantId: string, seats: number) => Promise<unknown>;
  /** Mirror the subscription snapshot onto the C4 entitlement (display only, never revokes). */
  syncState: (stripeSubId: string, state: ApplianceSubscriptionState) => Promise<unknown>;
  audit?: (details: Record<string, unknown>) => Promise<void>;
}

const defaultDeps: ApplianceLifecycleDeps = {
  revoke: revokeApplianceEntitlement,
  reactivate: reactivateApplianceEntitlement,
  syncSeats: updateApplianceEntitlementSeats,
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
  const object = event.data.object as { object?: string; subscription?: string | { id: string } | null; metadata?: Stripe.Metadata | null };
  if (object.object === 'subscription') {
    return isApplianceSubscription(object) ? (object as unknown as Stripe.Subscription) : null;
  }
  if (object.object === 'invoice' && object.subscription) {
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
 * Actions: 'revoke' (the subscription actually ends: deleted, or updated into a
 * LAPSED status), 'reactivate' (updated back to a LIVE status from a LAPSED
 * `previous_attributes.status`; carries `seats` when a per-seat line exists so
 * the seat sync can follow), 'sync-seats' (items changed on a live sub), 'none'.
 * A cancel *request* (`cancel_at_period_end` false→true, or `cancel_at` set) and
 * its undo leave the customer paid-through, so they fall through to 'none' (or a
 * seat sync) and are only mirrored via `state`.
 *
 * Status is read from `sub`, which the handler refreshes from Stripe for
 * `updated` events, so a stale payload cannot flip the decision. Reactivation is
 * gated on an actual lapsed→live transition: the previous status must be one of
 * the lapsed statuses this handler revokes on (unpaid/canceled/incomplete_expired).
 * past_due/incomplete/paused never caused a revoke here, so recovering from them
 * must not re-enable an operator revoke; they fall through to sync-seats (items
 * changed) or none. An operator may soft-revoke an entitlement while the Stripe
 * sub is still active, and routine updates (renewals, period rollovers, metadata
 * edits) must not undo that. Out-of-order delivery stays safe because the
 * decision uses fresh state and revoke/reactivate are idempotent: a stale lapse
 * event whose fresh status is live does not revoke, and a stale
 * `updated(active, prev unpaid)` whose fresh status is canceled revokes instead
 * of reactivating.
 */
export function decideLifecycleAction(
  event: Stripe.Event,
  sub: Stripe.Subscription,
  env: NodeJS.ProcessEnv = process.env,
): { action: LifecycleAction; seats?: number; state?: ApplianceSubscriptionState } {
  const state = isSubscriptionEvent(event) ? subscriptionStateSnapshot(event, sub) : undefined;
  const decision = decideAction(event, sub, env);
  return state ? { ...decision, state } : decision;
}

function decideAction(
  event: Stripe.Event,
  sub: Stripe.Subscription,
  env: NodeJS.ProcessEnv,
): { action: LifecycleAction; seats?: number } {
  if (event.type === 'customer.subscription.deleted') return { action: 'revoke' };

  if (event.type === 'customer.subscription.updated') {
    if (LAPSED_STATUSES.has(sub.status)) return { action: 'revoke' };

    const previous = (event.data.previous_attributes ?? {}) as { status?: string; items?: unknown };
    const seats = findPerSeatItem(sub, env)?.quantity ?? null;

    const cameBackToLife =
      LIVE_STATUSES.has(sub.status) && typeof previous.status === 'string' && LAPSED_STATUSES.has(previous.status);
    if (cameBackToLife) {
      // C4's seat PATCH only updates an ACTIVE entitlement (404 not_found otherwise), so the
      // entitlement is re-enabled first; `seats` (if any) is synced afterwards.
      return seats != null ? { action: 'reactivate', seats } : { action: 'reactivate' };
    }

    const quantityChanged = previous.items !== undefined;
    if (LIVE_STATUSES.has(sub.status) && quantityChanged && seats != null) return { action: 'sync-seats', seats };
    return { action: 'none' };
  }

  // invoice.payment_failed: Stripe retries on its own schedule; the subscription
  // status flips to past_due/unpaid and the `updated` event above handles the lapse.
  return { action: 'none' };
}

/**
 * True only for alga-license's real "no entitlement" answer: 404 with the JSON
 * body code `not_found` (e.g. operator soft-revoke, or not provisioned yet). A
 * retry cannot fix that, so it is tolerated. A 404 WITHOUT the code is Fastify's
 * unknown-route reply: the deployed alga-license lacks the route, which a retry
 * (after deploying alga-license) does fix, so it must propagate.
 */
export function isEntitlementNotFound(err: unknown): boolean {
  return err instanceof AlgaLicenseHttpError && err.status === 404 && err.code === 'not_found';
}

/** Log an alga-license failure that looks like a missing route, so the cause is obvious. */
function logIfRouteMissing(err: unknown, what: string, subId: string): void {
  if (err instanceof AlgaLicenseHttpError && err.status === 404 && !isEntitlementNotFound(err)) {
    logger.error(
      `[ApplianceLifecycle] ${what} for ${subId} got a 404 with no not_found code: alga-license lacks route — deploy alga-license first (event will be retried)`,
    );
  }
}

/**
 * Seat sync that tolerates only a real entitlement-not-found 404 (see
 * isEntitlementNotFound), which a retry cannot fix and would otherwise make
 * Stripe redeliver forever. Every other error, including a route-missing 404,
 * rethrows so Stripe retries. Returns false when skipped.
 */
async function syncSeatsTolerantOfNotFound(
  deps: ApplianceLifecycleDeps,
  tenantId: string,
  subId: string,
  seats: number,
): Promise<boolean> {
  try {
    await deps.syncSeats(tenantId, seats);
    return true;
  } catch (err) {
    if (!isEntitlementNotFound(err)) {
      logIfRouteMissing(err, `seat sync (tenant=${tenantId})`, subId);
      throw err;
    }
    logger.warn(`[ApplianceLifecycle] alga-license entitlement inactive or absent for ${subId} (tenant=${tenantId}); seats not synced`);
    return false;
  }
}

export async function handleApplianceSubscriptionEvent(
  event: Stripe.Event,
  stripe: Pick<Stripe, 'subscriptions'>,
  deps: ApplianceLifecycleDeps = defaultDeps,
): Promise<ApplianceLifecycleOutcome> {
  const resolved = await resolveApplianceSubscription(event, stripe);
  if (!resolved) return { handled: false, tenantId: null, subscriptionId: null, action: 'none' };

  // The event payload is a snapshot from when it was emitted; a retried or
  // out-of-order `updated` event can carry a status that is no longer true (e.g.
  // updated(active) delivered after the sub was deleted). Decide on the state
  // Stripe reports now so a stale event can neither resurrect nor revoke wrongly.
  // `deleted` events are terminal and need no refresh.
  const sub =
    event.type === 'customer.subscription.updated' ? await stripe.subscriptions.retrieve(resolved.id) : resolved;

  const tenantId = tenantIdFromSubscription(sub);
  const decision = decideLifecycleAction(event, sub);
  const outcome: ApplianceLifecycleOutcome = {
    handled: true,
    tenantId,
    subscriptionId: sub.id,
    action: decision.action,
    seats: decision.seats,
    state: decision.state,
  };

  logger.info(`[ApplianceLifecycle] ${event.type} sub=${sub.id} tenant=${tenantId ?? 'unknown'} action=${decision.action}`);

  if (decision.action === 'revoke') {
    await deps.revoke(sub.id);
  } else if (decision.action === 'reactivate') {
    // Keyed by subscription id: no tenant id needed.
    let reactivated = true;
    try {
      await deps.reactivate(sub.id);
    } catch (err) {
      // C4 says it has no entitlement for this sub (404 + code not_found, e.g.
      // not provisioned yet): nothing to re-enable, and retrying would only fail
      // again. Anything else (5xx, network, or a 404 from a missing route) is a
      // real failure and must propagate so Stripe retries.
      if (!isEntitlementNotFound(err)) {
        logIfRouteMissing(err, 'reactivate', sub.id);
        throw err;
      }
      logger.warn(`[ApplianceLifecycle] no alga-license entitlement to reactivate for ${sub.id} (tenant=${tenantId ?? 'unknown'}); skipping`);
      outcome.action = 'none';
      outcome.seats = undefined;
      reactivated = false;
    }
    if (reactivated && decision.seats != null) {
      if (!tenantId) {
        logger.warn(`[ApplianceLifecycle] cannot sync seats for ${sub.id}: no tenant id in subscription metadata`);
        outcome.seats = undefined;
      } else {
        if (!(await syncSeatsTolerantOfNotFound(deps, tenantId, sub.id, decision.seats))) outcome.seats = undefined;
      }
    }
  } else if (decision.action === 'sync-seats') {
    if (!tenantId) {
      logger.warn(`[ApplianceLifecycle] cannot sync seats for ${sub.id}: no tenant id in subscription metadata`);
      outcome.action = 'none';
    } else {
      if (!(await syncSeatsTolerantOfNotFound(deps, tenantId, sub.id, decision.seats!))) {
        outcome.action = 'none';
        outcome.seats = undefined;
      }
    }
  }

  // Mirror on every subscription event (not just transitions) so C4 self-heals.
  // After revoke/seats: a failure here must not skip those, and Stripe's retry
  // re-runs all three idempotently.
  if (decision.state) {
    try {
      await deps.syncState(sub.id, decision.state);
    } catch (err) {
      logIfRouteMissing(err, 'subscription-state mirror', sub.id);
      throw err;
    }
  }

  if (deps.audit) {
    await deps.audit({
      event_id: event.id,
      event_type: event.type,
      subscription_id: sub.id,
      tenant_id: tenantId,
      action: outcome.action,
      seats: outcome.seats ?? null,
      status: sub.status,
      cancel_at_period_end: decision.state?.cancel_at_period_end ?? null,
    }).catch(() => undefined);
  }

  return outcome;
}
