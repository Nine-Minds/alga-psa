import logger from '@alga-psa/core/logger';
import {
  executeNinjaOneProactiveRefresh,
  type ExecuteNinjaOneProactiveRefreshResult,
} from '@ee/lib/integrations/ninjaone/proactiveRefresh';

export interface ProactiveNinjaOneTokenRefreshActivityInput {
  tenantId: string;
  integrationId: string;
  scheduleNonce: number;
  scheduledFor: string;
}

export async function proactiveNinjaOneTokenRefreshActivity(
  input: ProactiveNinjaOneTokenRefreshActivityInput
): Promise<ExecuteNinjaOneProactiveRefreshResult> {
  logger.info('[NinjaOneProactiveRefreshActivity] Starting proactive refresh activity', {
    tenantId: input.tenantId,
    integrationId: input.integrationId,
    scheduleNonce: input.scheduleNonce,
    scheduledFor: input.scheduledFor,
  });

  return executeNinjaOneProactiveRefresh(input);
}
