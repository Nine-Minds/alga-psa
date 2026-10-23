import { c4, stripe, fail, isCompSubscriptionId } from './proxies';
import type { ChangeEntitlementArgs, ChangeEntitlementResult } from './types';

/**
 * Seat change. `billed` changes Stripe first, then records the result on the
 * C4 entitlement so licensing never runs ahead of billing. `comp` writes C4
 * only and leaves Stripe as is (the console shows the resulting mismatch).
 * The appliance picks the change up on its next check-in or manual refresh.
 */
export async function applianceChangeEntitlementWorkflow(args: ChangeEntitlementArgs): Promise<ChangeEntitlementResult> {
  const detail = await c4.c4GetTenantDetail({ tenantId: args.tenantId });
  const ent = detail.entitlement;
  if (!ent?.active) fail('Tenant has no active entitlement', 'no_active_entitlement');

  // null = unlimited (comp only), number = exact.
  let seats: number | null = args.seats;
  let stripeUpdated = false;

  if (args.mode === 'billed') {
    if (ent.kind === 'comp' || isCompSubscriptionId(ent.stripe_sub_id)) {
      fail('A comp entitlement has no Stripe subscription to bill; use comp mode', 'comp_entitlement');
    }
    if (seats === null) fail('Unlimited seats cannot be billed; use comp mode', 'invalid_input');
    const changed = await stripe.stripeUpdateSeatQuantity({
      stripeSubId: ent.stripe_sub_id,
      seats,
      proration: args.proration,
    });
    seats = changed.seats;
    stripeUpdated = true;
  }

  const updated = await c4.c4UpdateTenantEntitlement({ tenantId: args.tenantId, seats });

  return { mode: args.mode, seats: updated.seats, stripe_updated: stripeUpdated };
}
