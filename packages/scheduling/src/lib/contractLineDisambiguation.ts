'use server';

import { Knex } from 'knex';
import { createTenantKnex } from '@alga-psa/db';
import type { IClientContractLine } from '@alga-psa/types';
import { formatISO } from 'date-fns';
import { getCurrentUser } from '@alga-psa/user-composition/actions';
import { resolveDeterministicContractLineSelection } from './contractLineDisambiguation.shared';

// Copied from @alga-psa/billing/lib/contractLineDisambiguation to avoid scheduling → billing deps.

type EligibleContractLine = IClientContractLine & {
  contract_line_type: string;
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
  decision: 'explicit' | 'default' | 'ambiguous_or_unresolved';
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

export async function determineDefaultContractLine(
  clientId: string,
  serviceId: string,
  effectiveDate?: string | Date
): Promise<string | null> {
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
    const resolution = resolveDeterministicContractLineSelection(eligibleContractLines);

    logResolverDecision({
      tenant,
      clientId,
      serviceId,
      effectiveDate,
      eligibleCount: eligibleContractLines.length,
      overlayCount: resolution.overlayCount,
      decision: resolution.decision,
      selectedContractLineId: resolution.selectedContractLineId,
    });
    return resolution.selectedContractLineId;
  } catch (error) {
    console.error('Error determining default contract line:', error);
    return null;
  }
}

export async function getEligibleContractLines(
  knex: Knex,
  tenant: string,
  clientId: string,
  serviceId: string,
  effectiveDate?: string | Date
): Promise<EligibleContractLine[]> {
  const { rangeStart, rangeEnd } = resolveEffectiveDateRange(effectiveDate);

  const serviceInfo = await knex('service_catalog')
    .where({
      'service_catalog.service_id': serviceId,
      'service_catalog.tenant': tenant,
    })
    .first('category_id', 'custom_service_type_id as service_type_id');

  if (!serviceInfo) {
    console.warn(`Service not found: ${serviceId}`);
    return [];
  }

  const query = knex('client_contracts')
    .join('contracts', function () {
      this.on('client_contracts.contract_id', '=', 'contracts.contract_id').andOn(
        'contracts.tenant',
        '=',
        'client_contracts.tenant'
      );
    })
    .join('contract_lines', function () {
      this.on('contracts.contract_id', '=', 'contract_lines.contract_id').andOn(
        'contract_lines.tenant',
        '=',
        'contracts.tenant'
      );
    })
    .join('contract_line_services', function () {
      this.on('contract_lines.contract_line_id', '=', 'contract_line_services.contract_line_id').andOn(
        'contract_line_services.tenant',
        '=',
        'contract_lines.tenant'
      );
    })
    .leftJoin('contract_line_service_configuration as bucket_config', function () {
      this.on('bucket_config.contract_line_id', '=', 'contract_lines.contract_line_id')
        .andOn('bucket_config.tenant', '=', 'contract_lines.tenant')
        .andOn('bucket_config.service_id', '=', 'contract_line_services.service_id')
        .andOnVal('bucket_config.configuration_type', 'Bucket');
    })
    .leftJoin('contract_line_service_bucket_config as bucket_details', function () {
      this.on('bucket_details.config_id', '=', 'bucket_config.config_id').andOn('bucket_details.tenant', '=', 'bucket_config.tenant');
    })
    .where({
      'client_contracts.client_id': clientId,
      'client_contracts.is_active': true,
      'client_contracts.tenant': tenant,
      'contract_line_services.service_id': serviceId,
    })
    .where(function (this: Knex.QueryBuilder) {
      this.where('client_contracts.start_date', '<=', rangeEnd);
    })
    .where(function (this: Knex.QueryBuilder) {
      this.whereNull('client_contracts.end_date').orWhere('client_contracts.end_date', '>=', rangeStart);
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
    'bucket_config.config_id as bucket_config_id',
    'bucket_details.total_minutes as bucket_total_minutes',
    'bucket_details.overage_rate as bucket_overage_rate',
    'bucket_details.allow_rollover as bucket_allow_rollover'
  );

  return rows.map((row) => {
    const {
      bucket_config_id,
      bucket_total_minutes,
      bucket_overage_rate,
      bucket_allow_rollover,
      start_date,
      end_date,
      ...rest
    } = row as Record<string, any>;

    const { bucket_overlay: existingOverlay, ...restWithoutOverlay } = rest;

    const bucket_overlay = bucket_config_id
      ? {
          config_id: bucket_config_id,
          total_minutes: bucket_total_minutes ?? null,
          overage_rate: bucket_overage_rate ?? null,
          allow_rollover: bucket_allow_rollover ?? null,
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
    if (workItemType === 'project_task') {
      const result = await knex('project_tasks')
        .join('project_phases', function () {
          this.on('project_tasks.phase_id', '=', 'project_phases.phase_id').andOn('project_tasks.tenant', '=', 'project_phases.tenant');
        })
        .join('projects', function () {
          this.on('project_phases.project_id', '=', 'projects.project_id').andOn('project_phases.tenant', '=', 'projects.tenant');
        })
        .where({ 'project_tasks.task_id': workItemId, 'project_tasks.tenant': tenant })
        .first('projects.client_id');

      return result?.client_id || null;
    }
    if (workItemType === 'ticket') {
      const result = await knex('tickets').where({ ticket_id: workItemId, tenant }).first('client_id');
      return result?.client_id || null;
    }
    if (workItemType === 'interaction') {
      const result = await knex('interactions').where({ interaction_id: workItemId, tenant }).first('client_id');
      return result?.client_id || null;
    }
    return null;
  } catch (error) {
    console.error('Error getting client ID for work item:', error);
    return null;
  }
}
