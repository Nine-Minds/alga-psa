import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { toISODate, toPlainDate } from '@alga-psa/core';
import type { ISO8601String } from '@alga-psa/types';
import { toPlainDate, toISODate } from '@alga-psa/core';

export type RecurringApprovalBlockerRow = {
  executionIdentityKey: string;
  clientId: string;
  servicePeriodStart: ISO8601String;
  servicePeriodEnd: ISO8601String;
  contractLineId?: string | null;
  scheduleKey?: string | null;
};

export type RecurringApprovalBlockerCounts = Map<string, number>;

const APPROVED_TIME_STATUS = 'APPROVED';

export function formatApprovalBlockedReason(unapprovedEntryCount: number): string {
  const noun = unapprovedEntryCount === 1 ? 'entry' : 'entries';
  return `Blocked until approval: ${unapprovedEntryCount} unapproved ${noun}.`;
}

function parseUnresolvedSelectionFromScheduleKey(scheduleKey: string | null | undefined): {
  chargeType: 'time' | 'usage';
  recordId: string;
} | null {
  if (!scheduleKey) {
    return null;
  }

  const match = scheduleKey.match(/:(?:unresolved|non_contract):(time|usage):([^:]+)$/);
  if (!match?.[1] || !match?.[2]) {
    return null;
  }

  return {
    chargeType: match[1] as 'time' | 'usage',
    recordId: match[2],
  };
}

function applyNonApprovedStatusFilter(query: Knex.QueryBuilder, column: string) {
  query.where(function applyApprovalStatusGuard(this: Knex.QueryBuilder) {
    this.whereNull(column).orWhere(column, '<>', APPROVED_TIME_STATUS);
  });
}

// `service_period_end` is persisted as the EXCLUSIVE end of a half-open service
// period (e.g. a June period ends 2026-07-01, which is not itself part of June),
// so it is already the correct upper bound for an `end_time < ...` comparison --
// matching both the billing engine (`servicePeriodEndExclusive = coveredPeriod.end`)
// and `countUnresolvedSelectionUnapprovedTimeEntries`, which uses it directly.
// Previously this added a day, treating the value as inclusive, which pulled the
// entire first day of the NEXT period into the approval scan and blocked a
// completed period on unapproved time that belongs to the following one.
export function getContractServicePeriodEndExclusive(servicePeriodEnd: ISO8601String): ISO8601String {
  return toISODate(toPlainDate(servicePeriodEnd));
}

async function getServiceIdsForContractLine(params: {
  knex: Knex;
  tenant: string;
  contractLineId: string;
}): Promise<string[]> {
  const rows = await tenantDb(params.knex, params.tenant).table('contract_line_services')
    .where({
      contract_line_id: params.contractLineId,
    })
    .select('service_id');

  return rows
    .map((row: { service_id?: unknown }) => row.service_id)
    .filter((serviceId: unknown): serviceId is string =>
      typeof serviceId === 'string' && serviceId.length > 0,
    );
}

async function getUniquelyAssignableServiceIdsForLine(params: {
  knex: Knex;
  tenant: string;
  clientId: string;
  serviceIds: string[];
  contractLineId: string;
  servicePeriodStartExclusive: ISO8601String;
  servicePeriodEndExclusive: ISO8601String;
}): Promise<string[]> {
  if (params.serviceIds.length === 0) {
    return [];
  }

  const db = tenantDb(params.knex, params.tenant);
  const query = db.table('client_contracts as cc')
    .where({
      'cc.client_id': params.clientId,
    })
    .whereIn('cls.service_id', params.serviceIds)
    .where('cc.start_date', '<', params.servicePeriodEndExclusive)
    .where(function matchClientContractOverlap(this: Knex.QueryBuilder) {
      this.whereNull('cc.end_date').orWhere(
        'cc.end_date',
        '>=',
        params.servicePeriodStartExclusive,
      );
    })
    .groupBy('cls.service_id')
    .select(
      'cls.service_id',
      params.knex.raw('COUNT(DISTINCT cl.contract_line_id) as line_count'),
      params.knex.raw('MIN(cl.contract_line_id::text) as only_line_id'),
    );
  db.tenantJoin(query, 'contracts as c', 'c.contract_id', 'cc.contract_id');
  db.tenantJoin(query, 'contract_lines as cl', 'cl.contract_id', 'c.contract_id');
  db.tenantJoin(query, 'contract_line_services as cls', 'cls.contract_line_id', 'cl.contract_line_id');
  const rows = (await query) as unknown as Array<{
    service_id: string;
    line_count: string | number;
    only_line_id?: string | null;
  }>;

  return rows
    .filter(
      (row) => Number(row.line_count) === 1 && row.only_line_id === params.contractLineId,
    )
    .map((row) => row.service_id);
}

async function countContractLineUnapprovedTimeEntries(params: {
  knex: Knex;
  tenant: string;
  row: RecurringApprovalBlockerRow;
}): Promise<number> {
  const { knex, tenant, row } = params;
  if (!row.contractLineId) {
    return 0;
  }

  const configuredServiceIds = await getServiceIdsForContractLine({
    knex,
    tenant,
    contractLineId: row.contractLineId,
  });
  if (configuredServiceIds.length === 0) {
    return 0;
  }

  const servicePeriodStartExclusive = row.servicePeriodStart;
  const servicePeriodEndExclusive = row.servicePeriodEnd;
  const uniquelyAssignableServiceIds = await getUniquelyAssignableServiceIdsForLine({
    knex,
    tenant,
    clientId: row.clientId,
    serviceIds: configuredServiceIds,
    contractLineId: row.contractLineId,
    servicePeriodStartExclusive,
    servicePeriodEndExclusive,
  });

  const db = tenantDb(knex, tenant);
  const query = db.table('time_entries')
    .where('time_entries.start_time', '>=', servicePeriodStartExclusive)
    .where('time_entries.end_time', '<', servicePeriodEndExclusive)
    .where('time_entries.invoiced', false)
    .whereIn('time_entries.service_id', configuredServiceIds)
    .where(function matchContractAssociation(this: Knex.QueryBuilder) {
      this.where('time_entries.contract_line_id', row.contractLineId);
      if (uniquelyAssignableServiceIds.length > 0) {
        this.orWhere(function matchUniqueUnassigned(this: Knex.QueryBuilder) {
          this.whereNull('time_entries.contract_line_id').whereIn(
            'time_entries.service_id',
            uniquelyAssignableServiceIds,
          );
        });
      }
    })
    .where(function matchWorkItemShape(this: Knex.QueryBuilder) {
      this.where(function matchProjectTask(this: Knex.QueryBuilder) {
        this.where('time_entries.work_item_type', '=', 'project_task').whereNotNull(
          'project_tasks.task_id',
        );
      }).orWhere(function matchTicket(this: Knex.QueryBuilder) {
        this.where('time_entries.work_item_type', '=', 'ticket').whereNotNull(
          'tickets.ticket_id',
        );
      });
    })
    .where(function matchClient(this: Knex.QueryBuilder) {
      this.where('projects.client_id', row.clientId).orWhere(
        'tickets.client_id',
        row.clientId,
      );
    });
  db.tenantJoin(query, 'project_tasks', 'time_entries.work_item_id', 'project_tasks.task_id', { type: 'left' });
  db.tenantJoin(query, 'project_phases', 'project_tasks.phase_id', 'project_phases.phase_id', { type: 'left' });
  db.tenantJoin(query, 'projects', 'project_phases.project_id', 'projects.project_id', { type: 'left' });
  db.tenantJoin(query, 'tickets', 'time_entries.work_item_id', 'tickets.ticket_id', { type: 'left' });

  applyNonApprovedStatusFilter(query, 'time_entries.approval_status');

  const matchingRows = await query.distinct('time_entries.entry_id');
  return matchingRows.length;
}

async function countUnresolvedSelectionUnapprovedTimeEntries(params: {
  knex: Knex;
  tenant: string;
  row: RecurringApprovalBlockerRow;
  recordId: string;
}): Promise<number> {
  const { knex, tenant, row, recordId } = params;

  const query = tenantDb(knex, tenant).table('time_entries')
    .where('time_entries.entry_id', recordId)
    .where('time_entries.start_time', '>=', row.servicePeriodStart)
    .where('time_entries.end_time', '<', row.servicePeriodEnd)
    .where('time_entries.invoiced', false)
    .whereNull('time_entries.contract_line_id')
    .whereNotNull('time_entries.service_id');

  applyNonApprovedStatusFilter(query, 'time_entries.approval_status');

  const matchingRows = (await query.select('time_entries.entry_id')) as unknown as Array<{
    entry_id?: string | null;
  }>;
  return new Set(
    matchingRows
      .map((entry) => entry.entry_id)
      .filter((entryId): entryId is string => Boolean(entryId)),
  ).size;
}

export async function detectRecurringApprovalBlockers(params: {
  knex: Knex;
  tenant: string;
  rows: RecurringApprovalBlockerRow[];
}): Promise<RecurringApprovalBlockerCounts> {
  const countsByExecutionIdentityKey: RecurringApprovalBlockerCounts = new Map();

  for (const row of params.rows) {
    const unresolvedSelection = parseUnresolvedSelectionFromScheduleKey(row.scheduleKey ?? null);
    let blockedEntryCount = 0;

    if (unresolvedSelection?.chargeType === 'time') {
      blockedEntryCount = await countUnresolvedSelectionUnapprovedTimeEntries({
        knex: params.knex,
        tenant: params.tenant,
        row,
        recordId: unresolvedSelection.recordId,
      });
    } else if (row.contractLineId) {
      blockedEntryCount = await countContractLineUnapprovedTimeEntries({
        knex: params.knex,
        tenant: params.tenant,
        row,
      });
    }

    if (blockedEntryCount > 0) {
      countsByExecutionIdentityKey.set(
        row.executionIdentityKey,
        (countsByExecutionIdentityKey.get(row.executionIdentityKey) ?? 0) + blockedEntryCount,
      );
    }
  }

  return countsByExecutionIdentityKey;
}
