// @alga-psa/billing/actions.ts
'use server'

import Contract from '@alga-psa/billing/models/contract';
import ContractTemplateModel from '../models/contractTemplate';
import {
  IContract,
  IContractAssignmentSummary,
  IContractWithClient,
  IContractLineMapping,
} from '@alga-psa/types';
import {
  IContractTemplate,
  IContractTemplateWithLines,
} from '@alga-psa/types';
import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { deriveClientContractStatus } from '@alga-psa/shared/billingClients';
import { publishWorkflowEvent } from '@alga-psa/event-bus/publishers';
import { getClientLogoUrlsBatch } from '@alga-psa/formatting/avatarUtils';

import { Knex } from 'knex';
import { withAuth } from '@alga-psa/auth/withAuth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { actionError, permissionError } from '@alga-psa/ui/lib/errorHandling';
import type { ActionMessageError, ActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import {
  addContractLine as repoAddContractLine,
  fetchContractLineMappings,
  fetchDetailedContractLines,
  isContractLineAttached as repoIsContractLineAttached,
  removeContractLine as repoRemoveContractLine,
  updateContractLine as repoUpdateContractLine,
  updateContractLineRate as repoUpdateContractLineRate,
  DetailedContractLine,
} from '../repositories/contractLineRepository';
import { syncRecurringServicePeriodsForContractLine } from './recurringServicePeriodSync';

type TenantScopedKnex = Knex | Knex.Transaction;
type ContractActionError = ActionMessageError | ActionPermissionError;

class ContractActionDomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContractActionDomainError';
  }
}

function contractActionErrorFrom(error: unknown): ContractActionError | null {
  if (error instanceof ContractActionDomainError) {
    if (error.message.startsWith('Permission denied:')) {
      return permissionError(error.message);
    }
    return actionError(error.message);
  }

  if (error instanceof Error && error.message.startsWith('Permission denied:')) {
    return permissionError(error.message);
  }

  if (error instanceof Error) {
    if (error.message.startsWith('Base contract line') && error.message.includes('not found')) {
      return actionError('The selected contract line is no longer available. Please refresh and try again.');
    }
    if (error.message.startsWith('Template contract line') && error.message.includes('not found')) {
      return actionError('The selected template line is no longer available. Please refresh and try again.');
    }
  }

  const dbError = error as { code?: string; column?: string; constraint?: string };
  if (dbError?.code === '22P02') {
    return actionError('One of the selected contract values is invalid. Please refresh and try again.');
  }
  if (dbError?.code === '23502') {
    return actionError(`Missing required contract field${dbError.column ? `: ${dbError.column}` : ''}.`);
  }
  if (dbError?.code === '23503') {
    return actionError('The selected contract, client, or related record no longer exists. Please refresh and try again.');
  }
  if (dbError?.code === '23505') {
    return actionError('This contract change conflicts with an existing record. Please refresh and try again.');
  }
  if (dbError?.code === '23514') {
    return actionError('One of the contract values is not allowed. Please review the form and try again.');
  }

  return null;
}

const isBypassEnabled = (): boolean => process.env.E2E_AUTH_BYPASS === 'true';

function tenantScopedTable(
  conn: TenantScopedKnex,
  tenant: string,
  table: string,
): Knex.QueryBuilder {
  return tenantDb(conn, tenant).table(table);
}

function maybeUserActor(user: any) {
  const userId = user?.user_id;
  if (typeof userId !== 'string' || userId.length === 0) return undefined;
  return { actorType: 'USER' as const, actorUserId: userId };
}

const assertBillingPermission = async (
  user: unknown,
  action: 'read' | 'create' | 'update' | 'delete',
  context: string,
): Promise<void> => {
  if (isBypassEnabled()) {
    return;
  }

  if (!await hasPermission(user as any, 'billing', action)) {
    throw new ContractActionDomainError(`Permission denied: Cannot ${context}`);
  }
};

const assertNoSystemManagedIdentityMutation = (
  payload: Record<string, unknown>,
  operation: 'create' | 'update',
): void => {
  const protectedFields: Array<'is_system_managed_default' | 'owner_client_id'> = operation === 'create'
    ? ['is_system_managed_default']
    : ['is_system_managed_default', 'owner_client_id'];
  const attemptedFields = protectedFields.filter(
    (field) => Object.prototype.hasOwnProperty.call(payload, field) && payload[field] !== undefined,
  );

  if (attemptedFields.length > 0) {
    throw new ContractActionDomainError(
      `Permission denied: ${operation} cannot mutate system-managed contract identity fields (${attemptedFields.join(', ')})`,
    );
  }
};



const mapTemplateToContract = (template: IContractTemplate): IContract => ({
  tenant: template.tenant,
  contract_id: template.template_id,
  contract_name: template.template_name,
  contract_description: template.template_description ?? undefined,
  billing_frequency: template.default_billing_frequency,
  // currency_code removed from templates - templates are now currency-neutral
  // When converting to contract, we use USD as default. Actual contract currency
  // is set from client's default_currency_code when creating a real contract.
  currency_code: 'USD',
  is_active: template.template_status === 'published',
  status: template.template_status,
  is_template: true,
  template_metadata: template.template_metadata ?? undefined,
  created_at: template.created_at,
  updated_at: template.updated_at,
});

async function attachContractClientLogos(
  rows: IContractWithClient[],
  tenant: string,
): Promise<IContractWithClient[]> {
  const clientIds = Array.from(
    new Set(
      rows
        .map((row) => row.client_id)
        .filter((clientId): clientId is string => Boolean(clientId)),
    ),
  );
  if (clientIds.length === 0) {
    return rows;
  }
  const logoUrlsMap = await getClientLogoUrlsBatch(clientIds, tenant);
  return rows.map((row) => ({
    ...row,
    logoUrl: row.client_id ? logoUrlsMap.get(row.client_id) ?? null : null,
  }));
}

async function isTemplateContract(knex: TenantScopedKnex, tenant: string, contractId: string): Promise<boolean> {
  const template = await tenantScopedTable(knex, tenant, 'contract_templates')
    .where({ template_id: contractId })
    .first();
  return Boolean(template);
}

export const getContracts = withAuth(async (user, { tenant }): Promise<IContract[] | ContractActionError> => {
  try {
    await assertBillingPermission(user, 'read', 'view billing contracts');
    const { knex } = await createTenantKnex();

    return await Contract.getAll(knex, tenant);
  } catch (error) {
    console.error('Error fetching contracts:', error);
    const expected = contractActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    throw error;
  }
});

export const getContractTemplates = withAuth(async (user, { tenant }): Promise<IContract[] | ContractActionError> => {
  try {
    await assertBillingPermission(user, 'read', 'view billing contracts');
    const { knex } = await createTenantKnex();

    const templates = await ContractTemplateModel.getAll(tenant);
    return templates.map(mapTemplateToContract);
  } catch (error) {
    console.error('Error fetching contract templates:', error);
    const expected = contractActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    throw error;
  }
});

export const getContractsWithClients = withAuth(async (user, { tenant }): Promise<IContractWithClient[] | ContractActionError> => {
  try {
    await assertBillingPermission(user, 'read', 'view billing contracts');
    const { knex } = await createTenantKnex();

    const rows = await Contract.getAllWithClients(knex, tenant);
    return await attachContractClientLogos(rows, tenant);
  } catch (error) {
    console.error('Error fetching contracts with clients:', error);
    const expected = contractActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    throw error;
  }
});

export const getDraftContracts = withAuth(async (user, { tenant }): Promise<IContractWithClient[] | ContractActionError> => {
  try {
    await assertBillingPermission(user, 'read', 'view billing contracts');
    const { knex } = await createTenantKnex();

    const facade = tenantDb(knex, tenant);
    const query = facade.table('contracts as co');
    facade.tenantJoin(query, 'client_contracts as cc', 'co.contract_id', 'cc.contract_id', { type: 'left' });
    facade.tenantJoin(query, 'contract_templates as template', 'cc.template_contract_id', 'template.template_id', { type: 'left' });
    facade.tenantJoin(query, 'clients as c', 'cc.client_id', 'c.client_id', { type: 'left' });

    const rows = await query
      .andWhere((builder) => builder.whereNull('co.is_template').orWhere('co.is_template', false))
      .andWhere('co.status', 'draft')
      .select(
        'co.*',
        'cc.client_contract_id',
        'cc.template_contract_id',
        'c.client_id',
        'c.client_name',
        'cc.start_date',
        'cc.end_date',
        'template.template_name as template_contract_name'
      )
      .orderBy('co.updated_at', 'desc');

    return await attachContractClientLogos(rows as unknown as IContractWithClient[], tenant);
  } catch (error) {
    console.error('Error fetching draft contracts:', error);
    const expected = contractActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    throw error;
  }
});

export const getContractById = withAuth(async (user, { tenant }, contractId: string): Promise<IContract | ContractActionError | null> => {
  try {
    await assertBillingPermission(user, 'read', 'view billing contracts');
    const { knex } = await createTenantKnex();

    const contract = await Contract.getById(knex, tenant, contractId);
    if (contract) {
      return { ...contract, is_template: false };
    }

    const template = await ContractTemplateModel.getById(contractId, tenant);
    if (template) {
      return mapTemplateToContract(template);
    }

    return null;
  } catch (error) {
    console.error(`Error fetching contract ${contractId}:`, error);
    const expected = contractActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    throw error;
  }
});

export const getContractLineMappings = withAuth(async (user, { tenant }, contractId: string): Promise<IContractLineMapping[] | ContractActionError> => {
  try {
    await assertBillingPermission(user, 'read', 'view contract line mappings');
    const { knex } = await createTenantKnex();
    return fetchContractLineMappings(knex, tenant, contractId);
  } catch (error) {
    console.error(`Error fetching contract line mappings for contract ${contractId}:`, error);
    const expected = contractActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    throw error;
  }
});

export const getDetailedContractLines = withAuth(async (user, { tenant }, contractId: string): Promise<DetailedContractLine[] | ContractActionError> => {
  try {
    await assertBillingPermission(user, 'read', 'view detailed contract lines');
    const { knex } = await createTenantKnex();
    return fetchDetailedContractLines(knex, tenant, contractId);
  } catch (error) {
    console.error(`Error fetching detailed contract lines for contract ${contractId}:`, error);
    const expected = contractActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    throw error;
  }
});

export const addContractLine = withAuth(async (
  user,
  { tenant },
  contractId: string,
  contractLineId: string,
  customRate?: number
): Promise<IContractLineMapping | ContractActionError> => {
  try {
    const { knex } = await createTenantKnex();

    const canUpdate = await hasPermission(user, 'billing', 'create');
    if (!canUpdate) {
      return permissionError('Permission denied: Cannot modify contract lines');
    }

    return knex.transaction((trx: Knex.Transaction) =>
      repoAddContractLine(trx, tenant, contractId, contractLineId, customRate).then(async (mapping) => {
        await syncRecurringServicePeriodsForContractLine(trx, {
          tenant,
          contractLineId: mapping.contract_line_id,
          sourceRunPrefix: 'contract_add_line',
        });
        return mapping;
      })
    );
  } catch (error) {
    console.error(`Error adding contract line ${contractLineId} to contract ${contractId}:`, error);
    const expected = contractActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    throw error;
  }
});

export const removeContractLine = withAuth(async (user, { tenant }, contractId: string, contractLineId: string): Promise<void | ContractActionError> => {
  try {
    const { knex } = await createTenantKnex();

    const canUpdate = await hasPermission(user, 'billing', 'update');
    if (!canUpdate) {
      return permissionError('Permission denied: Cannot modify contract lines');
    }

    await repoRemoveContractLine(knex, tenant, contractId, contractLineId);
  } catch (error) {
    console.error(`Error removing contract line ${contractLineId} from contract ${contractId}:`, error);
    const expected = contractActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    throw error;
  }
});

export const updateContractLineAssociation = withAuth(async (
  user,
  { tenant },
  contractId: string,
  contractLineId: string,
  updateData: Partial<IContractLineMapping>
): Promise<IContractLineMapping | ContractActionError> => {
  try {
    const { knex } = await createTenantKnex();

    const canUpdate = await hasPermission(user, 'billing', 'update');
    if (!canUpdate) {
      return permissionError('Permission denied: Cannot modify contract lines');
    }

    const updated = await repoUpdateContractLine(knex, tenant, contractId, contractLineId, updateData);
    await knex.transaction(async (trx) => {
      await syncRecurringServicePeriodsForContractLine(trx, {
        tenant,
        contractLineId,
        sourceRunPrefix: 'contract_line_association_update',
      });
    });
    return updated;
  } catch (error) {
    console.error(`Error updating contract line ${contractLineId} for contract ${contractId}:`, error);
    const expected = contractActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    throw error;
  }
});

export const updateContractLineRate = withAuth(async (
  user,
  { tenant },
  contractId: string,
  contractLineId: string,
  rate: number,
  billingTiming?: 'arrears' | 'advance'
): Promise<void | ContractActionError> => {
  try {
    const { knex } = await createTenantKnex();

    const canUpdate = await hasPermission(user, 'billing', 'update');
    if (!canUpdate) {
      return permissionError('Permission denied: Cannot modify contract lines');
    }

    await knex.transaction(async (trx) => {
      await repoUpdateContractLineRate(trx, tenant, contractId, contractLineId, rate, billingTiming);
      await syncRecurringServicePeriodsForContractLine(trx, {
        tenant,
        contractLineId,
        sourceRunPrefix: 'contract_line_rate_update',
      });
    });
  } catch (error) {
    console.error(`Error updating contract line ${contractLineId} rate for contract ${contractId}:`, error);
    const expected = contractActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    throw error;
  }
});

export const isContractLineAttached = withAuth(async (user, { tenant }, contractId: string, contractLineId: string): Promise<boolean | ContractActionError> => {
  try {
    await assertBillingPermission(user, 'read', 'check contract line associations');
    const { knex } = await createTenantKnex();

    return repoIsContractLineAttached(knex, tenant, contractId, contractLineId);
  } catch (error) {
    console.error(`Error checking contract line ${contractLineId} association for contract ${contractId}:`, error);
    const expected = contractActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    throw error;
  }
});

export const createContract = withAuth(async (
  user,
  { tenant },
  contractData: Omit<IContract, 'contract_id' | 'tenant' | 'created_at' | 'updated_at'>
): Promise<IContract | ContractActionError> => {
  const { knex } = await createTenantKnex();

  try {
    await assertBillingPermission(user, 'create', 'create billing contracts');
    assertNoSystemManagedIdentityMutation(contractData as Record<string, unknown>, 'create');
    const {
      tenant: _ignoredTenant,
      is_system_managed_default: _ignoredSystemManagedMarker,
      ...safeContractData
    } = contractData as any;
    const created = await Contract.create(knex, tenant, safeContractData);
    const occurredAt = created.created_at ?? new Date().toISOString();
    await publishWorkflowEvent({
      eventType: 'CONTRACT_CREATED',
      payload: {
        contractId: created.contract_id,
        userId: user.user_id,
        status: created.status,
        timestamp: occurredAt,
      },
      ctx: {
        tenantId: tenant,
        occurredAt,
        actor: maybeUserActor(user),
      },
      idempotencyKey: `contract_created:${created.contract_id}:${occurredAt}`,
    });
    return created;
  } catch (error) {
    console.error('Error creating contract:', error);
    const expected = contractActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    throw error;
  }
});

export const updateContract = withAuth(async (
  user,
  { tenant },
  contractId: string,
  updateData: Partial<IContract>
): Promise<IContract | ContractActionError> => {
  const { knex } = await createTenantKnex();

  try {
    await assertBillingPermission(user, 'update', 'update billing contracts');
    assertNoSystemManagedIdentityMutation(updateData as Record<string, unknown>, 'update');

    // Attempt to load standard contract first; fall back to template
    const currentContract = await Contract.getById(knex, tenant, contractId);
    if (!currentContract) {
      const template = await ContractTemplateModel.getById(contractId, tenant);
      if (!template) {
        throw new ContractActionDomainError(`Contract ${contractId} not found`);
      }

      const templateUpdates: Partial<IContractTemplate> = {};

      if (typeof updateData.contract_name === 'string') {
        templateUpdates.template_name = updateData.contract_name;
      }
      if (updateData.contract_description !== undefined) {
        templateUpdates.template_description = updateData.contract_description ?? null;
      }
      if (typeof updateData.billing_frequency === 'string') {
        templateUpdates.default_billing_frequency = updateData.billing_frequency;
      }
      // currency_code removed from templates - templates are now currency-neutral
      // Currency is inherited from the client when a contract is created
      if (updateData.status && ['draft', 'published', 'archived'].includes(updateData.status)) {
        templateUpdates.template_status = updateData.status as IContractTemplate['template_status'];
      }
      if (updateData.template_metadata !== undefined) {
        templateUpdates.template_metadata = updateData.template_metadata ?? null;
      }

      if (Object.keys(templateUpdates).length === 0) {
        return mapTemplateToContract(template);
      }

      const updatedTemplate = await ContractTemplateModel.update(contractId, templateUpdates, tenant);
      return mapTemplateToContract(updatedTemplate);
    }

    if (currentContract.is_system_managed_default === true) {
      throw new ContractActionDomainError(
        'System-managed default contracts are attribution-only; contract authoring and lifecycle edits are disabled.',
      );
    }

    // Special handling for expired contracts
    if (currentContract.status === 'expired') {
      // If trying to manually change status of an expired contract (not through end date logic)
      if (updateData.status && updateData.status !== 'expired') {
        throw new ContractActionDomainError('Cannot manually change the status of an expired contract. To reactivate, extend the contract end date.');
      }

      // Check if end dates are being updated on client contracts
      // We'll check this after the client contract updates below
      // For now, remove the status from updateData if it's expired (we'll handle it automatically)
      if (updateData.status === 'expired') {
        delete updateData.status; // Don't update status, we'll determine it based on end dates
      }
    } else {
      // Prevent manual setting of expired status on non-expired contracts
      if (updateData.status === 'expired') {
        throw new ContractActionDomainError('Cannot manually set contract to expired. Contracts are automatically expired when their end date passes.');
      }
    }

    // If trying to set contract to draft, check if it has invoices
    if (updateData.status === 'draft') {
      const hasInvoices = await Contract.hasInvoices(knex, tenant, contractId);
      if (hasInvoices) {
        throw new ContractActionDomainError('Cannot set contract to draft because it has associated invoices. Contracts with invoices cannot be set to draft.');
      }
    }

    const {
      tenant: _ignoredTenant,
      is_system_managed_default: _ignoredSystemManagedMarker,
      owner_client_id: _ignoredOwnerClientId,
      ...safeUpdateData
    } = updateData as any;
    const updated = await Contract.update(knex, tenant, contractId, safeUpdateData);
    const occurredAt = updated.updated_at ?? new Date().toISOString();
    await publishWorkflowEvent({
      eventType: 'CONTRACT_UPDATED',
      payload: {
        contractId,
        userId: user.user_id,
        status: updated.status,
        changes: safeUpdateData,
        timestamp: occurredAt,
      },
      ctx: {
        tenantId: tenant,
        occurredAt,
        actor: maybeUserActor(user),
      },
      idempotencyKey: `contract_updated:${contractId}:${occurredAt}`,
    });

    // After updating, check if an expired contract should be reactivated based on end dates
    if (currentContract.status === 'expired') {
      await Contract.checkAndReactivateExpiredContract(knex, tenant, contractId);
      // Re-fetch the contract to get the potentially updated status
      const reactivatedContract = await Contract.getById(knex, tenant, contractId);
      return reactivatedContract!;
    }

    return updated;
  } catch (error) {
    console.error('Error updating contract:', error);
    const expected = contractActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    throw error;
  }
});

export const checkContractHasInvoices = withAuth(async (user, { tenant }, contractId: string): Promise<boolean> => {
  const { knex } = await createTenantKnex();

  return await Contract.hasInvoices(knex, tenant, contractId);
});

export const deleteContract = withAuth(async (user, { tenant }, contractId: string): Promise<void | ContractActionError> => {
  const { knex } = await createTenantKnex();

  try {
    const isBypass = process.env.E2E_AUTH_BYPASS === 'true';
    if (!isBypass) {
      const canDeleteBilling = await hasPermission(user, 'billing', 'delete');
      if (!canDeleteBilling) {
        return permissionError('Permission denied: Cannot delete billing contracts');
      }
    }

    const templateExists = await isTemplateContract(knex, tenant, contractId);
    if (templateExists) {
      await ContractTemplateModel.delete(contractId, tenant);
      return;
    }

    const currentContract = await Contract.getById(knex, tenant, contractId);
    if (currentContract?.is_system_managed_default === true) {
      throw new ContractActionDomainError('System-managed default contracts cannot be deleted manually');
    }

    const clientContracts = await tenantScopedTable(knex, tenant, 'client_contracts')
      .where({ contract_id: contractId })
      .select('client_contract_id', 'client_id');

    await Contract.delete(knex, tenant, contractId);
    const occurredAt = new Date().toISOString();

    for (const clientContract of clientContracts) {
      await publishWorkflowEvent({
        eventType: 'CLIENT_CONTRACT_DELETED',
        payload: {
          clientContractId: clientContract.client_contract_id,
          contractId,
          clientId: clientContract.client_id,
          userId: user.user_id,
          timestamp: occurredAt,
        },
        ctx: {
          tenantId: tenant,
          occurredAt,
          actor: maybeUserActor(user),
        },
        idempotencyKey: `client_contract_deleted:${clientContract.client_contract_id}:${occurredAt}`,
      });
    }

    await publishWorkflowEvent({
      eventType: 'CONTRACT_DELETED',
      payload: {
        contractId,
        userId: user.user_id,
        timestamp: occurredAt,
      },
      ctx: {
        tenantId: tenant,
        occurredAt,
        actor: maybeUserActor(user),
      },
      idempotencyKey: `contract_deleted:${contractId}:${occurredAt}`,
    });
  } catch (error) {
    console.error('Error deleting contract:', error);
    const expected = contractActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    throw error;
  }
});

export const getContractLinesForContract = withAuth(async (user, { tenant }, contractId: string): Promise<any[] | ContractActionError> => {
  try {
    await assertBillingPermission(user, 'read', 'view contract lines');
    const { knex } = await createTenantKnex();

    return await Contract.getContractLines(knex, tenant, contractId);
  } catch (error) {
    console.error(`Error fetching contract lines for contract ${contractId}:`, error);
    const expected = contractActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    throw error;
  }
});

export interface IContractSummary {
  contractLineCount: number;
  totalClientAssignments: number;
  activeClientCount: number;
  poRequiredCount: number;
  poNumbers: string[];
  earliestStartDate: string | null;
  latestEndDate: string | null;
}

export const getContractSummary = withAuth(async (user, { tenant }, contractId: string): Promise<IContractSummary | ContractActionError> => {
  try {
    await assertBillingPermission(user, 'read', 'view contract summary');
    const { knex } = await createTenantKnex();

    const templateRecord = await tenantScopedTable(knex, tenant, 'contract_templates')
      .where({ template_id: contractId })
      .first();

    let lineCountRaw: string | undefined;
    if (templateRecord) {
      const templateLineCount = await tenantScopedTable(knex, tenant, 'contract_template_lines')
        .where({ template_id: contractId })
        .count('* as count')
        .first() as { count: string } | undefined;
      lineCountRaw = templateLineCount?.count;
    } else {
      const result = await tenantScopedTable(knex, tenant, 'contract_lines')
        .where({ contract_id: contractId })
        .count('* as count')
        .first() as { count: string } | undefined;
      lineCountRaw = result?.count;
    }

    const assignmentColumns = [
      'cc.client_contract_id',
      'cc.client_id',
      'cc.is_active',
      'cc.start_date',
      'cc.end_date',
      'cc.po_required',
      'cc.po_number',
      'co.status as contract_status',
    ];

    const assignmentsQuery = tenantDb(knex, tenant).table('client_contracts as cc');
    tenantDb(knex, tenant).tenantJoin(
      assignmentsQuery,
      'contracts as co',
      'cc.contract_id',
      'co.contract_id',
    );
    const assignmentsRaw = await assignmentsQuery
      .where({ 'cc.contract_id': contractId })
      .select(assignmentColumns);

    const assignments = (assignmentsRaw as any[]).map((assignment: any) => ({
      ...assignment,
      po_required: Boolean(assignment.po_required),
    }));

    const totalAssignments = assignments.length;
    const activeAssignments = assignments.filter((assignment) =>
      deriveClientContractStatus({
        isActive: Boolean(assignment.is_active),
        startDate: assignment.start_date,
        endDate: assignment.end_date,
        contractStatus: assignment.contract_status,
      }) === 'active'
    ).length;
    const poRequiredAssignments = assignments.filter((assignment) => assignment.po_required).length;

    const poNumbers = Array.from(
      new Set(
        assignments
          .map((assignment) => assignment.po_number)
          .filter((poNumber): poNumber is string => Boolean(poNumber))
      )
    );

    const startDates = assignments
      .map((assignment) => assignment.start_date)
      .filter((value): value is string => Boolean(value))
      .sort();

    const endDates = assignments
      .map((assignment) => assignment.end_date)
      .filter((value): value is string => Boolean(value))
      .sort();

    return {
      contractLineCount: Number(lineCountRaw ?? 0),
      totalClientAssignments: totalAssignments,
      activeClientCount: activeAssignments,
      poRequiredCount: poRequiredAssignments,
      poNumbers,
      earliestStartDate: startDates[0] ?? null,
      latestEndDate: endDates.length > 0 ? endDates[endDates.length - 1] : null,
    };
  } catch (error) {
    console.error(`Error computing summary for contract ${contractId}:`, error);
    const expected = contractActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    throw error;
  }
});

export const getContractAssignments = withAuth(async (user, { tenant }, contractId: string): Promise<IContractAssignmentSummary[] | ContractActionError> => {
  try {
    await assertBillingPermission(user, 'read', 'view contract assignments');
    const { knex } = await createTenantKnex();

    const selection = [
      'cc.client_contract_id',
      'cc.client_id',
      'cc.start_date',
      'cc.end_date',
      'cc.renewal_mode',
      'cc.notice_period_days',
      'cc.renewal_term_months',
      'cc.use_tenant_renewal_defaults',
      'cc.decision_due_date',
      'cc.is_active',
      'cc.tenant',
      'c.client_name',
      'dbs.default_renewal_mode as tenant_default_renewal_mode',
      'dbs.default_notice_period_days as tenant_default_notice_period_days',
      'cc.po_required',
      'cc.po_number',
      'cc.po_amount',
      'cc.renewal_ticket_board_id',
      'cc.renewal_ticket_status_id',
      'co.status as contract_status',
    ];

    const facade = tenantDb(knex, tenant);
    const query = facade.table('client_contracts as cc');
    facade.tenantJoin(query, 'clients as c', 'cc.client_id', 'c.client_id', { type: 'left' });
    facade.tenantJoin(query, 'default_billing_settings as dbs', 'cc.tenant', 'dbs.tenant', { type: 'left' });
    facade.tenantJoin(query, 'contracts as co', 'cc.contract_id', 'co.contract_id');

    const rows = await query
      .where({ 'cc.contract_id': contractId })
      .select(selection)
      .orderBy('cc.start_date', 'asc');

    return rows.map((row: any) => {
      const renewalMode =
        row.renewal_mode === 'none' || row.renewal_mode === 'manual' || row.renewal_mode === 'auto'
          ? row.renewal_mode
          : undefined;
      const tenantDefaultRenewalMode =
        row.tenant_default_renewal_mode === 'none' ||
        row.tenant_default_renewal_mode === 'manual' ||
        row.tenant_default_renewal_mode === 'auto'
          ? row.tenant_default_renewal_mode
          : 'manual';
      const useTenantRenewalDefaults = row.use_tenant_renewal_defaults !== false;

      const noticePeriodRaw =
        typeof row.notice_period_days === 'string' ? Number(row.notice_period_days) : row.notice_period_days;
      const tenantDefaultNoticeRaw =
        typeof row.tenant_default_notice_period_days === 'string'
          ? Number(row.tenant_default_notice_period_days)
          : row.tenant_default_notice_period_days;
      const renewalTermRaw =
        typeof row.renewal_term_months === 'string' ? Number(row.renewal_term_months) : row.renewal_term_months;

      const noticePeriodDays =
        Number.isInteger(noticePeriodRaw) && Number(noticePeriodRaw) >= 0
          ? Number(noticePeriodRaw)
          : undefined;
      const tenantDefaultNoticePeriodDays =
        Number.isInteger(tenantDefaultNoticeRaw) && Number(tenantDefaultNoticeRaw) >= 0
          ? Number(tenantDefaultNoticeRaw)
          : 30;

      const renewalTermMonths =
        Number.isInteger(renewalTermRaw) && Number(renewalTermRaw) > 0
          ? Number(renewalTermRaw)
          : undefined;

      return {
        client_contract_id: row.client_contract_id,
        client_id: row.client_id,
        client_name: row.client_name ?? null,
        assignment_status: deriveClientContractStatus({
          isActive: Boolean(row.is_active),
          startDate: row.start_date,
          endDate: row.end_date,
          contractStatus: row.contract_status,
        }),
        start_date: row.start_date ?? null,
        end_date: row.end_date ?? null,
        renewal_mode: renewalMode,
        notice_period_days: noticePeriodDays,
        renewal_term_months: renewalTermMonths,
        use_tenant_renewal_defaults: useTenantRenewalDefaults,
        renewal_ticket_board_id: row.renewal_ticket_board_id ?? null,
        renewal_ticket_status_id: row.renewal_ticket_status_id ?? null,
        effective_renewal_mode: useTenantRenewalDefaults
          ? tenantDefaultRenewalMode
          : renewalMode ?? tenantDefaultRenewalMode,
        effective_notice_period_days: useTenantRenewalDefaults
          ? tenantDefaultNoticePeriodDays
          : noticePeriodDays ?? tenantDefaultNoticePeriodDays,
        decision_due_date: row.decision_due_date ? new Date(row.decision_due_date).toISOString().split('T')[0] : null,
        is_active: row.is_active ?? false,
        po_required: Boolean(row.po_required),
        po_number: row.po_number,
        po_amount: row.po_amount,
        tenant: row.tenant,
      };
    });
  } catch (error) {
    console.error(`Error fetching assignments for contract ${contractId}:`, error);
    const expected = contractActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    throw error;
  }
});

/**
 * Contract line overview with services for display in the contract overview
 */
export interface IContractLineOverview {
  contract_line_id: string;
  contract_line_name: string;
  contract_line_type: 'Fixed' | 'Hourly' | 'Usage';
  billing_frequency: string;
  base_rate: number | null;  // For fixed lines - in cents
  display_order: number;
  services: {
    service_id: string;
    service_name: string;
    billing_method: string;
    custom_rate: number | null;  // In cents
    quantity: number | null;
    unit_of_measure: string | null;
  }[];
}

/**
 * Complete contract overview data for at-a-glance display
 */
export interface IContractOverview {
  contractLines: IContractLineOverview[];
  totalEstimatedMonthlyValue: number | null;  // In cents, null if not calculable
  serviceCount: number;
  hasHourlyServices: boolean;
  hasUsageServices: boolean;
  hasFixedServices: boolean;
  currencyCode: string;  // ISO currency code (e.g., 'USD', 'AUD')
}

/**
 * Get comprehensive contract overview including contract lines, services, and estimated value
 */
export const getContractOverview = withAuth(async (user, { tenant }, contractId: string): Promise<IContractOverview | ContractActionError> => {
  try {
    await assertBillingPermission(user, 'read', 'view contract overview');
    const { knex } = await createTenantKnex();

    // Check if this is a template contract
    const templateRecord = await tenantScopedTable(knex, tenant, 'contract_templates')
      .where({ template_id: contractId })
      .first();

    const isTemplate = Boolean(templateRecord);

    // Get currency code - templates default to USD, contracts have their own currency
    let currencyCode = 'USD';
    if (!isTemplate) {
      const contractRecord = await tenantScopedTable(knex, tenant, 'contracts')
        .where({ contract_id: contractId })
        .select('currency_code')
        .first();
      if (contractRecord?.currency_code) {
        currencyCode = contractRecord.currency_code;
      }
    }

    let contractLines: IContractLineOverview[] = [];

    if (isTemplate) {
      // Get template lines with their services
      const facade = tenantDb(knex, tenant);
      const lineQuery = facade.table('contract_template_lines as ctl');
      facade.tenantJoin(lineQuery, 'contract_template_line_fixed_config as tfc', 'ctl.template_line_id', 'tfc.template_line_id', { type: 'left' });

      const lines = await lineQuery
        .where({ 'ctl.template_id': contractId })
        .select([
          'ctl.template_line_id as contract_line_id',
          'ctl.template_line_name as contract_line_name',
          'ctl.line_type as contract_line_type',
          'ctl.billing_frequency',
          'ctl.display_order',
          'tfc.base_rate'
        ])
        .orderBy('ctl.display_order', 'asc');

      // Get services for each line
      for (const line of lines) {
        const serviceQuery = facade.table('contract_template_line_services as ctls');
        facade.tenantJoin(serviceQuery, 'service_catalog as s', 'ctls.service_id', 's.service_id', { type: 'left' });

        const services = await serviceQuery
          .where({ 'ctls.template_line_id': line.contract_line_id })
          .select([
            'ctls.service_id',
            's.service_name',
            's.billing_method',
            'ctls.custom_rate',
            'ctls.quantity'
          ]);

        // Get service configurations for rates
        const configs = await tenantScopedTable(knex, tenant, 'contract_template_line_service_configuration as config')
          .where({ 'config.template_line_id': line.contract_line_id })
          .select(['config.service_id', 'config.custom_rate', 'config.quantity']);

        const configMap = new Map<string, any>((configs as any[]).map((c: any) => [c.service_id, c]));

        contractLines.push({
          contract_line_id: line.contract_line_id,
          contract_line_name: line.contract_line_name,
          contract_line_type: (line.contract_line_type || 'Fixed') as 'Fixed' | 'Hourly' | 'Usage',
          billing_frequency: line.billing_frequency || 'monthly',
          base_rate: line.base_rate ? Number(line.base_rate) : null,
          display_order: line.display_order ?? 0,
          services: (services as any[]).map((svc: any) => {
            const config = configMap.get(svc.service_id);
            return {
              service_id: svc.service_id,
              service_name: svc.service_name || 'Unknown Service',
              billing_method: svc.billing_method || 'fixed',
              custom_rate: config?.custom_rate ? Number(config.custom_rate) : (svc.custom_rate ? Number(svc.custom_rate) : null),
              quantity: config?.quantity ?? svc.quantity ?? 1,
              unit_of_measure: null
            };
          })
        });
      }
    } else {
      // Get regular contract lines with their services
      // Note: For regular contracts, custom_rate is stored directly on contract_lines table
      const facade = tenantDb(knex, tenant);
      const lines = await facade.table('contract_lines as cl')
        .where({ 'cl.contract_id': contractId })
        .select([
          'cl.contract_line_id',
          'cl.contract_line_name',
          'cl.contract_line_type',
          'cl.billing_frequency',
          'cl.display_order',
          'cl.custom_rate as base_rate'
        ])
        .orderBy('cl.display_order', 'asc');

      // Get services for each line
      for (const line of lines) {
        const serviceQuery = facade.table('contract_line_services as cls');
        facade.tenantJoin(serviceQuery, 'service_catalog as s', 'cls.service_id', 's.service_id', { type: 'left' });

        const services = await serviceQuery
          .where({ 'cls.contract_line_id': line.contract_line_id })
          .select([
            'cls.service_id',
            's.service_name',
            's.billing_method',
            's.unit_of_measure'
          ]);

        // Get service configurations for rates
        const configs = await tenantScopedTable(knex, tenant, 'contract_line_service_configuration as config')
          .where({ 'config.contract_line_id': line.contract_line_id })
          .select(['config.service_id', 'config.custom_rate', 'config.quantity']);

        const configMap = new Map<string, any>((configs as any[]).map((c: any) => [c.service_id, c]));

        contractLines.push({
          contract_line_id: line.contract_line_id,
          contract_line_name: line.contract_line_name,
          contract_line_type: (line.contract_line_type || 'Fixed') as 'Fixed' | 'Hourly' | 'Usage',
          billing_frequency: line.billing_frequency || 'monthly',
          base_rate: line.base_rate ? Number(line.base_rate) : null,
          display_order: line.display_order ?? 0,
          services: (services as any[]).map((svc: any) => {
            const config = configMap.get(svc.service_id);
            return {
              service_id: svc.service_id,
              service_name: svc.service_name || 'Unknown Service',
              billing_method: svc.billing_method || 'fixed',
              custom_rate: config?.custom_rate ? Number(config.custom_rate) : null,
              quantity: config?.quantity ?? 1,
              unit_of_measure: svc.unit_of_measure || null
            };
          })
        });
      }
    }

    // Calculate totals
    const serviceCount = contractLines.reduce((acc, line) => acc + line.services.length, 0);
    const hasFixedServices = contractLines.some(line => line.contract_line_type === 'Fixed');
    const hasHourlyServices = contractLines.some(line => line.contract_line_type === 'Hourly');
    const hasUsageServices = contractLines.some(line => line.contract_line_type === 'Usage');

    // Calculate estimated monthly value (only for fixed lines)
    let totalEstimatedMonthlyValue: number | null = null;

    if (hasFixedServices && !hasHourlyServices && !hasUsageServices) {
      // All fixed - we can calculate
      totalEstimatedMonthlyValue = contractLines
        .filter(line => line.contract_line_type === 'Fixed' && line.base_rate !== null)
        .reduce((acc, line) => {
          let monthlyRate = line.base_rate!;
          // Normalize to monthly
          if (line.billing_frequency === 'weekly') {
            monthlyRate = monthlyRate * 4.33;
          } else if (line.billing_frequency === 'quarterly') {
            monthlyRate = monthlyRate / 3;
          } else if (line.billing_frequency === 'semi-annually' || line.billing_frequency === 'semi_annually') {
            monthlyRate = monthlyRate / 6;
          } else if (line.billing_frequency === 'annually') {
            monthlyRate = monthlyRate / 12;
          }
          return acc + monthlyRate;
        }, 0);
    } else if (hasFixedServices) {
      // Mixed - calculate fixed portion only
      totalEstimatedMonthlyValue = contractLines
        .filter(line => line.contract_line_type === 'Fixed' && line.base_rate !== null)
        .reduce((acc, line) => {
          let monthlyRate = line.base_rate!;
          // Normalize to monthly
          if (line.billing_frequency === 'weekly') {
            monthlyRate = monthlyRate * 4.33;
          } else if (line.billing_frequency === 'quarterly') {
            monthlyRate = monthlyRate / 3;
          } else if (line.billing_frequency === 'semi-annually' || line.billing_frequency === 'semi_annually') {
            monthlyRate = monthlyRate / 6;
          } else if (line.billing_frequency === 'annually') {
            monthlyRate = monthlyRate / 12;
          }
          return acc + monthlyRate;
        }, 0);
    }

    return {
      contractLines,
      totalEstimatedMonthlyValue,
      serviceCount,
      hasFixedServices,
      hasHourlyServices,
      hasUsageServices,
      currencyCode
    };
  } catch (error) {
    console.error(`Error fetching contract overview for ${contractId}:`, error);
    const expected = contractActionErrorFrom(error);
    if (expected) {
      return expected;
    }
    throw error;
  }
});
