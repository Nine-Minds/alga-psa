import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { TimeEntryBillingModeError, type CoManagedTimeEntryMode } from '@alga-psa/types';
import { isCoManagedUuid } from './sharedWorkIdentity';

// The mode primitives live in @alga-psa/types (below scheduling and co-managed); re-exported so this subpath's API is unchanged.
export { TimeEntryBillingModeError, operationalTimeEntryFields, serviceRequiredForTimeEntry } from '@alga-psa/types';
export type { CoManagedTimeEntryMode } from '@alga-psa/types';

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
