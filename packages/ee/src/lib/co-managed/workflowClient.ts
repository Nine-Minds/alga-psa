// CE stub for the EE co-managed provisioning workflow client. Community Edition has no
// tenant workflow worker, so nothing is ever scheduled.
type CoManagedWorkflowInput = { sponsorTenant: string; operationId: string };

export async function startCoManagedProvisioningWorkflow(_input: CoManagedWorkflowInput): Promise<{ enqueued: boolean }> {
  return { enqueued: false };
}

export async function startCoManagedProvisioningCleanupWorkflow(_input: CoManagedWorkflowInput): Promise<{ enqueued: boolean }> {
  return { enqueued: false };
}
