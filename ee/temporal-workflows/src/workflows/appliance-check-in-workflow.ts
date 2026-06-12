import { proxyActivities } from '@temporalio/workflow';
import type * as activities from '../activities';

const { applianceLicenseCheckInActivity } = proxyActivities<typeof activities>({
  // The check-in is a quick HTTP round-trip; keep the per-attempt window short.
  startToCloseTimeout: '30s',
  retry: {
    // Ride out brief outages, then give up — the daily schedule re-attempts and
    // a connected token has weeks of grace, so missing a cycle is harmless.
    maximumAttempts: 5,
    backoffCoefficient: 2.0,
    initialInterval: '10s',
    maximumInterval: '2m',
  },
});

/**
 * Scheduled workflow that renews this install's connected license by checking
 * in with the alga-license service. Runs daily (see setupSchedules) and once at
 * worker boot so a box that was powered off refreshes promptly. No-ops on
 * SaaS/cloud and on non-connected (essentials/airgap/CE/trial) installs.
 */
export async function applianceCheckInWorkflow(): Promise<void> {
  await applianceLicenseCheckInActivity();
}
