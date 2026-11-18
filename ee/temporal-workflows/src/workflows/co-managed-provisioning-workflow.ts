import { proxyActivities } from '@temporalio/workflow';
import type { CoManagedProvisioningWorkflowInput } from '../activities/co-managed-provisioning-activities.js';

const activities = proxyActivities<{
  cleanupCoManagedCustomer(input: CoManagedProvisioningWorkflowInput): Promise<unknown>;
  bootstrapCoManagedCustomer(input: CoManagedProvisioningWorkflowInput): Promise<unknown>;
  deliverCoManagedAdministratorInvitation(input: CoManagedProvisioningWorkflowInput): Promise<unknown>;
}>({ startToCloseTimeout: '10m', retry: { maximumAttempts: 5, initialInterval: '5s', maximumInterval: '1m' } });

export async function coManagedProvisioningWorkflow(input: CoManagedProvisioningWorkflowInput): Promise<void> {
  const skipped = await activities.bootstrapCoManagedCustomer(input);
  if (isSkip(skipped)) return;
  await activities.deliverCoManagedAdministratorInvitation(input);
}

export async function coManagedProvisioningCleanupWorkflow(input: CoManagedProvisioningWorkflowInput): Promise<void> {
  await activities.cleanupCoManagedCustomer(input);
}

function isSkip(value: unknown): boolean {
  return typeof value === 'object' && value !== null && (value as { skipped?: unknown }).skipped === true;
}
