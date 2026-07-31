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
import {
  actionError,
  permissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';

export type BillingClientsActionError = ActionMessageError | ActionPermissionError;

function billingClientsActionErrorFrom(error: unknown): BillingClientsActionError | null {
  if (error instanceof Error) {
    if (error.message.startsWith('Permission denied')) {
      return permissionError(error.message);
    }
    if (error.message.includes('System-managed default contracts are attribution-only')) {
      return actionError(error.message);
    }
    // LEVERAGE: pattern expected-action-error-matchers — same entry needed in contractWizardActionErrors and clients/clientContractActions
    if (error.message.includes('Mixed-currency contracts for the same client are not supported')) {
      return actionError(error.message);
    }
    if (/client contract.*not found/i.test(error.message) || /assignment.*not found/i.test(error.message)) {
      return actionError('Client contract assignment not found. It may have been updated or deleted. Please refresh and try again.');
    }
  }

  const dbError = error as { code?: string; column?: string };
  if (dbError?.code === '22P02') {
    return actionError('One of the selected client contract values is invalid. Please refresh and try again.');
  }
  if (dbError?.code === '23502') {
    return actionError(`Missing required client contract field${dbError.column ? `: ${dbError.column}` : ''}.`);
  }
  if (dbError?.code === '23503') {
    return actionError('The selected client, contract, or billing record no longer exists. Please refresh and try again.');
  }
  if (dbError?.code === '23505') {
    return actionError('This client contract assignment already exists.');
  }

  return null;
}

async function withBillingClientsActionErrors<T>(work: () => Promise<T>): Promise<T | BillingClientsActionError> {
  try {
    return await work();
  } catch (error) {
    const expected = billingClientsActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
}

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
): Promise<IClient[] | BillingClientsActionError> => {
  return withBillingClientsActionErrors(async () => {
    await requireClientReadPermission(user);
  const { knex } = await createTenantKnex();
  const clients = await getAllClients(knex, tenant, includeInactive);
  return attachClientLogos(clients, tenant);
  });
});

export const getAllClientsPaginatedForBilling = withAuth(async (
  user,
  { tenant },
  params: ClientPaginationParams = {}
): Promise<PaginatedClientsResponse | BillingClientsActionError> => {
  return withBillingClientsActionErrors(async () => {
    await requireClientReadPermission(user);
  const { knex } = await createTenantKnex();
  const response = await getAllClientsPaginated(knex, tenant, params);
  return { ...response, clients: await attachClientLogos(response.clients, tenant) };
  });
});

export const getClientsWithBillingCycleRangePaginatedForBilling = withAuth(async (
  user,
  { tenant },
  params: ClientPaginationParams
): Promise<PaginatedClientsResponse | BillingClientsActionError> => {
  return withBillingClientsActionErrors(async () => {
    await requireClientReadPermission(user);
  const { knex } = await createTenantKnex();
  const response = await getClientsWithBillingCycleRangePaginated(knex, tenant, params);
  return { ...response, clients: await attachClientLogos(response.clients, tenant) };
  });
});

export const getClientByIdForBilling = withAuth(async (
  user,
  { tenant },
  clientId: string
): Promise<IClient | null | BillingClientsActionError> => {
  return withBillingClientsActionErrors(async () => {
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
});

export const getClientContractsForBilling = withAuth(async (
  user,
  { tenant },
  clientId: string
): Promise<IClientContract[] | BillingClientsActionError> => {
  return withBillingClientsActionErrors(async () => {
    await requireClientReadPermission(user);
  const { knex } = await createTenantKnex();
  return getClientContracts(knex, tenant, clientId);
  });
});

export const getClientContractByIdForBilling = withAuth(async (
  user,
  { tenant },
  clientContractId: string
): Promise<IClientContract | null | BillingClientsActionError> => {
  return withBillingClientsActionErrors(async () => {
    await requireClientReadPermission(user);
  const { knex } = await createTenantKnex();
  return getClientContractById(knex, tenant, clientContractId);
  });
});

export const getDetailedClientContractForBilling = withAuth(async (
  user,
  { tenant },
  clientContractId: string
): Promise<any | null | BillingClientsActionError> => {
  return withBillingClientsActionErrors(async () => {
    await requireClientReadPermission(user);
  const { knex } = await createTenantKnex();
  return getDetailedClientContract(knex, tenant, clientContractId);
  });
});

export const getActiveClientContractsByClientIdsForBilling = withAuth(async (
  user,
  { tenant },
  clientIds: string[]
): Promise<IClientContract[] | BillingClientsActionError> => {
  return withBillingClientsActionErrors(async () => {
    await requireClientReadPermission(user);
  const { knex } = await createTenantKnex();
  return getActiveClientContractsByClientIds(knex, tenant, clientIds);
  });
});

export const createClientContractForBilling = withAuth(async (
  user,
  { tenant },
  input: ClientContractAssignmentCreateInput
): Promise<IClientContract | BillingClientsActionError> => {
  return withBillingClientsActionErrors(async () => {
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
});

export const updateClientContractForBilling = withAuth(async (
  user,
  { tenant },
  clientContractId: string,
  updateData: Partial<IClientContract>
): Promise<IClientContract | BillingClientsActionError> => {
  return withBillingClientsActionErrors(async () => {
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
});
