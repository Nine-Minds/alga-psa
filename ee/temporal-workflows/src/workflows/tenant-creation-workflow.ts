import { log, sleep } from '@temporalio/workflow';
import type { TenantCreationInput, TenantCreationResult } from '../types/workflow-types.js';
import { runTenantCreationOrchestration } from './shared/tenant-creation-steps.js';

export {
  cancelWorkflowSignal,
  updateWorkflowSignal,
  getWorkflowStateQuery,
} from './shared/tenant-creation-steps.js';

/**
 * Main tenant creation workflow (PSA)
 *
 * Orchestrates creation of a new PSA tenant: tenant record, onboarding seeds,
 * admin user, tenant data, customer tracking in the nineminds tenant, and
 * welcome email. Supports cancellation and exposes state via query.
 */
export async function tenantCreationWorkflow(
  input: TenantCreationInput
): Promise<TenantCreationResult> {
  return runTenantCreationOrchestration(input, {
    customerTag: 'PSA Customer',
  });
}

/**
 * Simple workflow for testing connectivity and basic functionality
 */
export async function healthCheckWorkflow(): Promise<{ status: string; timestamp: string }> {
  log.info('Health check workflow started');

  await sleep('100ms');

  return {
    status: 'healthy',
    timestamp: new Date().toISOString(),
  };
}
