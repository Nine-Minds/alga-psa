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
    return createClientContractAssignment(trx, tenant, input);
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
    return updateClientContractAssignment(trx, tenant, clientContractId, updateData);
  });

  await checkAndReactivateExpiredContract(knex, tenant, updated.contract_id);
  return updated;
});

