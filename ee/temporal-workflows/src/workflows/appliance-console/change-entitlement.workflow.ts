import { c4, stripe, fail, isCompSubscriptionId } from './proxies';
import type { ChangeEntitlementArgs, ChangeEntitlementResult } from './types';

/**
 * Seats and/or tier. `billed` changes Stripe first, then records the result on
 * the C4 entitlement so licensing never runs ahead of billing. `comp` writes
 * C4 only and leaves Stripe as is (the console shows the resulting mismatch).
 * The appliance picks the change up on its next check-in or manual refresh.
 */
export async function applianceChangeEntitlementWorkflow(args: ChangeEntitlementArgs): Promise<ChangeEntitlementResult> {
  const detail = await c4.c4GetTenantDetail({ tenantId: args.tenantId });
  const ent = detail.entitlement;
  if (!ent?.active) fail('Tenant has no active entitlement', 'no_active_entitlement');
  const seatsProvided = args.seats !== undefined;
  if (!seatsProvided && !args.tier) fail('seats or tier is required', 'invalid_input');

  // undefined = unchanged, null = unlimited (comp only), number = exact.
  let seats: number | null | undefined = args.seats;
  let tier = args.tier ?? ent.tier;
  let stripeUpdated = false;

  if (args.mode === 'billed') {
    if (ent.kind === 'comp' || isCompSubscriptionId(ent.stripe_sub_id)) {
      fail('A comp entitlement has no Stripe subscription to bill; use comp mode', 'comp_entitlement');
    }
    if (seats === null) fail('Unlimited seats cannot be billed; use comp mode', 'invalid_input');
    if (args.tier && args.tier !== ent.tier) {
      const changed = await stripe.stripeChangeTier({
        stripeSubId: ent.stripe_sub_id,
        tier: args.tier,
        seats: seats ?? null,
        proration: args.proration,
      });
      seats = changed.seats;
      tier = changed.tier;
    } else if (typeof seats === 'number') {
      const changed = await stripe.stripeUpdateSeatQuantity({
        stripeSubId: ent.stripe_sub_id,
        seats,
        proration: args.proration,
      });
      seats = changed.seats;
    }
    stripeUpdated = true;
  }

  const updated = await c4.c4UpdateTenantEntitlement({
    tenantId: args.tenantId,
    ...(seats !== undefined ? { seats } : {}),
    ...(args.tier ? { tier } : {}),
  });

  return { mode: args.mode, seats: updated.seats, tier: updated.tier, stripe_updated: stripeUpdated };
}
