import { proxyActivities } from '@temporalio/workflow';
import type { CoManagedProvisioningWorkflowInput } from '../activities/co-managed-provisioning-activities.js';

const activities = proxyActivities<{
  bootstrapCoManagedCustomer(input: CoManagedProvisioningWorkflowInput): Promise<void>;
  deliverCoManagedAdministratorInvitation(input: CoManagedProvisioningWorkflowInput): Promise<void>;
}>({ startToCloseTimeout: '10m', retry: { maximumAttempts: 5, initialInterval: '5s', maximumInterval: '1m' } });

export async function coManagedProvisioningWorkflow(input: CoManagedProvisioningWorkflowInput): Promise<void> {
  await activities.bootstrapCoManagedCustomer(input);
  await activities.deliverCoManagedAdministratorInvitation(input);
}
