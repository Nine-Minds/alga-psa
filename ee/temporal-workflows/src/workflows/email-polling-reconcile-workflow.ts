import { proxyActivities } from '@temporalio/workflow';
import type * as activities from '../activities';

const { reconcilePollingMicrosoftProvidersActivity } = proxyActivities<typeof activities>({
  startToCloseTimeout: '5m',
});

export async function emailPollingReconcileWorkflow(
  options: { tenantId?: string; providerId?: string } = {}
): Promise<void> {
  await reconcilePollingMicrosoftProvidersActivity(options);
}
