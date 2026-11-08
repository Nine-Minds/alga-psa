'use server';

import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';
import type { Knex } from 'knex';
import type { IClient, IClientContract } from '@alga-psa/types';
import {
  getAllClientsPaginated,
  getClientsWithBillingCycleRangePaginated,
  getClientById,
  getActiveClientContractsByClientIds,
  getClientContracts,
  getClientContractById,
  getDetailedClientContract,
  createClientContractAssignment,
  updateClientContractAssignment,
  activateClientContractAssignment,
  ContractAlreadyActiveScheduledError,
  checkAndReactivateExpiredContract,
  type ClientPaginationParams,
  type ClientContractAssignmentCreateInput,
  type PaginatedClientsResponse,
} from '@alga-psa/shared/billingClients';
import { withAuth } from '@alga-psa/auth';
import { withSerializableAuth } from './serializableAuth';
import { hasPermission } from '@alga-psa/auth/rbac';
import type { IUserWithRoles } from '@alga-psa/types';
import { getClientLogoUrl, getClientLogoUrlsBatch } from '@alga-psa/formatting/avatarUtils';
import { publishWorkflowEvent } from '@alga-psa/event-bus/publishers';
import { buildContractCreatedPayload } from '@alga-psa/workflow-streams';
import { syncRecurringServicePeriodsForContract } from './recurringServicePeriodSync';
import { syncPrepaidBlockIssuancesForContract } from '../services/prepaidBlockIssuanceSync';
import {
  actionError,
  permissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';

export type BillingClientsActionError = ActionMessageError | ActionPermissionError;

function billingClientsActionErrorFrom(error: unknown): BillingClientsActionError | null {
  if (error instanceof ContractAlreadyActiveScheduledError) {
    return actionError(
      error.message,
      'msp/billing:errors.clientContract.alreadyActiveScheduled',
      { startDate: error.startDate },
    );
  }
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
      return actionError('Client contract assignment not found. It may have been updated or deleted. Please refresh and try again.', 'msp/billing:errors.clientContract.notFound');
    }
  }

  const dbError = error as { code?: string; column?: string };
  if (dbError?.code === '22P02') {
    return actionError('One of the selected client contract values is invalid. Please refresh and try again.', 'msp/billing:errors.clientContract.invalidValue');
  }
  if (dbError?.code === '23502') {
    return dbError.column
      ? actionError(
          `Missing required client contract field: ${dbError.column}.`,
          'msp/billing:errors.clientContract.missingFieldNamed',
          { field: dbError.column },
        )
      : actionError('Missing required client contract field.', 'msp/billing:errors.clientContract.missingField');
  }
  if (dbError?.code === '23503') {
    return actionError('The selected client, contract, or billing record no longer exists. Please refresh and try again.', 'msp/billing:errors.clientContract.referenceMissing');
  }
  if (dbError?.code === '23505') {
    return actionError('This client contract assignment already exists.', 'msp/billing:errors.clientContract.duplicate');
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

/** Same by-id read for the draft adjustment loader, with auth rejection kept serializable. */
export const getClientByIdForBillingRecoverable = withSerializableAuth(getClientByIdForBilling);

export interface ContractAssignmentReportRow {
  client_contract_id: string;
  client_id: string;
  client_name: string | null;
  client_logo_url: string | null;
  contract_id: string;
  contract_name: string;
  start_date: string;
  end_date: string | null;
  is_active: boolean;
  contract_line_count: number;
}

/**
 * One query for the Contract Usage report: the active assignments of `contractId` to active
 * clients, with client name, batched logos and the contract's line count. Replaces a
 * per-client N+1 over the whole client list.
 */
export const getContractAssignmentsForReport = withAuth(async (
  user,
  { tenant },
  contractId: string
): Promise<ContractAssignmentReportRow[] | BillingClientsActionError> => {
  return withBillingClientsActionErrors(async () => {
    await requireClientReadPermission(user);
    const { knex } = await createTenantKnex();

    const rows = await withTransaction(knex, async (trx: Knex.Transaction) => {
      const db = tenantDb(trx, tenant);
      const query = db.table('client_contracts as cc')
        .where({ 'cc.contract_id': contractId, 'cc.is_active': true, 'c.is_inactive': false });
      db.tenantJoin(query, 'clients as c', 'cc.client_id', 'c.client_id');
      db.tenantJoin(query, 'contracts as ct', 'cc.contract_id', 'ct.contract_id');
      const assignments = await query
        .select(
          'cc.client_contract_id',
          'cc.client_id',
          'c.client_name',
          'cc.contract_id',
          'ct.contract_name',
          'cc.start_date',
          'cc.end_date',
          'cc.is_active'
        )
        .orderBy('cc.start_date', 'desc');

      const lineCountRow = await db.table('contract_lines')
        .where({ contract_id: contractId })
        .count('contract_line_id as count')
        .first();
      const lineCount = parseInt((lineCountRow?.count as string | undefined) ?? '0', 10);
      return { assignments, lineCount };
    });

    // One row per client (latest assignment first), as the per-client `.find` used to give.
    const seen = new Set<string>();
    const latest = rows.assignments.filter((row: { client_id: string }) => {
      if (seen.has(row.client_id)) return false;
      seen.add(row.client_id);
      return true;
    });
    const logoMap = latest.length > 0
      ? await getClientLogoUrlsBatch(latest.map((r: { client_id: string }) => r.client_id), tenant)
      : new Map<string, string | null>();

    return latest
      .map((row: any): ContractAssignmentReportRow => ({
        client_contract_id: row.client_contract_id,
        client_id: row.client_id,
        client_name: row.client_name ?? null,
        client_logo_url: logoMap.get(row.client_id) ?? null,
        contract_id: row.contract_id,
        contract_name: row.contract_name,
        start_date: row.start_date,
        end_date: row.end_date ?? null,
        is_active: Boolean(row.is_active),
        contract_line_count: rows.lineCount,
      }))
      .sort((a: ContractAssignmentReportRow, b: ContractAssignmentReportRow) =>
        (a.client_name ?? '').localeCompare(b.client_name ?? ''));
  });
});

/**
 * Number of distinct active clients with an active assignment, per contract, in one grouped
 * query. Replaces the N (contracts) x M (clients) loop in the Contract Performance report.
 * Contracts without any active assignment are returned with a count of 0.
 */
export const countActiveClientsByContract = withAuth(async (
  user,
  { tenant },
  contractIds: string[]
): Promise<Array<{ contract_id: string; active_client_count: number }> | BillingClientsActionError> => {
  return withBillingClientsActionErrors(async () => {
    await requireClientReadPermission(user);
    const ids = Array.from(new Set(contractIds ?? []));
    if (ids.length === 0) return [];
    const { knex } = await createTenantKnex();

    const rows = await withTransaction(knex, async (trx: Knex.Transaction) => {
      const db = tenantDb(trx, tenant);
      const query = db.table('client_contracts as cc')
        .whereIn('cc.contract_id', ids)
        .andWhere({ 'cc.is_active': true, 'c.is_inactive': false });
      db.tenantJoin(query, 'clients as c', 'cc.client_id', 'c.client_id');
      return await query
        .select('cc.contract_id')
        .countDistinct('cc.client_id as active_client_count')
        .groupBy('cc.contract_id');
    });

    const counts = new Map<string, number>(
      rows.map((r: any) => [r.contract_id as string, parseInt(String(r.active_client_count), 10)])
    );
    return ids.map((contract_id) => ({ contract_id, active_client_count: counts.get(contract_id) ?? 0 }));
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
      // LEVERAGE: pattern line-obligation-sync — prepaid block issuances follow the same line-obligation changes as recurring service periods
      await syncRecurringServicePeriodsForContract(trx, {
        tenant,
        contractId: created.contract_id,
        sourceRunPrefix: 'client_contract_assignment_create',
      });
      await syncPrepaidBlockIssuancesForContract(trx, tenant, created.contract_id);
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
    // LEVERAGE: pattern line-obligation-sync — prepaid block issuances follow the same line-obligation changes as recurring service periods
    await syncRecurringServicePeriodsForContract(trx, {
      tenant,
      contractId: updatedAssignment.contract_id,
      sourceRunPrefix: 'client_contract_assignment_update',
    });
    await syncPrepaidBlockIssuancesForContract(trx, tenant, updatedAssignment.contract_id);
    return updatedAssignment;
  });

  await checkAndReactivateExpiredContract(knex, tenant, updated.contract_id);
  return updated;
  });
});

export const activateClientContractForBilling = withAuth(async (
  user,
  { tenant },
  clientContractId: string
): Promise<IClientContract | BillingClientsActionError> => {
  return withBillingClientsActionErrors(async () => {
  if (!await hasPermission(user, 'client', 'update')) {
    throw new Error('Permission denied: Cannot update client contract assignments');
  }
  const { knex } = await createTenantKnex();

  const activated = await withTransaction(knex, async (trx: Knex.Transaction) => {
    await assertClientContractAssignmentIsAuthorable(trx, tenant, clientContractId);
    const activatedAssignment = await activateClientContractAssignment(trx, tenant, clientContractId);
    // LEVERAGE: pattern line-obligation-sync — prepaid block issuances follow the same line-obligation changes as recurring service periods
    await syncRecurringServicePeriodsForContract(trx, {
      tenant,
      contractId: activatedAssignment.contract_id,
      sourceRunPrefix: 'client_contract_activate',
    });
    await syncPrepaidBlockIssuancesForContract(trx, tenant, activatedAssignment.contract_id);
    return activatedAssignment;
  });

  // Quote-converted contracts never emitted CONTRACT_CREATED, so activation is their first
  // chance to. The wizard's idempotency key shape dedupes the drafts it already announced.
  const occurredAt = new Date().toISOString();
  await publishWorkflowEvent({
    eventType: 'CONTRACT_CREATED',
    payload: buildContractCreatedPayload({
      contractId: activated.contract_id,
      clientId: activated.client_id,
      createdByUserId: user.user_id,
      createdAt: occurredAt,
      startDate: activated.start_date ?? undefined,
      endDate: activated.end_date ?? null,
      status: 'active',
    }),
    ctx: {
      tenantId: tenant,
      occurredAt,
      actor: user.user_id ? { actorType: 'USER' as const, actorUserId: user.user_id } : undefined,
    },
    idempotencyKey: `contract_created:${activated.contract_id}:${activated.client_id}`,
  });

  return activated;
  });
});
