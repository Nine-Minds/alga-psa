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
