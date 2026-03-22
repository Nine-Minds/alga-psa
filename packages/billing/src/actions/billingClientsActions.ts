'use server';

import { createTenantKnex, withTransaction } from '@alga-psa/db';
import type { Knex } from 'knex';
import type { IClient, IClientContract } from '@alga-psa/types';
import {
  getAllClients,
  getAllClientsPaginated,
  getClientsWithBillingCycleRangePaginated,
  getClientById,
  getActiveClientContractsByClientIds,
  getClientContracts,
  getClientContractById,
  getDetailedClientContract,
  createClientContractAssignment,
  updateClientContractAssignment,
  checkAndReactivateExpiredContract,
  type ClientPaginationParams,
  type ClientContractAssignmentCreateInput,
  type PaginatedClientsResponse,
} from '@alga-psa/shared/billingClients';
import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import type { IUserWithRoles } from '@alga-psa/types';
import { syncRecurringServicePeriodsForContract } from './recurringServicePeriodSync';

async function assertClientContractAssignmentIsAuthorable(
  trx: Knex.Transaction,
  tenant: string,
  clientContractId: string,
): Promise<void> {
  const row = await trx('client_contracts as cc')
    .join('contracts as c', function joinContracts() {
      this.on('cc.contract_id', '=', 'c.contract_id')
        .andOn('cc.tenant', '=', 'c.tenant');
    })
    .where('cc.tenant', tenant)
    .andWhere('cc.client_contract_id', clientContractId)
    .first('c.is_system_managed_default');

  if (row?.is_system_managed_default === true) {
    throw new Error(
      'System-managed default contracts are attribution-only; assignment lifecycle and date edits are disabled.',
    );
  }
}

function requireClientReadPermission(user: IUserWithRoles): void {
  if (!hasPermission(user, 'client', 'read')) {
    throw new Error('Permission denied: Cannot read clients');
  }
}

export const getAllClientsForBilling = withAuth(async (
  user,
  { tenant },
  includeInactive: boolean = true
): Promise<IClient[]> => {
  await requireClientReadPermission(user);
  const { knex } = await createTenantKnex();
  return getAllClients(knex, tenant, includeInactive);
});

export const getAllClientsPaginatedForBilling = withAuth(async (
  user,
  { tenant },
  params: ClientPaginationParams = {}
): Promise<PaginatedClientsResponse> => {
  await requireClientReadPermission(user);
  const { knex } = await createTenantKnex();
  return getAllClientsPaginated(knex, tenant, params);
});

export const getClientsWithBillingCycleRangePaginatedForBilling = withAuth(async (
  user,
  { tenant },
  params: ClientPaginationParams
): Promise<PaginatedClientsResponse> => {
  await requireClientReadPermission(user);
  const { knex } = await createTenantKnex();
  return getClientsWithBillingCycleRangePaginated(knex, tenant, params);
});

export const getClientByIdForBilling = withAuth(async (
  user,
  { tenant },
  clientId: string
): Promise<IClient | null> => {
  await requireClientReadPermission(user);
  const { knex } = await createTenantKnex();
  return getClientById(knex, tenant, clientId);
});

export const getClientContractsForBilling = withAuth(async (
  user,
  { tenant },
  clientId: string
): Promise<IClientContract[]> => {
  await requireClientReadPermission(user);
  const { knex } = await createTenantKnex();
  return getClientContracts(knex, tenant, clientId);
});

export const getClientContractByIdForBilling = withAuth(async (
  user,
  { tenant },
  clientContractId: string
): Promise<IClientContract | null> => {
  await requireClientReadPermission(user);
  const { knex } = await createTenantKnex();
  return getClientContractById(knex, tenant, clientContractId);
});

export const getDetailedClientContractForBilling = withAuth(async (
  user,
  { tenant },
  clientContractId: string
): Promise<any | null> => {
  await requireClientReadPermission(user);
  const { knex } = await createTenantKnex();
  return getDetailedClientContract(knex, tenant, clientContractId);
});

export const getActiveClientContractsByClientIdsForBilling = withAuth(async (
  user,
  { tenant },
  clientIds: string[]
): Promise<IClientContract[]> => {
  await requireClientReadPermission(user);
  const { knex } = await createTenantKnex();
  return getActiveClientContractsByClientIds(knex, tenant, clientIds);
});

export const createClientContractForBilling = withAuth(async (
  user,
  { tenant },
  input: ClientContractAssignmentCreateInput
): Promise<IClientContract> => {
  const { knex } = await createTenantKnex();

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    const contract = await trx('contracts')
      .where({ tenant, contract_id: input.contract_id })
      .first('is_system_managed_default');
    if (contract?.is_system_managed_default === true) {
      throw new Error(
        'System-managed default contracts are attribution-only; manual assignment authoring is disabled.',
      );
    }

    const created = await createClientContractAssignment(trx, tenant, input);
    if (created.is_active) {
      await syncRecurringServicePeriodsForContract(trx, {
        tenant,
        contractId: created.contract_id,
        sourceRunPrefix: 'client_contract_assignment_create',
      });
    }
    return created;
  });
});

export const updateClientContractForBilling = withAuth(async (
  user,
  { tenant },
  clientContractId: string,
  updateData: Partial<IClientContract>
): Promise<IClientContract> => {
  const { knex } = await createTenantKnex();

  const updated = await withTransaction(knex, async (trx: Knex.Transaction) => {
    await assertClientContractAssignmentIsAuthorable(trx, tenant, clientContractId);
    const updatedAssignment = await updateClientContractAssignment(trx, tenant, clientContractId, updateData);
    await syncRecurringServicePeriodsForContract(trx, {
      tenant,
      contractId: updatedAssignment.contract_id,
      sourceRunPrefix: 'client_contract_assignment_update',
    });
    return updatedAssignment;
  });

  await checkAndReactivateExpiredContract(knex, tenant, updated.contract_id);
  return updated;
});
