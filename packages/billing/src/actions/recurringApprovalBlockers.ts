import type { Knex } from 'knex';
import type { ISO8601String } from '@alga-psa/types';

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
  query.whereNotIn(column, [APPROVED_TIME_STATUS]);
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

  const query = knex('time_entries')
    .where('time_entries.tenant', tenant)
    .where('time_entries.start_time', '>=', row.servicePeriodStart)
    .where('time_entries.end_time', '<', row.servicePeriodEnd)
    .where('time_entries.invoiced', false)
    .where('time_entries.contract_line_id', row.contractLineId)
    .whereNotNull('time_entries.service_id');

  applyNonApprovedStatusFilter(query, 'time_entries.approval_status');

  const matchingRows = await query.select('time_entries.entry_id');
  return new Set(
    matchingRows
      .map((entry: { entry_id?: string | null }) => entry.entry_id)
      .filter((entryId): entryId is string => Boolean(entryId)),
  ).size;
}

async function countUnresolvedSelectionUnapprovedTimeEntries(params: {
  knex: Knex;
  tenant: string;
  row: RecurringApprovalBlockerRow;
  recordId: string;
}): Promise<number> {
  const { knex, tenant, row, recordId } = params;

  const query = knex('time_entries')
    .where('time_entries.tenant', tenant)
    .where('time_entries.entry_id', recordId)
    .where('time_entries.start_time', '>=', row.servicePeriodStart)
    .where('time_entries.end_time', '<', row.servicePeriodEnd)
    .where('time_entries.invoiced', false)
    .whereNull('time_entries.contract_line_id')
    .whereNotNull('time_entries.service_id');

  applyNonApprovedStatusFilter(query, 'time_entries.approval_status');

  const matchingRows = await query.select('time_entries.entry_id');
  return new Set(
    matchingRows
      .map((entry: { entry_id?: string | null }) => entry.entry_id)
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
