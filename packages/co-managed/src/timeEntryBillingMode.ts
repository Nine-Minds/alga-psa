import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { productTimeEntryMode, type TimeEntryBillingMode } from '@alga-psa/types';
import { assertCoManagedOperationalWrite } from '@alga-psa/licensing';
import { isCoManagedUuid } from './sharedWorkIdentity';

export class TimeEntryBillingModeError extends Error {
  constructor(readonly code: 'TIME_ENTRY_PRODUCT_UNAVAILABLE' | 'OPERATIONAL_TIME_COMMERCIAL_FIELDS' | 'TIME_ENTRY_NOT_FOUND') {
    super(code); this.name = 'TimeEntryBillingModeError';
  }
}

/** Billing-mode admission only. Callers separately retain actor, work-item and
 * timesheet authority and keep this transaction through their native mutation. */
export async function lockTimeEntryBillingMode(trx: Knex.Transaction, tenant: string, entryId?: string | null): Promise<TimeEntryBillingMode> {
  if (!trx.isTransaction || !isCoManagedUuid(tenant) || (entryId != null && !isCoManagedUuid(entryId))) throw new TimeEntryBillingModeError('TIME_ENTRY_PRODUCT_UNAVAILABLE');
  await assertCoManagedOperationalWrite(trx, tenant);
  const home = tenantDb(trx, tenant), workspace = await home.table('tenants').forShare().first('product_code');
  const mode = workspace && productTimeEntryMode(workspace.product_code);
  if (!mode) throw new TimeEntryBillingModeError('TIME_ENTRY_PRODUCT_UNAVAILABLE');
  if (!entryId) return mode;
  const entry = await home.table('time_entries').where('entry_id', entryId).forUpdate().first('billing_mode');
  if (!entry) throw new TimeEntryBillingModeError('TIME_ENTRY_NOT_FOUND');
  return entry.billing_mode === 'operational' ? 'operational' : mode;
}

/** Actual effort remains in start/end instants; billable minutes never stand
 * in for customer duration. An explicit commercial selection is rejected. */
export function operationalTimeEntryFields(input: { service_id?: unknown; contract_line_id?: unknown; tax_rate_id?: unknown; tax_region?: unknown }) {
  if ([input.service_id, input.contract_line_id, input.tax_rate_id, input.tax_region].some(value => value != null && value !== '')) throw new TimeEntryBillingModeError('OPERATIONAL_TIME_COMMERCIAL_FIELDS');
  return { billing_mode: 'operational' as const, billable_duration: 0, service_id: null, contract_line_id: null,
    contract_line_source: null, contract_line_unresolved_reason: null, tax_rate_id: null, tax_region: null, invoiced: false };
}
