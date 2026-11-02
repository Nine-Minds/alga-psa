import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { isCoManagedUuid } from './sharedWorkIdentity';

/**
 * Per-entry billing mode (CM L6a2). `commercial` is every entry that exists today and is the column
 * default; `operational` is customer-side effort that records time and is never invoiced.
 * Kept local so this package does not depend on the scheduling package's types.
 */
export type CoManagedTimeEntryMode = 'commercial' | 'operational';

export class TimeEntryBillingModeError extends Error {
  constructor(readonly code: 'TIME_ENTRY_UNAVAILABLE' | 'OPERATIONAL_TIME_COMMERCIAL_FIELDS' | 'TIME_ENTRY_NOT_FOUND') {
    super(code); this.name = 'TimeEntryBillingModeError';
  }
}

/**
 * Serialises a billing-mode decision against a concurrent write on ONE entry (a primary-key row
 * lock). Deliberately takes no lock on the `tenants` row and runs no tenant-wide probe
 * (DO-NOT-PORT #17): the mode is a property of the entry, not of the workspace.
 */
export async function lockTimeEntryBillingMode(trx: Knex.Transaction, tenant: string, entryId: string): Promise<CoManagedTimeEntryMode> {
  if (!trx.isTransaction || !isCoManagedUuid(tenant) || !isCoManagedUuid(entryId)) throw new TimeEntryBillingModeError('TIME_ENTRY_UNAVAILABLE');
  const entry = await tenantDb(trx, tenant).table('time_entries').where('entry_id', entryId).forUpdate().first('billing_mode');
  if (!entry) throw new TimeEntryBillingModeError('TIME_ENTRY_NOT_FOUND');
  return entry.billing_mode === 'operational' ? 'operational' : 'commercial';
}

/** Read without locking (display paths). */
export async function readTimeEntryBillingMode(db: Knex, tenant: string, entryId: string): Promise<CoManagedTimeEntryMode> {
  const entry = await tenantDb(db, tenant).table('time_entries').where('entry_id', entryId).first('billing_mode');
  return entry?.billing_mode === 'operational' ? 'operational' : 'commercial';
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
