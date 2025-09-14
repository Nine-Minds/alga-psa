// CE stub for EE runtime provisioning utilities
// - computeDomain: reuse shared helper
// - enqueueProvisioningWorkflow: no-op in CE

export { computeDomain } from '@alga-psa/shared/extensions/domain';

export async function enqueueProvisioningWorkflow(_params: {
  tenantId: string;
  extensionId: string;
  installId?: string;
}) {
  return { enqueued: false } as const;
}

