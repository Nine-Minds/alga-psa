'use server';

import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { prepareCoManagedProvisioning, CoManagedProvisioningError, type CoManagedProvisioningRequest } from '@alga-psa/co-managed';
import { CoManagedReservationError } from '@alga-psa/licensing';
import { startCoManagedProvisioningWorkflow } from '../co-managed/workflowClient';

export const provisionCoManagedWorkspaceAction = withAuth(async (user, { tenant },
  input: Omit<CoManagedProvisioningRequest, 'sponsorTenant' | 'requestedBy'>,
) => {
  if (user.user_type !== 'internal' || !await hasPermission(user, 'co_management', 'manage') ||
      !await hasPermission(user, 'client', 'read') || !await hasPermission(user, 'ticket', 'read')) throw new Error('Permission denied');
  const { knex } = await createTenantKnex(tenant);
  let operation;
  try {
    operation = await prepareCoManagedProvisioning(knex, { ...input, sponsorTenant: tenant, requestedBy: user.user_id });
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
  const { knex } = await createTenantKnex(tenant);
  const sponsor = tenantDb(knex, tenant);
  const owner = await sponsor.table('tenants').first('product_code');
  if (owner?.product_code !== 'psa') throw new Error('Only PSA workspaces can sponsor co-managed IT.');
  const operation = await sponsor.table('co_managed_provisioning_operations').where('operation_id', operationId).first();
  if (!operation || !['queued', 'provisioning', 'failed', 'pending_acceptance'].includes(operation.state)) {
    throw new Error('This provisioning operation cannot be retried.');
  }
  // Bootstrap rechecks current capacity under the reservation lock. Invitation
  // delivery can still retry a prepared workspace without granting new access.
  return startCoManagedProvisioningWorkflow({ sponsorTenant: tenant, operationId });
});
