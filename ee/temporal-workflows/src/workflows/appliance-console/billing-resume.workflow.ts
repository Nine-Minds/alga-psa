import { c4, stripe, fail, isCompSubscriptionId } from './proxies';
import type { BillingResumeArgs, BillingPauseResult } from './types';

/** Resume Stripe payment collection. */
export async function applianceBillingResumeWorkflow(args: BillingResumeArgs): Promise<BillingPauseResult> {
  const detail = await c4.c4GetTenantDetail({ tenantId: args.tenantId });
  const ent = detail.entitlement;
  if (!ent || ent.kind === 'comp' || isCompSubscriptionId(ent.stripe_sub_id)) {
    fail('Tenant has no Stripe subscription to resume', 'no_stripe_subscription');
  }
  const resumed = await stripe.stripeResumeCollection({ stripeSubId: ent.stripe_sub_id });
  return { paused: resumed.paused, resumes_at: resumed.resumesAt };
}
