'use server';

import { Knex } from 'knex';
import { createTenantKnex, tenantDb } from '@alga-psa/db';
import type { IClientContractLine } from '@alga-psa/types';
import { formatISO } from 'date-fns';
import { getCurrentUser } from '@alga-psa/user-composition/actions';
import {
  resolveDeterministicContractLineSelection,
  type ContractLineSelectionOptions,
  type ContractLineSelectionResult,
} from './contractLineDisambiguation.shared';

// Copied from @alga-psa/billing/lib/contractLineDisambiguation to avoid scheduling → billing deps.

type EligibleContractLine = IClientContractLine & {
  contract_line_type: string;
  /** contract_lines.billing_profile_id — step 2 of the resolution chain. */
  billing_profile_id?: string | null;
  /** client_contracts.billing_profile_id — step 3 of the resolution chain. */
  contract_billing_profile_id?: string | null;
  bucket_overlay?: {
    config_id: string;
    total_minutes?: number | null;
    overage_rate?: number | null;
    allow_rollover?: boolean | null;
  };
};

const resolveEffectiveDateRange = (
  effectiveDate?: string | Date
): { rangeStart: string; rangeEnd: string } => {
  const source =
    effectiveDate instanceof Date
      ? effectiveDate.toISOString()
      : typeof effectiveDate === 'string' && effectiveDate.trim().length > 0
        ? effectiveDate
        : new Date().toISOString();
  const normalizedDate = source.slice(0, 10);
  return {
    rangeStart: `${normalizedDate}T00:00:00.000Z`,
    rangeEnd: `${normalizedDate}T23:59:59.999Z`,
  };
};

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

export async function getEligibleContractLines(
  knex: Knex,
  tenant: string,
  clientId: string,
  serviceId: string,
  effectiveDate?: string | Date
): Promise<EligibleContractLine[]> {
  const { rangeStart, rangeEnd } = resolveEffectiveDateRange(effectiveDate);
  const db = tenantDb(knex, tenant);

  const serviceInfo = await db.table('service_catalog')
    .where({
      'service_catalog.service_id': serviceId,
    })
    .first('category_id', 'custom_service_type_id as service_type_id');

  if (!serviceInfo) {
    console.warn(`Service not found: ${serviceId}`);
    return [];
  }

  const query = db.table('client_contracts');
  db.tenantJoin(query, 'contracts', 'client_contracts.contract_id', 'contracts.contract_id');
  db.tenantJoin(query, 'contract_lines', 'contracts.contract_id', 'contract_lines.contract_id');
  db.tenantJoin(query, 'contract_line_services', 'contract_lines.contract_line_id', 'contract_line_services.contract_line_id');
  // Scope-resolution rule (weighted-burn model): explicit membership on a line
  // bucket, else the line's catch-all bucket. Replacement for the legacy
  // configuration_type='Bucket' overlay join.
  db.tenantJoin(
    query,
    'contract_line_bucket_services as member',
    'member.contract_line_id',
    'contract_lines.contract_line_id',
    {
      type: 'left',
      on(join) {
        join.andOn('member.service_id', '=', 'contract_line_services.service_id');
      },
    }
  );
  db.tenantJoin(
    query,
    'contract_line_buckets as catch_all',
    'catch_all.contract_line_id',
    'contract_lines.contract_line_id',
    {
      type: 'left',
      on(join) {
        join.andOnVal('catch_all.covers_all_services', '=', true);
      },
    }
  );

  query
    .where({
      'client_contracts.client_id': clientId,
      'client_contracts.is_active': true,
      'contract_line_services.service_id': serviceId,
    })
    .where(function (this: Knex.QueryBuilder) {
      this.where('client_contracts.start_date', '<=', rangeEnd);
    })
    .where(function (this: Knex.QueryBuilder) {
      this.whereNull('client_contracts.end_date').orWhere('client_contracts.end_date', '>=', rangeStart);
    })
    .where(function (this: Knex.QueryBuilder) {
      this.whereNull('contracts.is_system_managed_default')
        .orWhere('contracts.is_system_managed_default', false);
    });

  const rows = await query.select(
    'contract_lines.contract_line_id as client_contract_line_id',
    'client_contracts.client_id',
    'contract_lines.contract_line_id',
    'client_contracts.start_date',
    'client_contracts.end_date',
    'client_contracts.is_active',
    'client_contracts.tenant',
    'client_contracts.client_contract_id',
    'contracts.contract_id',
    'contract_lines.contract_line_type',
    'contract_lines.contract_line_name',
    'contracts.contract_name',
    // Steps 2 and 3 of the billing-profile chain, so profile-aware narrowing
    // can prefer the line whose contract belongs to the work item's profile.
    'contract_lines.billing_profile_id',
    'client_contracts.billing_profile_id as contract_billing_profile_id',
    'member.bucket_id as member_bucket_id',
    'catch_all.bucket_id as catch_all_bucket_id'
  );

  return rows.map((row) => {
    const {
      member_bucket_id,
      catch_all_bucket_id,
      start_date,
      end_date,
      ...rest
    } = row as Record<string, any>;

    const { bucket_overlay: existingOverlay, ...restWithoutOverlay } = rest;

    const bucket_config_id = member_bucket_id ?? catch_all_bucket_id ?? null;

    const bucket_overlay = bucket_config_id
      ? {
          config_id: bucket_config_id,
          total_minutes: null,
          overage_rate: null,
          allow_rollover: null,
        }
      : existingOverlay;

    return {
      ...restWithoutOverlay,
      start_date: start_date ? formatISO(start_date) : '',
      end_date: end_date ? formatISO(end_date) : null,
      bucket_overlay,
    } as EligibleContractLine;
  });
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

export async function getClientIdForWorkItem(workItemId: string, workItemType: string): Promise<string | null> {
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
    console.error('Error getting client ID for work item:', error);
    return null;
  }
}
