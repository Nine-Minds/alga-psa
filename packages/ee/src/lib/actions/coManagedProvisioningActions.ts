'use server';

import type { CoManagedProvisioningRequest } from '@alga-psa/co-managed';

export async function provisionCoManagedWorkspaceAction(_input: Omit<CoManagedProvisioningRequest, 'sponsorTenant' | 'requestedBy'>): Promise<
  { operationId: string; enqueued: boolean } | { operationId: string; rejected: true; errorCode: string }
> {
  throw new Error('Co-managed provisioning requires a licensed Pro installation with the tenant workflow worker.');
}

export async function retryCoManagedProvisioningAction(_operationId: string): Promise<{ enqueued: boolean }> {
  throw new Error('Co-managed provisioning requires a licensed Pro installation with the tenant workflow worker.');
}
