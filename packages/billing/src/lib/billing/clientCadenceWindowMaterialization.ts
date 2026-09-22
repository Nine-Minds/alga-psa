import type { Knex } from 'knex';
import { tenantDb, withTransaction } from '@alga-psa/db';
import type { DuePosition } from '@alga-psa/types';
import { POST_DROP_RECURRING_OBLIGATION_TYPES } from '@alga-psa/shared/billingClients/postDropRecurringObligationIdentity';
import { isRecurringLineExpectedInClientCadenceWindow } from '@alga-psa/shared/billingClients/recurringTiming';

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
      .whereIn('rsp.obligation_type', [...POST_DROP_RECURRING_OBLIGATION_TYPES])
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
      const query = db.table('client_contracts as cc');
      db.tenantJoin(query, 'contracts as ct', 'ct.contract_id', 'cc.contract_id');
      db.tenantJoin(query, 'contract_lines as cl', 'cl.contract_id', 'ct.contract_id');

      return query
        .where({
          'cc.client_id': params.clientId,
          'cc.is_active': true,
          'cl.cadence_owner': 'client',
        })
        .whereNotNull('cl.billing_frequency')
        .whereNotNull('cl.billing_timing')
        .where('cc.start_date', '<', windowEnd)
        .where(function () {
          this.where('cc.end_date', '>=', windowStart)
            .orWhereNull('cc.end_date');
        })
        .select('cl.contract_line_id', 'cl.billing_timing', 'cc.start_date', 'cc.end_date');
    },
  );

  const activeRecurringLineIds = Array.from(
    new Set(
      activeRecurringLineRows
        // Only lines whose assignment actually has a service period settling in
        // this window are expected: an arrears line assigned at (or after) the
        // window start bills its first period in a later window, and demanding
        // materialization for it would falsely block every other line here.
        .filter((row) =>
          isRecurringLineExpectedInClientCadenceWindow({
            duePosition: row.billing_timing === 'arrears' ? 'arrears' : 'advance',
            assignmentStart: toDateOnly(row.start_date),
            assignmentEnd: row.end_date ? toDateOnly(row.end_date) : null,
            windowStart,
            windowEnd,
          }),
        )
        .map((row) => row.contract_line_id)
        .filter((value): value is string => Boolean(value)),
    ),
  );
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
        .whereIn('obligation_type', [...POST_DROP_RECURRING_OBLIGATION_TYPES])
        .whereIn('obligation_id', activeRecurringLineIds)
        .whereNotIn('lifecycle_state', ['archived', 'superseded'])
        .select('obligation_id'),
  );

  const materializedLineIds = new Set(
    materializedRows
      .map((row) => row.obligation_id)
      .filter((value): value is string => Boolean(value)),
  );

  return activeRecurringLineIds.filter((lineId) => !materializedLineIds.has(lineId));
}
