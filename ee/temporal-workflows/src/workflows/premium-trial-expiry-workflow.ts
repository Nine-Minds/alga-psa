import { proxyActivities } from '@temporalio/workflow';
import type * as activities from '../activities';

const { checkExpiredPremiumTrialsActivity } = proxyActivities<typeof activities>({
  startToCloseTimeout: '5m',
  retry: {
    maximumAttempts: 3,
    backoffCoefficient: 2.0,
    initialInterval: '5s',
    maximumInterval: '30s',
  },
});

/**
 * Scheduled workflow that checks for expired Premium trials and reverts them to Pro.
 * Runs daily as a safety net — the primary check is in the Stripe webhook handler.
 */
export async function premiumTrialExpiryWorkflow(): Promise<void> {
  await checkExpiredPremiumTrialsActivity();
}
