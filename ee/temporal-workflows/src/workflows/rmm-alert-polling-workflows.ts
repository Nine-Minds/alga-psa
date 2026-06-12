import { proxyActivities } from '@temporalio/workflow';
import type * as activities from '../activities/rmm-alert-polling-activities';

const { runRmmAlertReconciliationActivity, runHuntressIncidentPollActivity } = proxyActivities<
  typeof activities
>({
  startToCloseTimeout: '10m',
  retry: {
    initialInterval: '10s',
    maximumInterval: '2m',
    backoffCoefficient: 2,
    maximumAttempts: 3,
  },
});

export interface RmmAlertReconciliationWorkflowInput {
  tenantId: string;
  integrationId: string;
  provider: string;
}

/** One reconciliation cycle for one RMM integration (scheduled per-integration). */
export async function rmmAlertReconciliationWorkflow(
  input: RmmAlertReconciliationWorkflowInput
): Promise<void> {
  await runRmmAlertReconciliationActivity(input);
}

export interface HuntressIncidentPollWorkflowInput {
  tenantId: string;
  integrationId: string;
}

/** One Huntress incident poll for one integration (scheduled per-integration). */
export async function huntressIncidentPollWorkflow(
  input: HuntressIncidentPollWorkflowInput
): Promise<void> {
  await runHuntressIncidentPollActivity(input);
}
