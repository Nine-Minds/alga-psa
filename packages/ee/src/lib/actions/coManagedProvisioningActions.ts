'use server';

// CE stub for the EE co-managed provisioning actions. The request shape is declared
// structurally rather than imported from '@alga-psa/co-managed': a CE stub must not
// depend on the enterprise package it stands in for, and importing it here closes the
// cycle @alga-psa/co-managed -> @alga-psa/shared -> @alga-psa/ee-stubs. Matches the
// self-contained convention already used by coManagedBillingActions.ts.
type CoManagedProvisioningInput = {
  operationId: string;
  clientId: string;
  workspaceName: string;
  administrator: { firstName: string; lastName: string; email: string };
  seats: number;
  visibilityMode: 'board_scope' | 'escalation_only';
  escalationBoardId: string;
};

export async function provisionCoManagedWorkspaceAction(_input: CoManagedProvisioningInput): Promise<
  { operationId: string; enqueued: boolean } | { operationId: string; rejected: true; errorCode: string }
> {
  throw new Error('Co-managed provisioning requires a licensed Pro installation with the tenant workflow worker.');
}

export async function retryCoManagedProvisioningAction(_operationId: string): Promise<{ enqueued: boolean }> {
  throw new Error('Co-managed provisioning requires a licensed Pro installation with the tenant workflow worker.');
}

export async function cancelCoManagedProvisioningAction(_operationId: string): Promise<{ enqueued: boolean }> {
  throw new Error('Co-managed provisioning requires a licensed Pro installation with the tenant workflow worker.');
}
