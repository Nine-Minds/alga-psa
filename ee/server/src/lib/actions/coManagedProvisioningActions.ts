'use server';

import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { requireCapabilityForAction } from '@alga-psa/core/capability/server';
import { createTenantKnex } from '@alga-psa/db';
import { prepareCoManagedProvisioningForActor, withCoManagedManagementOperation, requestCoManagedProvisioningCleanup, retryCoManagedInitialAdministratorInvitation, CoManagedProvisioningError } from '@alga-psa/co-managed';
import { coManagedBrowserActor } from 'server/src/lib/co-managed/browserActor';
import { admitCoManagedSponsor } from 'server/src/lib/co-managed/admitSponsor';
import { CoManagedReservationError } from '@alga-psa/licensing';
import { startCoManagedProvisioningWorkflow, startCoManagedProvisioningCleanupWorkflow } from '../co-managed/workflowClient';

export interface ProvisionCoManagedWorkspaceInput {
  clientId: string;
  workspaceName: string;
  administratorName: string;
  administratorEmail: string;
  seats: number;
  visibilityMode: 'board_scope' | 'escalation_only';
  escalationBoardId?: string;
  operationId: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** "Ada Lovelace King" -> first "Ada", last "Lovelace King". A single token is not a name. */
function splitAdministratorName(name: unknown): { firstName: string; lastName: string } | null {
  const parts = typeof name === 'string' ? name.trim().split(/\s+/).filter(Boolean) : [];
  return parts.length >= 2 ? { firstName: parts[0], lastName: parts.slice(1).join(' ') } : null;
}

export const provisionCoManagedWorkspaceAction = withAuth(async (user, { tenant }, input: ProvisionCoManagedWorkspaceInput) => {
  await requireCapabilityForAction('co-managed', tenant, 'admits');
  if (user.user_type === 'internal') await admitCoManagedSponsor(tenant);
  if (user.user_type !== 'internal' || !await hasPermission(user, 'co_management', 'manage') ||
      !await hasPermission(user, 'client', 'read') || !await hasPermission(user, 'ticket', 'read')) throw new Error('Permission denied');
  const administrator = splitAdministratorName(input?.administratorName);
  if (!administrator || typeof input.administratorEmail !== 'string' || !input.escalationBoardId) {
    return { operationId: input?.operationId, rejected: true as const, errorCode: 'INVALID_REQUEST' as const };
  }
  const actor = await coManagedBrowserActor(user, tenant);
  const { knex } = await createTenantKnex(tenant);
  let operation;
  try {
    operation = await prepareCoManagedProvisioningForActor(knex, actor, { operationId: input.operationId, clientId: input.clientId,
      workspaceName: input.workspaceName, administrator: { ...administrator, email: input.administratorEmail },
      escalationBoardId: input.escalationBoardId, visibilityMode: input.visibilityMode, seats: input.seats });
  } catch (error) {
    if (error instanceof CoManagedProvisioningError || error instanceof CoManagedReservationError) {
      return { operationId: input.operationId, rejected: true as const, errorCode: error.code };
    }
    throw error;
  }
  if (operation.state === 'cancelled' || operation.state === 'cleanup_requested') {
    // The same operation ID was cancelled; the form explains it and can start over.
    return { operationId: input.operationId, rejected: true as const, errorCode: 'SETUP_CANCELLING' as const };
  }
  const scheduled = await startCoManagedProvisioningWorkflow({ sponsorTenant: tenant, operationId: operation.operation_id });
  return { operationId: operation.operation_id, enqueued: scheduled.enqueued };
});

export const retryCoManagedProvisioningAction = withAuth(async (user, { tenant }, operationId: string) => {
  await requireCapabilityForAction('co-managed', tenant, 'admits');
  if (user.user_type !== 'internal' || !await hasPermission(user, 'co_management', 'manage')) throw new Error('Permission denied');
  if (!UUID.test(operationId)) throw new Error('Provisioning operation not found.');
  const actor = await coManagedBrowserActor(user, tenant);
  const { knex } = await createTenantKnex(tenant);
  const admitted = await withCoManagedManagementOperation(knex, actor, operationId, async (trx, operation) => {
    if (!['queued', 'provisioning', 'failed', 'pending_acceptance', 'cleanup_requested'].includes(operation.state)) {
      throw new Error('This provisioning operation cannot be retried.');
    }
    if (operation.state === 'pending_acceptance') {
      await retryCoManagedInitialAdministratorInvitation(trx, actor, operation.operation_id);
    }
    return { operationId: operation.operation_id, cleanup: operation.state === 'cleanup_requested' };
  });
  // Bootstrap rechecks current capacity under the reservation lock. Invitation
  // delivery can still retry a prepared workspace without granting new access.
  return (admitted.cleanup ? startCoManagedProvisioningCleanupWorkflow : startCoManagedProvisioningWorkflow)({ sponsorTenant: tenant, operationId: admitted.operationId });
});

/** Re-send an already delivered invitation. Limited to one resend per workspace;
 * the limit is enforced under the invitation locks, not here. */
export const resendCoManagedAdministratorInvitationAction = withAuth(async (user, { tenant }, operationId: string) => {
  await requireCapabilityForAction('co-managed', tenant, 'admits');
  if (user.user_type !== 'internal' || !await hasPermission(user, 'co_management', 'manage')) throw new Error('Permission denied');
  if (!UUID.test(operationId)) throw new Error('Provisioning operation not found.');
  const actor = await coManagedBrowserActor(user, tenant);
  const { knex } = await createTenantKnex(tenant);
  try {
    await withCoManagedManagementOperation(knex, actor, operationId, async (trx, operation) => {
      if (operation.state !== 'pending_acceptance') throw new Error('This provisioning operation cannot be retried.');
      await retryCoManagedInitialAdministratorInvitation(trx, actor, operation.operation_id);
    });
  } catch (error) {
    if (error instanceof CoManagedProvisioningError && error.code === 'RESEND_LIMIT_REACHED') {
      return { rejected: true as const, errorCode: error.code };
    }
    throw error;
  }
  return startCoManagedProvisioningWorkflow({ sponsorTenant: tenant, operationId });
});

export const cancelCoManagedProvisioningAction = withAuth(async (user, { tenant }, operationId: string) => {
  await requireCapabilityForAction('co-managed', tenant, 'admits');
  if (user.user_type !== 'internal' || !await hasPermission(user, 'co_management', 'manage')) throw new Error('Permission denied');
  const actor = await coManagedBrowserActor(user, tenant);
  const { knex } = await createTenantKnex(tenant);
  const operation = await withCoManagedManagementOperation(knex, actor, operationId, async (trx, retained) => {
    await requestCoManagedProvisioningCleanup(trx, tenant, retained.operation_id);
    return { operationId: retained.operation_id, cancelled: retained.state === 'cancelled' };
  });
  if (operation.cancelled) return { enqueued: true };
  return startCoManagedProvisioningCleanupWorkflow({ sponsorTenant: tenant, operationId: operation.operationId });
});
