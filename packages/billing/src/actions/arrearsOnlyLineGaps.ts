import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type { IRecurringDueWorkMaterializationGap, ISO8601String } from '@alga-psa/types';
import { resolveRecurringChargeFamily } from '@shared/billingClients/contractLineTimingRule';
import { HOURLY_USAGE_ARREARS_REPAIR_REASON, hasUninvoicedActivity } from './arrearsOnlyLineRepair';

type StrandedPeriodRow = {
  record_id: string;
  obligation_id: string;
  schedule_key: string;
  period_key: string;
  charge_family: string;
  service_period_start: unknown;
  service_period_end: unknown;
  invoice_window_start: unknown;
  invoice_window_end: unknown;
  lifecycle_state: string;
  due_position: string;
  invoice_id: string | null;
};

const dateOnly = (value: unknown): string =>
  value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);

const spanKey = (lineId: string, row: { service_period_start: unknown; service_period_end: unknown }) =>
  `${lineId}|${dateOnly(row.service_period_start)}|${dateOnly(row.service_period_end)}`;

const BILLED_EMPTY_ADVANCE_DETAIL =
  'This hourly or usage line was billed in advance, so time or usage logged after that invoice cannot be billed yet. Fix all adds a catch-up charge for it.';
const RETIRED_ADVANCE_DETAIL =
  'This hourly or usage line had an unbilled advance period that was retired without a replacement, so work in it cannot be billed yet. Fix all adds a catch-up charge for it.';

/**
 * Finds Hourly/Usage lines whose old advance schedule still strands work, so the Generate page
 * can offer "Fix all" (which runs `repairArrearsOnlyLineSchedulesForTenant`). Two cases:
 *  1. a billed, chargeless advance period with unbilled approved time/usage inside its window and
 *     no arrears row covering it;
 *  2. a retired (`hourly_usage_arrears_repair`) unbilled advance period with no arrears row and no
 *     billed row covering the same span.
 * Both clear once the repair has run, because the repair adds the covering arrears row. Reads are
 * tenant-scoped and only touch rows of legacy advance Hourly/Usage lines, so a clean tenant pays
 * for two indexed row scans and nothing else.
 */
export async function fetchStrandedArrearsOnlyLineGaps(
  trx: Knex | Knex.Transaction,
  tenant: string,
): Promise<IRecurringDueWorkMaterializationGap[]> {
  const db = tenantDb(trx, tenant);

  const advanceRows = (await db.table('recurring_service_periods')
    .where('due_position', 'advance')
    .whereIn('charge_family', ['hourly', 'usage'])
    .where((builder) => {
      builder
        .where((billed) => billed.where('lifecycle_state', 'billed').whereNull('invoice_charge_detail_id'))
        .orWhere((retired) => retired
          .where('lifecycle_state', 'superseded')
          .where('reason_code', HOURLY_USAGE_ARREARS_REPAIR_REASON)
          .whereNull('invoice_id'));
    })
    .select(
      'record_id', 'obligation_id', 'schedule_key', 'period_key', 'charge_family',
      'service_period_start', 'service_period_end', 'invoice_window_start', 'invoice_window_end',
      'lifecycle_state', 'due_position', 'invoice_id',
    )) as StrandedPeriodRow[];
  if (advanceRows.length === 0) {
    return [];
  }

  const lineIds = Array.from(new Set(advanceRows.map((row) => row.obligation_id)));
  const coverRows = (await db.table('recurring_service_periods')
    .whereIn('obligation_id', lineIds)
    // A cadence block fee is another stream of the line; it never covers hourly work.
    .whereNot('charge_family', 'prepaid_block')
    .where((builder) => {
      builder
        .where((arrears) => arrears
          .where('due_position', 'arrears')
          .whereNotIn('lifecycle_state', ['superseded', 'archived']))
        .orWhere('lifecycle_state', 'billed');
    })
    .select('obligation_id', 'due_position', 'lifecycle_state', 'service_period_start', 'service_period_end')) as StrandedPeriodRow[];
  const arrearsSpans = new Set(
    coverRows.filter((row) => row.due_position === 'arrears').map((row) => spanKey(row.obligation_id, row)),
  );
  const billedSpans = new Set(
    coverRows.filter((row) => row.lifecycle_state === 'billed').map((row) => spanKey(row.obligation_id, row)),
  );

  const candidates: Array<{ row: StrandedPeriodRow; detail: string }> = [];
  const seenSpans = new Set<string>();
  for (const row of advanceRows) {
    const key = spanKey(row.obligation_id, row);
    if (arrearsSpans.has(key) || seenSpans.has(key)) continue;
    if (row.lifecycle_state === 'billed') {
      if (!(await hasUninvoicedActivity(
        trx,
        tenant,
        row.obligation_id,
        // LEVERAGE: pattern line-recurring-streams — normalizes a persisted family string, not a line type; fold once persisted rows carry a stream
        resolveRecurringChargeFamily(row.charge_family),
        dateOnly(row.service_period_start),
        dateOnly(row.service_period_end),
      ))) {
        continue;
      }
      candidates.push({ row, detail: BILLED_EMPTY_ADVANCE_DETAIL });
    } else {
      // A billed row on the same span is the first case's business (or deliberately empty).
      if (billedSpans.has(key)) continue;
      candidates.push({ row, detail: RETIRED_ADVANCE_DETAIL });
    }
    seenSpans.add(key);
  }
  if (candidates.length === 0) {
    return [];
  }

  const clientByLineId = new Map<string, { clientId: string; clientName: string | null }>();
  const ownerQuery = db.table('contract_lines as cl');
  db.tenantJoin(ownerQuery, 'client_contracts as cc', 'cc.contract_id', 'cl.contract_id');
  db.tenantJoin(ownerQuery, 'clients as c', 'c.client_id', 'cc.client_id');
  const owners = await ownerQuery
    .whereIn('cl.contract_line_id', Array.from(new Set(candidates.map(({ row }) => row.obligation_id))))
    .select('cl.contract_line_id as contract_line_id', 'cc.client_id as client_id', 'c.client_name as client_name');
  for (const owner of owners as Array<{ contract_line_id: string; client_id: string; client_name: string | null }>) {
    if (!clientByLineId.has(owner.contract_line_id)) {
      clientByLineId.set(owner.contract_line_id, { clientId: owner.client_id, clientName: owner.client_name });
    }
  }

  return candidates.flatMap(({ row, detail }) => {
    const client = clientByLineId.get(row.obligation_id);
    if (!client) return [];
    const identityKey = `stranded-arrears-only-line:${row.record_id}`;
    return [{
      executionIdentityKey: identityKey,
      selectionKey: identityKey,
      clientId: client.clientId,
      clientName: client.clientName,
      scheduleKey: row.schedule_key,
      periodKey: row.period_key,
      invoiceWindowStart: dateOnly(row.invoice_window_start) as ISO8601String,
      invoiceWindowEnd: dateOnly(row.invoice_window_end) as ISO8601String,
      servicePeriodStart: dateOnly(row.service_period_start) as ISO8601String,
      servicePeriodEnd: dateOnly(row.service_period_end) as ISO8601String,
      reason: 'stranded_arrears_only_line' as const,
      detail,
    }];
  });
}
