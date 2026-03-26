import { proxyActivities, log } from '@temporalio/workflow';
import type {
  ExecuteNinjaOneProactiveRefreshResult,
  NinjaOneProactiveRefreshWorkflowInput,
} from '@ee/lib/integrations/ninjaone/proactiveRefresh';

type ProactiveRefreshActivities = {
  proactiveNinjaOneTokenRefreshActivity(input: {
    tenantId: string;
    integrationId: string;
    scheduleNonce: number;
    scheduledFor: string;
  }): Promise<ExecuteNinjaOneProactiveRefreshResult>;
};

const activities = proxyActivities<ProactiveRefreshActivities>({
  startToCloseTimeout: '5m',
  retry: {
    initialInterval: '10s',
    maximumInterval: '2m',
    backoffCoefficient: 2,
    maximumAttempts: 5,
  },
});

export async function ninjaOneProactiveTokenRefreshWorkflow(
  input: NinjaOneProactiveRefreshWorkflowInput
): Promise<ExecuteNinjaOneProactiveRefreshResult> {
  log.info('Starting NinjaOne proactive token refresh workflow', {
    tenantId: input.tenantId,
    integrationId: input.integrationId,
    scheduleNonce: input.scheduleNonce,
    scheduledFor: input.scheduledFor,
    scheduledBy: input.scheduledBy,
  });

  const result = await activities.proactiveNinjaOneTokenRefreshActivity({
    tenantId: input.tenantId,
    integrationId: input.integrationId,
    scheduleNonce: input.scheduleNonce,
    scheduledFor: input.scheduledFor,
  });

  log.info('Completed NinjaOne proactive token refresh workflow', {
    tenantId: input.tenantId,
    integrationId: input.integrationId,
    scheduleNonce: input.scheduleNonce,
    outcome: result.outcome,
  });

  return result;
}
