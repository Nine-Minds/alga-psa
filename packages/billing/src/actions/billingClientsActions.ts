'use server';

import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';
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
import { getClientLogoUrl, getClientLogoUrlsBatch } from '@alga-psa/formatting/avatarUtils';
import { syncRecurringServicePeriodsForContract } from './recurringServicePeriodSync';

function tenantScopedTable(
  conn: Knex | Knex.Transaction,
  tenant: string,
  table: string
): Knex.QueryBuilder {
  return tenantDb(conn, tenant).table(table);
}

async function attachClientLogos(clients: IClient[], tenant: string): Promise<IClient[]> {
  if (clients.length === 0) {
    return clients;
  }
  const clientIds = clients
    .map((client) => client.client_id)
    .filter((clientId): clientId is string => Boolean(clientId));
  const logoUrlsMap = await getClientLogoUrlsBatch(clientIds, tenant);
  return clients.map((client) => ({
    ...client,
    logoUrl: logoUrlsMap.get(client.client_id) ?? null,
  }));
}

async function assertClientContractAssignmentIsAuthorable(
  trx: Knex.Transaction,
  tenant: string,
  clientContractId: string,
): Promise<void> {
  const query = tenantScopedTable(trx, tenant, 'client_contracts as cc');
  tenantDb(trx, tenant).tenantJoin(query, 'contracts as c', 'cc.contract_id', 'c.contract_id');

  const row = await query
    .andWhere('cc.client_contract_id', clientContractId)
    .first('c.is_system_managed_default');

  if (row?.is_system_managed_default === true) {
    throw new Error(
      'System-managed default contracts are attribution-only; assignment lifecycle and date edits are disabled.',
    );
  }
}

async function requireClientReadPermission(user: IUserWithRoles): Promise<void> {
  if (!await hasPermission(user, 'client', 'read')) {
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
  const clients = await getAllClients(knex, tenant, includeInactive);
  return attachClientLogos(clients, tenant);
});

export const getAllClientsPaginatedForBilling = withAuth(async (
  user,
  { tenant },
  params: ClientPaginationParams = {}
): Promise<PaginatedClientsResponse> => {
  await requireClientReadPermission(user);
  const { knex } = await createTenantKnex();
  const response = await getAllClientsPaginated(knex, tenant, params);
  return { ...response, clients: await attachClientLogos(response.clients, tenant) };
});

export const getClientsWithBillingCycleRangePaginatedForBilling = withAuth(async (
  user,
  { tenant },
  params: ClientPaginationParams
): Promise<PaginatedClientsResponse> => {
  await requireClientReadPermission(user);
  const { knex } = await createTenantKnex();
  const response = await getClientsWithBillingCycleRangePaginated(knex, tenant, params);
  return { ...response, clients: await attachClientLogos(response.clients, tenant) };
});

export const getClientByIdForBilling = withAuth(async (
  user,
  { tenant },
  clientId: string
): Promise<IClient | null> => {
  await requireClientReadPermission(user);
  const { knex } = await createTenantKnex();
  const client = await getClientById(knex, tenant, clientId);
  if (!client) {
    return null;
  }
  // Resolve the uploaded logo so the client drawer (e.g. from a contract) shows
  // the real logo, not just initials.
  const logoUrl = await getClientLogoUrl(clientId, tenant);
  return { ...client, logoUrl };
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
  if (!await hasPermission(user, 'client', 'create')) {
    throw new Error('Permission denied: Cannot create client contract assignments');
  }
  const { knex } = await createTenantKnex();

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    const contract = await tenantScopedTable(trx, tenant, 'contracts')
      .where({ contract_id: input.contract_id })
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
  if (!await hasPermission(user, 'client', 'update')) {
    throw new Error('Permission denied: Cannot update client contract assignments');
  }
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
