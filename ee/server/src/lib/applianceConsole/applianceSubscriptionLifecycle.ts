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

export interface ApplianceLifecycleOutcome {
  handled: boolean;
  tenantId: string | null;
  subscriptionId: string | null;
  action: 'revoke' | 'sync-seats' | 'none';
  seats?: number;
  /** Set for subscription.* events: the state mirrored to C4. */
  state?: ApplianceSubscriptionState;
}

export interface ApplianceLifecycleDeps {
  revoke: (stripeSubId: string) => Promise<unknown>;
  syncSeats: (tenantId: string, seats: number) => Promise<unknown>;
  /** Mirror the subscription snapshot onto the C4 entitlement (display only, never revokes). */
  syncState: (stripeSubId: string, state: ApplianceSubscriptionState) => Promise<unknown>;
  audit?: (details: Record<string, unknown>) => Promise<void>;
}

const defaultDeps: ApplianceLifecycleDeps = {
  revoke: revokeApplianceEntitlement,
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
 * Revoke ONLY when the subscription actually ends (deleted, or updated into a
 * LAPSED status). A cancel *request* (`cancel_at_period_end` false→true, or
 * `cancel_at` set) and its undo leave the customer paid-through, so they fall
 * through to 'none' (or a seat sync) and are only mirrored via `state`.
 */
export function decideLifecycleAction(
  event: Stripe.Event,
  sub: Stripe.Subscription,
  env: NodeJS.ProcessEnv = process.env,
): { action: 'revoke' | 'sync-seats' | 'none'; seats?: number; state?: ApplianceSubscriptionState } {
  const state = isSubscriptionEvent(event) ? subscriptionStateSnapshot(event, sub) : undefined;
  const decision = decideAction(event, sub, env);
  return state ? { ...decision, state } : decision;
}

function decideAction(
  event: Stripe.Event,
  sub: Stripe.Subscription,
  env: NodeJS.ProcessEnv,
): { action: 'revoke' | 'sync-seats' | 'none'; seats?: number } {
  if (event.type === 'customer.subscription.deleted') return { action: 'revoke' };

  if (event.type === 'customer.subscription.updated') {
    if (LAPSED_STATUSES.has(sub.status)) return { action: 'revoke' };

    const previous = (event.data.previous_attributes ?? {}) as { status?: string; items?: unknown };
    const item = findPerSeatItem(sub, env);
    const seats = item?.quantity ?? null;

    const cameBackToLife =
      LIVE_STATUSES.has(sub.status) && typeof previous.status === 'string' && !LIVE_STATUSES.has(previous.status);
    const quantityChanged = previous.items !== undefined;

    if ((cameBackToLife || quantityChanged) && seats != null) return { action: 'sync-seats', seats };
    if (cameBackToLife && seats == null) {
      // Reactivation with no seat line (flat sub): still needs the entitlement re-enabled;
      // C4's PATCH upserts active=true via the seats path, so send the current seats (null → skip).
      return { action: 'none' };
    }
    return { action: 'none' };
  }

  if (event.type === 'invoice.payment_failed') {
    // Stripe retries on its own schedule; the subscription status flips to
    // past_due/unpaid and the `updated` event above handles the lapse.
    return { action: 'none' };
  }

  return { action: 'none' };
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
    state: decision.state,
  };

  logger.info(`[ApplianceLifecycle] ${event.type} sub=${sub.id} tenant=${tenantId ?? 'unknown'} action=${decision.action}`);

  if (decision.action === 'revoke') {
    await deps.revoke(sub.id);
  } else if (decision.action === 'sync-seats') {
    if (!tenantId) {
      logger.warn(`[ApplianceLifecycle] cannot sync seats for ${sub.id}: no tenant id in subscription metadata`);
      outcome.action = 'none';
    } else {
      await deps.syncSeats(tenantId, decision.seats!);
    }
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
      seats: outcome.seats ?? null,
      status: sub.status,
      cancel_at_period_end: decision.state?.cancel_at_period_end ?? null,
    }).catch(() => undefined);
  }

  return outcome;
}
