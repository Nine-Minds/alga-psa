'use server';

import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { createTenantKnex } from '@alga-psa/db';
import { prepareCoManagedProvisioningForActor, withCoManagedManagementOperation, retryCoManagedInitialAdministratorInvitation, CoManagedProvisioningError, type CoManagedProvisioningRequest } from '@alga-psa/co-managed';
import { coManagedBrowserActor } from 'server/src/lib/co-managed/browserActor';
import { CoManagedReservationError } from '@alga-psa/licensing';
import { startCoManagedProvisioningWorkflow } from '../co-managed/workflowClient';

export const provisionCoManagedWorkspaceAction = withAuth(async (user, { tenant },
  input: Omit<CoManagedProvisioningRequest, 'sponsorTenant' | 'requestedBy'>,
) => {
  if (user.user_type !== 'internal' || !await hasPermission(user, 'co_management', 'manage') ||
      !await hasPermission(user, 'client', 'read') || !await hasPermission(user, 'ticket', 'read')) throw new Error('Permission denied');
  const actor = await coManagedBrowserActor(user, tenant);
  const { knex } = await createTenantKnex(tenant);
  let operation;
  try {
    operation = await prepareCoManagedProvisioningForActor(knex, actor, { operationId: input.operationId, clientId: input.clientId, workspaceName: input.workspaceName,
      administrator: input.administrator, escalationBoardId: input.escalationBoardId, visibilityMode: input.visibilityMode, seats: input.seats });
  } catch (error) {
    if (error instanceof CoManagedProvisioningError || error instanceof CoManagedReservationError) {
      return { operationId: input.operationId, rejected: true as const, errorCode: error.code };
    }
    throw error;
  }
  if (operation.state === 'cancelled' || operation.state === 'cleanup_requested') {
    throw new Error('This provisioning operation has been cancelled.');
  }
  const scheduled = await startCoManagedProvisioningWorkflow({ sponsorTenant: tenant, operationId: operation.operation_id });
  return { operationId: operation.operation_id, enqueued: scheduled.enqueued };
});

export const retryCoManagedProvisioningAction = withAuth(async (user, { tenant }, operationId: string) => {
  if (user.user_type !== 'internal' || !await hasPermission(user, 'co_management', 'manage')) throw new Error('Permission denied');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(operationId)) throw new Error('Provisioning operation not found.');
  const actor = await coManagedBrowserActor(user, tenant);
  const { knex } = await createTenantKnex(tenant);
  const canonicalOperationId = await withCoManagedManagementOperation(knex, actor, operationId, async (trx, operation) => {
    if (!['queued', 'provisioning', 'failed', 'pending_acceptance'].includes(operation.state)) {
      throw new Error('This provisioning operation cannot be retried.');
    }
    if (operation.state === 'pending_acceptance') {
      await retryCoManagedInitialAdministratorInvitation(trx, actor, operation.operation_id);
    }
    return operation.operation_id;
  });
  // Bootstrap rechecks current capacity under the reservation lock. Invitation
  // delivery can still retry a prepared workspace without granting new access.
  return startCoManagedProvisioningWorkflow({ sponsorTenant: tenant, operationId: canonicalOperationId });
});
