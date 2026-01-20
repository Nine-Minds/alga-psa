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

import { getCurrentUserAsync, hasPermissionAsync, getSessionAsync } from '../lib/authHelpers';

async function requireClientRead(): Promise<{ tenant: string; knex: Knex }> {
  const currentUser = await getCurrentUserAsync();
  if (!currentUser) {
    throw new Error('No authenticated user found');
  }

  if (!await hasPermissionAsync(currentUser, 'client', 'read')) {
    throw new Error('Permission denied: Cannot read clients');
  }

  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('Tenant not found');
  }
  return { knex, tenant };
}

export async function getAllClientsForBilling(includeInactive: boolean = true): Promise<IClient[]> {
  const { knex, tenant } = await requireClientRead();
  return getAllClients(knex, tenant, includeInactive);
}

export async function getAllClientsPaginatedForBilling(params: ClientPaginationParams = {}): Promise<PaginatedClientsResponse> {
  const { knex, tenant } = await requireClientRead();
  return getAllClientsPaginated(knex, tenant, params);
}

export async function getClientsWithBillingCycleRangePaginatedForBilling(
  params: ClientPaginationParams
): Promise<PaginatedClientsResponse> {
  const { knex, tenant } = await requireClientRead();
  return getClientsWithBillingCycleRangePaginated(knex, tenant, params);
}

export async function getClientByIdForBilling(clientId: string): Promise<IClient | null> {
  const { knex, tenant } = await requireClientRead();
  return getClientById(knex, tenant, clientId);
}

export async function getClientContractsForBilling(clientId: string): Promise<IClientContract[]> {
  const { knex, tenant } = await requireClientRead();
  return getClientContracts(knex, tenant, clientId);
}

export async function getClientContractByIdForBilling(clientContractId: string): Promise<IClientContract | null> {
  const { knex, tenant } = await requireClientRead();
  return getClientContractById(knex, tenant, clientContractId);
}

export async function getDetailedClientContractForBilling(clientContractId: string): Promise<any | null> {
  const { knex, tenant } = await requireClientRead();
  return getDetailedClientContract(knex, tenant, clientContractId);
}

export async function getActiveClientContractsByClientIdsForBilling(clientIds: string[]): Promise<IClientContract[]> {
  const { knex, tenant } = await requireClientRead();
  return getActiveClientContractsByClientIds(knex, tenant, clientIds);
}

export async function createClientContractForBilling(input: ClientContractAssignmentCreateInput): Promise<IClientContract> {
  const session = await getSessionAsync();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('tenant context not found');
  }

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    return createClientContractAssignment(trx, tenant, input);
  });
}

export async function updateClientContractForBilling(
  clientContractId: string,
  updateData: Partial<IClientContract>
): Promise<IClientContract> {
  const session = await getSessionAsync();
  if (!session?.user?.id) {
    throw new Error('Unauthorized');
  }

  const { knex, tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('tenant context not found');
  }

  const updated = await withTransaction(knex, async (trx: Knex.Transaction) => {
    return updateClientContractAssignment(trx, tenant, clientContractId, updateData);
  });

  await checkAndReactivateExpiredContract(knex, tenant, updated.contract_id);
  return updated;
}

