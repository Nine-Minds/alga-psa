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
  reactivateApplianceEntitlement,
  revokeApplianceEntitlement,
  updateApplianceEntitlementSeats,
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
}

export interface ApplianceLifecycleDeps {
  revoke: (stripeSubId: string) => Promise<unknown>;
  /** Re-enable a revoked entitlement, keyed by subscription id (idempotent in C4). */
  reactivate: (stripeSubId: string) => Promise<unknown>;
  syncSeats: (tenantId: string, seats: number) => Promise<unknown>;
  audit?: (details: Record<string, unknown>) => Promise<void>;
}

const defaultDeps: ApplianceLifecycleDeps = {
  revoke: revokeApplianceEntitlement,
  reactivate: reactivateApplianceEntitlement,
  syncSeats: updateApplianceEntitlementSeats,
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
 * Pure decision: what does this event mean for the C4 entitlement?
 *
 * Decides on the subscription's CURRENT status, never on `previous_attributes`
 * (missing or stale under Stripe retries and out-of-order delivery). Reactivation
 * is idempotent in C4, so every live-status `updated` event re-asserts it and
 * retries/duplicates converge on the right state. Callers must pass a freshly
 * retrieved subscription for `updated` events (see handleApplianceSubscriptionEvent).
 */
export function decideLifecycleAction(
  event: Stripe.Event,
  sub: Stripe.Subscription,
  env: NodeJS.ProcessEnv = process.env,
): { action: LifecycleAction; seats?: number } {
  if (event.type === 'customer.subscription.deleted') return { action: 'revoke' };

  if (event.type === 'customer.subscription.updated') {
    if (LAPSED_STATUSES.has(sub.status)) return { action: 'revoke' };

    if (LIVE_STATUSES.has(sub.status)) {
      // C4's seat PATCH only updates an ACTIVE entitlement (404 otherwise), so the
      // entitlement is re-enabled first; `seats` (if any) is synced afterwards.
      const seats = findPerSeatItem(sub, env)?.quantity ?? null;
      return seats != null ? { action: 'reactivate', seats } : { action: 'reactivate' };
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
  };

  logger.info(`[ApplianceLifecycle] ${event.type} sub=${sub.id} tenant=${tenantId ?? 'unknown'} action=${decision.action}`);

  if (decision.action === 'revoke') {
    await deps.revoke(sub.id);
  } else if (decision.action === 'reactivate') {
    // Keyed by subscription id: no tenant id needed.
    await deps.reactivate(sub.id);
    if (decision.seats != null) {
      if (!tenantId) {
        logger.warn(`[ApplianceLifecycle] cannot sync seats for ${sub.id}: no tenant id in subscription metadata`);
        outcome.seats = undefined;
      } else {
        await deps.syncSeats(tenantId, decision.seats);
      }
    }
  } else if (decision.action === 'sync-seats') {
    if (!tenantId) {
      logger.warn(`[ApplianceLifecycle] cannot sync seats for ${sub.id}: no tenant id in subscription metadata`);
      outcome.action = 'none';
    } else {
      await deps.syncSeats(tenantId, decision.seats!);
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
    }).catch(() => undefined);
  }

  return outcome;
}
