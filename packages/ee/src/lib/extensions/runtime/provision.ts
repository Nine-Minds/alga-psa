// CE stub for EE runtime provisioning utilities
// - enqueueProvisioningWorkflow: no-op in CE

export async function enqueueProvisioningWorkflow(_params: {
  tenantId: string;
  extensionId: string;
  installId?: string;
}) {
  return { enqueued: false } as const;
}

