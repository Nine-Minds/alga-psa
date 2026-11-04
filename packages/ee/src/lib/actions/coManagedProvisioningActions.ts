'use server';

// CE stub for the EE co-managed provisioning actions. The request shape is declared
// structurally rather than imported from '@alga-psa/co-managed': a CE stub must not
// depend on the enterprise package it stands in for, and importing it here closes the
// cycle @alga-psa/co-managed -> @alga-psa/shared -> @alga-psa/ee-stubs.
type CoManagedProvisioningInput = {
  operationId: string;
  clientId: string;
  workspaceName: string;
  administratorName: string;
  administratorEmail: string;
  seats: number;
  visibilityMode: 'board_scope' | 'escalation_only';
  escalationBoardId?: string;
};

const UNAVAILABLE = 'Co-managed provisioning requires a licensed Pro installation with the tenant workflow worker.';

export async function provisionCoManagedWorkspaceAction(_input: CoManagedProvisioningInput): Promise<
  { operationId: string; enqueued: boolean } | { operationId: string; rejected: true; errorCode: string }
> {
  throw new Error(UNAVAILABLE);
}

export async function retryCoManagedProvisioningAction(_operationId: string): Promise<{ enqueued: boolean }> {
  throw new Error(UNAVAILABLE);
}

export async function resendCoManagedAdministratorInvitationAction(_operationId: string): Promise<
  { enqueued: boolean } | { rejected: true; errorCode: string }
> {
  throw new Error(UNAVAILABLE);
}

export async function cancelCoManagedProvisioningAction(_operationId: string): Promise<{ enqueued: boolean }> {
  throw new Error(UNAVAILABLE);
}
