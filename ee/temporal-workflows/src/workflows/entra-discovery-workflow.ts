import { log, proxyActivities } from '@temporalio/workflow';
import type { EntraDiscoveryWorkflowInput } from '../types/entra-sync';

const activities = proxyActivities<{
  discoverManagedTenantsActivity(input: {
    tenantId: string;
  }): Promise<{ discoveredTenantCount: number }>;
}>({
  startToCloseTimeout: '20m',
  retry: {
    maximumAttempts: 3,
    initialInterval: '5s',
    maximumInterval: '2m',
    backoffCoefficient: 2,
  },
});

export async function entraDiscoveryWorkflow(
  input: EntraDiscoveryWorkflowInput
): Promise<{ discoveredTenantCount: number }> {
  log.info('Starting Entra discovery workflow', {
    tenantId: input.tenantId,
    actorUserId: input.actor?.userId,
  });

  const result = await activities.discoverManagedTenantsActivity({
    tenantId: input.tenantId,
  });

  log.info('Completed Entra discovery workflow', {
    tenantId: input.tenantId,
    discoveredTenantCount: result.discoveredTenantCount,
  });

  return result;
}
