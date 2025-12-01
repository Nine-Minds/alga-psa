import { proxyActivities } from '@temporalio/workflow';
import type * as activities from '../activities';

const { renewMicrosoftWebhooksActivity } = proxyActivities<typeof activities>({
  startToCloseTimeout: '5m',
});

export async function emailWebhookMaintenanceWorkflow(options: { tenantId?: string; lookAheadMinutes?: number } = {}): Promise<void> {
  await renewMicrosoftWebhooksActivity(options);
}

