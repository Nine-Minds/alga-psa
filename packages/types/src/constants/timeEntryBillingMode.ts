/**
 * Per-entry time-entry billing mode primitives (CM L6a2).
 *
 * These are plain TypeScript with no database or server dependency. They live in `@alga-psa/types`, below both
 * the co-managed package and `@alga-psa/scheduling`, so scheduling can use them without importing co-managed
 * (co-managed already reaches scheduling's time source, so that import would form a package cycle).
 * The co-managed package's `timeEntryBillingMode` module re-exports them and keeps the database-backed readers.
 * Native files (this directory included) never name that package; noCoManagedNativeImports.contract.test.ts enforces it.
 */

/**
 * Per-entry billing mode (CM L6a2). `commercial` is every entry that exists today and is the column
 * default; `operational` is customer-side effort that records time and is never invoiced.
 * Defined in `@alga-psa/types` so scheduling and co-managed share one definition without depending on each other.
 */
export type CoManagedTimeEntryMode = 'commercial' | 'operational';

export class TimeEntryBillingModeError extends Error {
  constructor(readonly code: 'TIME_ENTRY_UNAVAILABLE' | 'OPERATIONAL_TIME_COMMERCIAL_FIELDS' | 'TIME_ENTRY_NOT_FOUND') {
    super(code); this.name = 'TimeEntryBillingModeError';
  }
}

/**
 * Actual effort stays in the start/end instants; billable minutes never stand in for customer
 * duration. An explicit commercial field on an operational entry is rejected, not ignored, so an
 * operational row can never carry anything an invoice could pick up.
 */
export function operationalTimeEntryFields(input: { service_id?: unknown; contract_line_id?: unknown; tax_rate_id?: unknown; tax_region?: unknown }) {
  if ([input.service_id, input.contract_line_id, input.tax_rate_id, input.tax_region].some(value => value != null && value !== '')) {
    throw new TimeEntryBillingModeError('OPERATIONAL_TIME_COMMERCIAL_FIELDS');
  }
  return { billing_mode: 'operational' as const, billable_duration: 0, service_id: null, contract_line_id: null,
    contract_line_source: null, contract_line_unresolved_reason: null, tax_rate_id: null, tax_region: null, invoiced: false };
}

/**
 * The one place the `service_id` rule lives (R3). Required for everyone, except an operational
 * entry written by a participating tenant. Enforced in the provider, never in the schema, so the
 * non-participating path keeps today's validation byte for byte.
 */
export function serviceRequiredForTimeEntry(input: { participates: boolean; mode: CoManagedTimeEntryMode }): boolean {
  return !(input.participates && input.mode === 'operational');
}

/**
 * The one commercial-read predicate (S28 / F068). Every query that feeds billing runs, invoice previews,
 * unbilled-time lists or timesheet approval reads `time_entries` through this, so an operational
 * (seat-technician) entry can never be collected, priced, listed as unbilled or put in front of an approver.
 *
 * It is a data-correctness guard, not a feature: it is deliberately NOT gated by any flag. Operational rows
 * only exist for seat technicians, so on a tenant without seats the predicate removes nothing.
 * `billing_mode` is NOT NULL (default `commercial`), so `<>` needs no NULL branch.
 * `src/test/commercialTimeEntryCoverage.static.test.ts` (billing) fails when a commercial read skips it.
 */
export const commercialTimeEntrySql = (alias = 'time_entries'): string => `${alias}.billing_mode <> 'operational'`;

/** Knex-shaped (structural, so this package keeps no knex dependency): `query.whereRaw(commercialTimeEntrySql(alias))`. */
export function commercialTimeEntriesOnly<Q extends { whereRaw(sql: string): Q }>(query: Q, alias = 'time_entries'): Q {
  return query.whereRaw(commercialTimeEntrySql(alias));
}

/** The same rule for a row already in memory (a rollup over rows read without the SQL predicate). */
export const isCommercialTimeEntry = (row: { billing_mode?: string | null }): boolean => row.billing_mode !== 'operational';

/**
 * The billable minutes an entry stands for, by the same rule: an operational entry is never billable, whatever
 * its stored `billable_duration` says. Display summaries (the ticket's Time logged tile and Timeline) report this
 * value, so no "Billable" chip is shown for operational time.
 */
export const billableMinutesOf = (row: { billing_mode?: string | null; billable_duration?: number | string | null }): number =>
  isCommercialTimeEntry(row) ? Number(row.billable_duration) || 0 : 0;

/**
 * The operational counterpart of `commercialTimeEntrySql`: only customer-side (seat technician) effort.
 * Used where a reader may see operational time and nothing commercial (S28 / F069: a seat technician's time tile and timeline).
 */
export const operationalTimeEntrySql = (alias = 'time_entries'): string => `${alias}.billing_mode = 'operational'`;

/** Knex-shaped: `query.whereRaw(operationalTimeEntrySql(alias))`. */
export function operationalTimeEntriesOnly<Q extends { whereRaw(sql: string): Q }>(query: Q, alias = 'time_entries'): Q {
  return query.whereRaw(operationalTimeEntrySql(alias));
}
