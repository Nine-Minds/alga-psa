import { c4, stripe, fail, isCompSubscriptionId } from './proxies';
import type { BillingPauseArgs, BillingPauseResult } from './types';

/** Pause Stripe payment collection; the license keeps rolling. */
export async function applianceBillingPauseWorkflow(args: BillingPauseArgs): Promise<BillingPauseResult> {
  const detail = await c4.c4GetTenantDetail({ tenantId: args.tenantId });
  const ent = detail.entitlement;
  if (!ent || ent.kind === 'comp' || isCompSubscriptionId(ent.stripe_sub_id)) {
    fail('Tenant has no Stripe subscription to pause', 'no_stripe_subscription');
  }
  const paused = await stripe.stripePauseCollection({
    stripeSubId: ent.stripe_sub_id,
    behavior: args.behavior,
    resumesAt: args.resumesAt,
  });
  return { paused: paused.paused, resumes_at: paused.resumesAt };
}
