import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { toISODate, toPlainDate } from '@alga-psa/core';
import type { ISO8601String } from '@alga-psa/types';
import {
  buildContractLineAttributionDecision,
  resolveDeterministicContractLineSelection,
  type ContractLineAttributionDecision,
} from '../contractLineDisambiguation.shared';

const ATTRIBUTION_TABLES = {
  time_entry: {
    table: 'time_entries',
    idColumn: 'entry_id',
    hasUpdatedAt: true,
  },
  usage_record: {
    table: 'usage_tracking',
    idColumn: 'usage_id',
    hasUpdatedAt: false,
  },
} as const;

type EligibleContractLine = {
  client_contract_line_id: string;
  billing_profile_id: string | null;
  contract_billing_profile_id: string | null;
};

type AttributionWindowRecord = {
  kind: 'time_entry' | 'usage_record';
  recordId: string;
  serviceId: string;
  workDate: ISO8601String;
  workItemBillingProfileId?: string | null;
};

/**
 * Load candidates for the same client/service/date rule used by calculation.
 * This helper deliberately returns candidate rows, not a selected id, so the
 * shared resolver remains the single deterministic classification rule.
 */
export async function getEligibleContractLinesForServiceAtDate(params: {
  trx: Knex.Transaction;
  tenant: string;
  clientId: string;
  serviceId: string;
  workDate: ISO8601String;
}): Promise<EligibleContractLine[]> {
  const { trx, tenant, clientId, serviceId, workDate } = params;
  const db = tenantDb(trx, tenant);
  const query = db.table('client_contracts as cc');
  db.tenantJoin(query, 'contracts as c', 'c.contract_id', 'cc.contract_id');
  db.tenantJoin(query, 'contract_lines as cl', 'cl.contract_id', 'c.contract_id');
  db.tenantJoin(
    query,
    'contract_line_services as cls',
    'cls.contract_line_id',
    'cl.contract_line_id',
  );

  const rows = await query
    .where({
      'cc.client_id': clientId,
      'cc.is_active': true,
      'cls.service_id': serviceId,
    })
    .where('cc.start_date', '<=', workDate)
    .where(function (this: Knex.QueryBuilder) {
      this.whereNull('cc.end_date').orWhere('cc.end_date', '>=', workDate);
    })
    .distinct('cl.contract_line_id')
    .select(
      'cl.contract_line_id',
      'cl.billing_profile_id',
      'cc.billing_profile_id as contract_billing_profile_id',
    );

  return rows
    .filter((row: any) => typeof row.contract_line_id === 'string')
    .map((row: any) => ({
      client_contract_line_id: row.contract_line_id,
      billing_profile_id: row.billing_profile_id ?? null,
      contract_billing_profile_id: row.contract_billing_profile_id ?? null,
    }));
}

async function loadWindowRecords(params: {
  trx: Knex.Transaction;
  tenant: string;
  clientId: string;
  windowStart: ISO8601String;
  windowEnd: ISO8601String;
}): Promise<AttributionWindowRecord[]> {
  const { trx, tenant, clientId, windowStart, windowEnd } = params;
  const db = tenantDb(trx, tenant);

  const timeQuery = db.table<any>('time_entries');
  db.tenantJoin(timeQuery, 'project_tasks', 'time_entries.work_item_id', 'project_tasks.task_id', { type: 'left' });
  db.tenantJoin(timeQuery, 'project_phases', 'project_tasks.phase_id', 'project_phases.phase_id', { type: 'left' });
  db.tenantJoin(timeQuery, 'projects', 'project_phases.project_id', 'projects.project_id', { type: 'left' });
  db.tenantJoin(timeQuery, 'tickets', 'time_entries.work_item_id', 'tickets.ticket_id', { type: 'left' });

  const [timeEntries, usageRecords] = await Promise.all([
    timeQuery
      .where('time_entries.tenant', tenant)
      .where('time_entries.invoiced', false)
      .whereNull('time_entries.contract_line_id')
      .whereNotNull('time_entries.service_id')
      .where('time_entries.approval_status', 'APPROVED')
      .where('time_entries.billable_duration', '>', 0)
      .where('time_entries.start_time', '>=', windowStart)
      .where('time_entries.end_time', '<', windowEnd)
      .where(function (this: Knex.QueryBuilder) {
        this.where('projects.client_id', clientId).orWhere('tickets.client_id', clientId);
      })
      .select(
        'time_entries.entry_id',
        'time_entries.service_id',
        'time_entries.start_time',
        trx.raw('COALESCE(tickets.billing_profile_id, projects.billing_profile_id) as work_item_billing_profile_id'),
      ),
    db.table<any>('usage_tracking')
      .where({
        'usage_tracking.tenant': tenant,
        'usage_tracking.client_id': clientId,
        'usage_tracking.invoiced': false,
      })
      .whereNull('usage_tracking.contract_line_id')
      .whereNotNull('usage_tracking.service_id')
      .where('usage_tracking.usage_date', '>=', windowStart)
      .where('usage_tracking.usage_date', '<', windowEnd)
      .select('usage_tracking.usage_id', 'usage_tracking.service_id', 'usage_tracking.usage_date'),
  ]);

  return [
    ...timeEntries.map((row: any) => ({
      kind: 'time_entry' as const,
      recordId: row.entry_id,
      serviceId: row.service_id,
      workDate: toISODate(toPlainDate(row.start_time)),
      workItemBillingProfileId: row.work_item_billing_profile_id ?? null,
    })),
    ...usageRecords.map((row: any) => ({
      kind: 'usage_record' as const,
      recordId: row.usage_id,
      serviceId: row.service_id,
      workDate: toISODate(toPlainDate(row.usage_date)),
    })),
  ];
}

/** Apply in-memory decisions using the production table-specific write shape. */
export async function applyContractLineAttributionDecisions(
  trx: Knex.Transaction,
  tenant: string,
  decisions: ContractLineAttributionDecision[],
): Promise<{ assigned: number; markedUnresolved: number }> {
  const db = tenantDb(trx, tenant);
  let assigned = 0;
  let markedUnresolved = 0;

  for (const decision of decisions) {
    const descriptor = ATTRIBUTION_TABLES[decision.kind];
    const query = db.table<any>(descriptor.table).where({
      tenant,
      [descriptor.idColumn]: decision.recordId,
    });

    if (decision.action === 'assign') {
      const updatePayload: Record<string, unknown> = {
        contract_line_id: decision.contractLineId,
        contract_line_source: decision.source,
        contract_line_unresolved_reason: null,
      };
      if (descriptor.hasUpdatedAt) {
        updatePayload.updated_at = trx.fn.now();
      }
      const updatedCount = await query.whereNull('contract_line_id').update(updatePayload);
      if (updatedCount > 0) assigned += updatedCount;
      continue;
    }

    const current = await query.first(
      'contract_line_id',
      'contract_line_source',
      'contract_line_unresolved_reason',
    );
    if (!current || current.contract_line_id) continue;
    if (
      current.contract_line_source === 'unresolved' &&
      current.contract_line_unresolved_reason === decision.reason
    ) {
      continue;
    }

    const updatePayload: Record<string, unknown> = {
      contract_line_source: 'unresolved',
      contract_line_unresolved_reason: decision.reason,
    };
    if (descriptor.hasUpdatedAt) {
      updatePayload.updated_at = trx.fn.now();
    }
    const updatedCount = await query.whereNull('contract_line_id').update(updatePayload);
    if (updatedCount > 0) markedUnresolved += updatedCount;
  }

  return { assigned, markedUnresolved };
}

/** Resolve and persist every currently unassigned record in one transaction. */
export async function reconcileWindowAttribution(params: {
  trx: Knex.Transaction;
  tenant: string;
  clientId: string;
  windowStart: ISO8601String;
  windowEnd: ISO8601String;
}): Promise<{ assigned: number; markedUnresolved: number }> {
  const records = await loadWindowRecords(params);
  const decisions: ContractLineAttributionDecision[] = [];

  for (const record of records) {
    const eligibleLines = await getEligibleContractLinesForServiceAtDate({
      trx: params.trx,
      tenant: params.tenant,
      clientId: params.clientId,
      serviceId: record.serviceId,
      workDate: record.workDate,
    });
    const selection = resolveDeterministicContractLineSelection(eligibleLines, {
      billingProfileId: record.workItemBillingProfileId ?? null,
    });
    const decision = buildContractLineAttributionDecision({
      kind: record.kind,
      recordId: record.recordId,
      selection,
    });
    decisions.push(decision);
    console.info('[billing_engine.reconcile.unresolved]', {
      event: 'billing_engine.reconcile.unresolved',
      recordType: record.kind,
      tenant: params.tenant,
      clientId: params.clientId,
      recordId: record.recordId,
      decision: decision.action === 'assign' ? 'deterministic_single_match' : decision.reason,
      reason: decision.action === 'assign' ? selection.reason : decision.reason,
      selectedContractLineId: decision.action === 'assign' ? decision.contractLineId : null,
      eligibleLineCount: eligibleLines.length,
      persisted: false,
    });
  }

  const result = await applyContractLineAttributionDecisions(
    params.trx,
    params.tenant,
    decisions,
  );
  console.info('[billing_engine.reconcile.unresolved.persisted]', {
    event: 'billing_engine.reconcile.unresolved.persisted',
    tenant: params.tenant,
    clientId: params.clientId,
    ...result,
  });
  return result;
}

export { ATTRIBUTION_TABLES };
