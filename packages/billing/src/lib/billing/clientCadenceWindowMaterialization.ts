import type { Knex } from 'knex';
import { tenantDb, withTransaction } from '@alga-psa/db';
import type { DuePosition } from '@alga-psa/types';
import { contractLineRecurringStreams, streamForChargeFamily } from '@alga-psa/shared/billingClients/contractLineTimingRule';
import { whereLiveRecurringContractLine } from '@alga-psa/shared/billingClients/liveClientCadenceRecurringLine';
import {
  isClientCadenceLineExpectedInWindow,
  loadClientCadenceContractBilledBoundaries,
} from '@alga-psa/shared/billingClients/clientCadenceScheduleRegeneration';

/**
 * Canonical client-cadence window materialization.
 *
 * A client's invoice window `[windowStart, windowEnd)` is served by a set of
 * persisted recurring_service_periods rows — one per (schedule, period). Both
 * the recurring due-work LISTING and every GENERATION path must agree on what
 * that canonical set is: the listing's month-end-close flag may only be
 * offered when generation would actually accept the window, and generation
 * refuses a window whose active lines are missing rows (a schedule change
 * that has not been rebuilt). These helpers are that single source of truth.
 */

export interface CanonicalClientCadenceWindowPeriod {
  scheduleKey: string;
  periodKey: string;
  duePosition: DuePosition;
  servicePeriodStart: string;
  servicePeriodEnd: string;
  invoiceWindowStart: string;
}

/**
 * Date columns hydrate from the pg driver as JavaScript `Date` objects; the
 * canonical rows are exposed as date-only strings so policy evaluation and
 * identity comparison never depend on driver hydration.
 */
function toDateOnly(value: unknown): string {
  return value instanceof Date
    ? value.toISOString().slice(0, 10)
    : String(value).slice(0, 10);
}

/**
 * Every persisted client-cadence service period served by the client's
 * invoice window, deduplicated to one entry per (schedule, period) — the
 * lowest revision, matching production selector resolution.
 */
export async function listCanonicalClientCadenceWindowPeriods(params: {
  knex: Knex;
  tenant: string;
  clientId: string;
  windowStart: string;
  windowEnd: string;
}): Promise<CanonicalClientCadenceWindowPeriod[]> {
  const windowStart = toDateOnly(params.windowStart);
  const windowEnd = toDateOnly(params.windowEnd);

  const rows = await withTransaction(params.knex, async (trx: Knex.Transaction) => {
    const db = tenantDb(trx, params.tenant);
    const query = db.table('recurring_service_periods as rsp');
    db.tenantJoin(query, 'contract_lines as cl', 'cl.contract_line_id', 'rsp.obligation_id');
    db.tenantJoin(query, 'contracts as ct', 'ct.contract_id', 'cl.contract_id');
    db.tenantJoin(query, 'clients as c', 'c.client_id', 'ct.owner_client_id');

    return query
      .where({
        'rsp.cadence_owner': 'client',
        'rsp.invoice_window_start': windowStart,
        'rsp.invoice_window_end': windowEnd,
        'c.client_id': params.clientId,
      })
      .whereNotIn('rsp.lifecycle_state', ['archived', 'superseded'])
      .orderBy('rsp.service_period_start', 'asc')
      .orderBy('rsp.revision', 'asc')
      .select(
        'rsp.schedule_key',
        'rsp.period_key',
        'rsp.due_position',
        'rsp.service_period_start',
        'rsp.service_period_end',
        'rsp.invoice_window_start',
      );
  });

  const seen = new Set<string>();
  const canonical: CanonicalClientCadenceWindowPeriod[] = [];
  for (const row of rows) {
    const scheduleKey = row.schedule_key as string | null;
    const periodKey = row.period_key as string | null;
    if (!scheduleKey || !periodKey) {
      continue;
    }
    const dedupeKey = `${scheduleKey}::${periodKey}`;
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);
    canonical.push({
      scheduleKey,
      periodKey,
      duePosition: row.due_position as DuePosition,
      servicePeriodStart: toDateOnly(row.service_period_start),
      servicePeriodEnd: toDateOnly(row.service_period_end),
      invoiceWindowStart: toDateOnly(row.invoice_window_start),
    });
  }

  return canonical;
}

/**
 * Contract-line ids of the client's ACTIVE client-cadence recurring lines
 * that have NO persisted service period for the window — a schedule change
 * that has not been rebuilt. Generation refuses such windows; the listing
 * must not offer month-end close for them.
 */
export async function listUnmaterializedClientCadenceWindowLineIds(params: {
  knex: Knex;
  tenant: string;
  clientId: string;
  windowStart: string;
  windowEnd: string;
}): Promise<string[]> {
  const windowStart = toDateOnly(params.windowStart);
  const windowEnd = toDateOnly(params.windowEnd);

  const activeRecurringLineRows = await withTransaction(
    params.knex,
    async (trx: Knex.Transaction) => {
      const db = tenantDb(trx, params.tenant);
      // Contract-scoped billed boundary: the same rule gap discovery uses, so
      // a line added to a billed contract is expected where its first period
      // actually lands, not where the raw assignment start implies.
      const boundaries = await loadClientCadenceContractBilledBoundaries(trx, {
        tenant: params.tenant,
        clientId: params.clientId,
      });
      const query = db.table('client_contracts as cc');
      db.tenantJoin(query, 'contracts as ct', 'ct.contract_id', 'cc.contract_id');
      db.tenantJoin(query, 'contract_lines as cl', 'cl.contract_id', 'ct.contract_id');
      db.tenantJoin(query, 'contract_line_prepaid_blocks as pb', 'pb.contract_line_id', 'cl.contract_line_id', { type: 'left' });

      whereLiveRecurringContractLine(
        query,
        // Unchanged from before: this guard never excluded system-managed
        // defaults.
        { excludeSystemManagedDefault: false },
      );

      const rows = await query
        .where({
          'cc.client_id': params.clientId,
          'cl.cadence_owner': 'client',
        })
        .whereNotNull('cl.billing_frequency')
        .whereNotNull('cl.billing_timing')
        .where('cc.start_date', '<', windowEnd)
        .where(function () {
          this.where('cc.end_date', '>=', windowStart)
            .orWhereNull('cc.end_date');
        })
        .select(
          'cl.contract_line_id',
          'cl.contract_id',
          'cl.billing_timing',
          'cl.contract_line_type',
          'pb.issue_mode as prepaid_block_issue_mode',
          'cc.start_date',
          'cc.end_date',
        );
      return rows.map((row) => ({
        ...row,
        billed_boundary_end: boundaries.get(row.contract_id) ?? null,
      }));
    },
  );

  const fallbackStart = new Date().toISOString();
  // One expectation per (line, stream): a cadence-mode block fee is its own
  // schedule, so a line with only its hourly stream materialized is still short.
  const expectedStreams = new Map<string, Set<string>>();
  for (const row of activeRecurringLineRows) {
    if (!row.contract_line_id) {
      continue;
    }
    for (const entry of contractLineRecurringStreams(
      row,
      { issue_mode: row.prepaid_block_issue_mode ?? null },
    )) {
      // Only lines whose assignment actually has a service period settling in
      // this window are expected: an arrears line assigned at (or after) the
      // window start bills its first period in a later window, and demanding
      // materialization for it would falsely block every other line here.
      const expected = isClientCadenceLineExpectedInWindow({
        duePosition: entry.duePosition,
        assignmentStart: row.start_date,
        assignmentEnd: row.end_date ? toDateOnly(row.end_date) : null,
        billedBoundaryEnd: row.billed_boundary_end,
        fallbackStart,
        windowStart,
        windowEnd,
      });
      if (expected) {
        const set = expectedStreams.get(row.contract_line_id) ?? new Set<string>();
        set.add(entry.stream);
        expectedStreams.set(row.contract_line_id, set);
      }
    }
  }
  const activeRecurringLineIds = [...expectedStreams.keys()];
  if (activeRecurringLineIds.length === 0) {
    return [];
  }

  const materializedRows = await withTransaction(
    params.knex,
    async (trx: Knex.Transaction) =>
      tenantDb(trx, params.tenant).table('recurring_service_periods')
        .where({
          cadence_owner: 'client',
          invoice_window_start: windowStart,
          invoice_window_end: windowEnd,
        })
        .whereIn('obligation_id', activeRecurringLineIds)
        .whereNotIn('lifecycle_state', ['archived', 'superseded'])
        .select('obligation_id', 'charge_family'),
  );

  const materialized = new Set(
    materializedRows
      .filter((row) => Boolean(row.obligation_id))
      .map((row) => `${row.obligation_id}|${streamForChargeFamily(row.charge_family)}`),
  );

  return activeRecurringLineIds.filter((lineId) =>
    [...(expectedStreams.get(lineId) ?? [])].some((stream) => !materialized.has(`${lineId}|${stream}`)),
  );
}
