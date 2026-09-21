'use server';

import { Knex } from 'knex';
import { loadEligibleTimeContractLines, type EligibleContractLine } from './timeContractCandidates';
import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';
import { getCurrentUser } from '@alga-psa/user-composition/actions';
import { admitCoManagedNativeTimeSource, assertCoManagedTimeSaveFields, CoManagedSharedWorkError, isNativeTimeFieldHidden } from '@alga-psa/co-managed';
import { resolveNativeTimeBrowserActor } from './nativeTimeReader';
import {
  resolveDeterministicContractLineSelection,
  type ContractLineSelectionOptions,
  type ContractLineSelectionResult,
} from './contractLineDisambiguation.shared';

// Copied from @alga-psa/billing/lib/contractLineDisambiguation to avoid scheduling → billing deps.

const logResolverDecision = (payload: {
  tenant: string;
  clientId: string;
  serviceId: string;
  effectiveDate?: string | Date;
  eligibleCount: number;
  overlayCount: number;
  decision: ContractLineSelectionResult['decision'];
  reason: ContractLineSelectionResult['reason'];
  selectedContractLineId: string | null;
}): void => {
  console.info('[contract_line_resolver.routing]', {
    event: 'contract_line_resolver.routing',
    ...payload,
    metric:
      payload.decision === 'ambiguous_or_unresolved'
        ? { name: 'unresolved_ambiguous_count', value: 1 }
        : undefined,
  });
};

/**
 * Selects the contract line for a time entry or usage record, and reports why.
 * `options.billingProfileId` narrows a multi-candidate field to the line whose
 * contract belongs to the work item's billing profile (F133).
 */
export async function resolveContractLineSelection(
  clientId: string,
  serviceId: string,
  effectiveDate?: string | Date,
  options?: ContractLineSelectionOptions
): Promise<ContractLineSelectionResult> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('User not authenticated');
  }
  const { knex, tenant } = await createTenantKnex(currentUser.tenant);

  if (!tenant) {
    throw new Error('Tenant context not found');
  }

  try {
    const eligibleContractLines = await getEligibleContractLines(knex, tenant, clientId, serviceId, effectiveDate);
    const resolution = resolveDeterministicContractLineSelection(eligibleContractLines, options);

    logResolverDecision({
      tenant,
      clientId,
      serviceId,
      effectiveDate,
      eligibleCount: eligibleContractLines.length,
      overlayCount: resolution.overlayCount,
      decision: resolution.decision,
      reason: resolution.reason,
      selectedContractLineId: resolution.selectedContractLineId,
    });
    return resolution;
  } catch (error) {
    console.error('Error determining default contract line:', error);
    return {
      selectedContractLineId: null,
      decision: 'ambiguous_or_unresolved',
      reason: 'error',
      overlayCount: 0,
      candidateCount: 0,
    };
  }
}

/**
 * The contract line alone, for callers that do not record provenance.
 * Prefer `resolveContractLineSelection` when the reason matters — an entry that
 * ends up unresolved needs to say whether nothing covered the service or too
 * many lines did.
 */
export async function determineDefaultContractLine(
  clientId: string,
  serviceId: string,
  effectiveDate?: string | Date,
  options?: ContractLineSelectionOptions
): Promise<string | null> {
  const resolution = await resolveContractLineSelection(clientId, serviceId, effectiveDate, options);
  return resolution.selectedContractLineId;
}

export async function getEligibleContractLines(knex: Knex, tenant: string, clientId: string, serviceId: string, effectiveDate?: string | Date): Promise<EligibleContractLine[]> {
  return loadEligibleTimeContractLines(knex, tenant, clientId, serviceId, effectiveDate);
}

export async function getEligibleContractLinesForUI(
  clientId: string,
  serviceId: string,
  effectiveDate?: string | Date
): Promise<
  Array<{
    client_contract_line_id: string;
    contract_line_name: string;
    contract_line_type: string;
    contract_name?: string;
    start_date: string;
    end_date: string | null;
    has_bucket_overlay: boolean;
    bucket_overlay?: EligibleContractLine['bucket_overlay'];
  }>
> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('User not authenticated');
  }
  const { knex, tenant } = await createTenantKnex(currentUser.tenant);

  if (!tenant) {
    throw new Error('Tenant context not found');
  }

  try {
    const contractLines = await getEligibleContractLines(knex, tenant, clientId, serviceId, effectiveDate);

    return contractLines.map((contractLine) => {
      const hasBucketOverlay = Boolean(contractLine.bucket_overlay?.config_id);

      return {
        client_contract_line_id: contractLine.client_contract_line_id,
        contract_line_name: contractLine.contract_line_name || 'Unnamed Contract Line',
        contract_line_type: contractLine.contract_line_type,
        contract_name: contractLine.contract_name,
        start_date: contractLine.start_date,
        end_date: contractLine.end_date,
        has_bucket_overlay: hasBucketOverlay,
        bucket_overlay: contractLine.bucket_overlay,
      };
    });
  } catch (error) {
    console.error('Error getting eligible contract lines for UI:', error);
    return [];
  }
}

export async function getClientIdForWorkItem(workItemId: string, workItemType: string, existingEntryId?: string): Promise<string | null> {
  const currentUser = await getCurrentUser();
  if (!currentUser) {
    throw new Error('User not authenticated');
  }
  const { knex, tenant } = await createTenantKnex(currentUser.tenant);

  if (!tenant) {
    throw new Error('Tenant context not found');
  }

  try {
    const db = tenantDb(knex, tenant);

    if (workItemType === 'co_managed') {
      const actor = await resolveNativeTimeBrowserActor(currentUser, tenant);
      return withTransaction(knex, async trx => {
        const entry = existingEntryId ? await tenantDb(trx, tenant).table('time_entries').where({ entry_id: existingEntryId,
          work_item_type: 'co_managed', work_item_id: workItemId, co_managed_work_reference_id: workItemId }).first('user_id', 'time_sheet_id') : null;
        if (existingEntryId && !entry) throw new CoManagedSharedWorkError();
        const access = await admitCoManagedNativeTimeSource(trx, actor, { entry_id: existingEntryId, user_id: entry?.user_id ?? currentUser.user_id,
          time_sheet_id: entry?.time_sheet_id, work_item_type: 'co_managed', work_item_id: workItemId }, entry ? 'read' : 'create');
        if (!entry) assertCoManagedTimeSaveFields(access, 'co_managed');
        if (entry) {
          const current = await tenantDb(trx, tenant).table('time_entries').where({ entry_id: existingEntryId,
            work_item_type: 'co_managed', work_item_id: workItemId, co_managed_work_reference_id: workItemId }).forShare().first('user_id', 'time_sheet_id');
          if (!current || current.user_id !== entry.user_id || current.time_sheet_id !== entry.time_sheet_id) throw new CoManagedSharedWorkError();
        }
        await access.assertCurrent();
        return isNativeTimeFieldHidden(access.redactedTimeFields, ['client_id', 'billing']) ? null : access.clientId ?? null;
      });
    }
    if (workItemType === 'project_task') {
      const query = db.table('project_tasks');
      db.tenantJoin(query, 'project_phases', 'project_tasks.phase_id', 'project_phases.phase_id');
      db.tenantJoin(query, 'projects', 'project_phases.project_id', 'projects.project_id');

      const result = await query
        .where({ 'project_tasks.task_id': workItemId })
        .first<{ client_id: string }>('projects.client_id as client_id');

      return result?.client_id || null;
    }
    if (workItemType === 'ticket') {
      const result = await db.table('tickets').where({ ticket_id: workItemId }).first('client_id');
      return result?.client_id || null;
    }
    if (workItemType === 'interaction') {
      const result = await db.table('interactions').where({ interaction_id: workItemId }).first('client_id');
      return result?.client_id || null;
    }
    return null;
  } catch (error) {
    if (workItemType === 'co_managed') throw error;
    console.error('Error getting client ID for work item:', error);
    return null;
  }
}
