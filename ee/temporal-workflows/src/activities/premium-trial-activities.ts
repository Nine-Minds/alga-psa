/**
 * Premium Trial Activities for Temporal Workflows
 *
 * Checks for expired Premium trials and reverts them to Pro.
 * Called on a schedule as a safety net — the primary check happens
 * in the Stripe webhook handler on subscription updates.
 */

import { Context } from '@temporalio/activity';
import { getAdminConnection, retryOnAdminReadOnly } from '@alga-psa/db/admin.js';

const logger = () => Context.current().log;

export interface CheckExpiredPremiumTrialsResult {
  reverted: string[];
  errors: string[];
}

/**
 * Find all tenants with expired Premium trials and revert them to Pro.
 *
 * During a Premium trial, Stripe subscription items stay on Pro prices
 * and the tenant's DB plan is set to 'premium'. If the trial expires
 * without the user confirming, we flip the plan back to 'pro' and
 * clear the trial metadata.
 */
export async function checkExpiredPremiumTrialsActivity(): Promise<CheckExpiredPremiumTrialsResult> {
  const log = logger();
  log.info('Checking for expired Premium trials');

  const knex = await getAdminConnection();
  const reverted: string[] = [];
  const errors: string[] = [];

  try {
    // Find subscriptions with an active (unconfirmed) premium trial that has expired.
    // premium_trial = 'true' means pending; 'confirmed' means the user already agreed.
    const expiredTrials = await knex('stripe_subscriptions')
      .whereIn('status', ['active', 'trialing'])
      .whereRaw("metadata->>'premium_trial' = 'true'")
      .whereRaw("(metadata->>'premium_trial_end')::timestamptz < now()")
      .select('tenant', 'stripe_subscription_id');

    log.info(`Found ${expiredTrials.length} expired Premium trial(s)`);

    for (const sub of expiredTrials) {
      try {
        await retryOnAdminReadOnly(
          async () => {
            const k = await getAdminConnection();

            // Revert tenant plan to pro
            await k('tenants')
              .where({ tenant: sub.tenant })
              .update({ plan: 'pro', updated_at: k.fn.now() });

            // Clear trial metadata on the subscription
            const currentSub = await k('stripe_subscriptions')
              .where({ stripe_subscription_id: sub.stripe_subscription_id })
              .select('metadata')
              .first();

            const metadata = currentSub?.metadata || {};
            const { premium_trial, premium_trial_started, premium_trial_end, ...remainingMetadata } = metadata;

            await k('stripe_subscriptions')
              .where({ stripe_subscription_id: sub.stripe_subscription_id })
              .update({
                metadata: {
                  ...remainingMetadata,
                  premium_trial_reverted: new Date().toISOString(),
                },
                updated_at: k.fn.now(),
              });
          },
          { logLabel: 'checkExpiredPremiumTrialsActivity' }
        );

        reverted.push(sub.tenant);
        log.info(`Reverted expired Premium trial for tenant ${sub.tenant}`);
      } catch (error: any) {
        const msg = `${sub.tenant}: ${error.message}`;
        errors.push(msg);
        log.error(`Failed to revert Premium trial for tenant ${sub.tenant}`, { error: error.message });
      }
    }
  } catch (error: any) {
    log.error('Error querying for expired Premium trials', { error: error.message });
    errors.push(`Query error: ${error.message}`);
  }

  log.info('Premium trial check complete', { reverted: reverted.length, errors: errors.length });
  return { reverted, errors };
}
