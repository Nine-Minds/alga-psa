import { proxyActivities } from '@temporalio/workflow';
import type * as activities from '../activities';

const { renewMicrosoftCalendarWebhooksActivity } = proxyActivities<typeof activities>({
  startToCloseTimeout: '5m',
});

export async function calendarWebhookMaintenanceWorkflow(options: { tenantId?: string; lookAheadMinutes?: number } = {}): Promise<void> {
  await renewMicrosoftCalendarWebhooksActivity(options);
}

