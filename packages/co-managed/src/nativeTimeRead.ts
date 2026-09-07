import type { Knex } from 'knex';
import { tenantDb, withTransaction } from '@alga-psa/db';
import { productTimeEntryMode } from '@alga-psa/types';
import { getCoManagedOperationalState } from '@alga-psa/licensing';
import { hasCoManagedConversationOwnership } from './nativeConversationEvents';
import { lockCoManagedLocalAuthentication, snapshotCoManagedAuthenticatedActor, type CoManagedAuthenticatedActor } from './localAuthentication';
import { admitCoManagedNativeTimeSource, isNativeTimeFieldHidden } from './nativeTimeEntryAccess';
import { hasCoManagedLocalPermission } from './localPermission';
import { CoManagedSharedWorkError, isCoManagedUuid } from './sharedWorkIdentity';

type NativeTimeReadResult = { handled: false } | { handled: true; entry: any | null };

/** Ordinary PSA readers keep their existing contract. Customer-owned history
 * remains on this boundary after a paid upgrade. Credential adapters are only
 * invoked inside the retained read, never taken from request body fields. */
export async function readCoManagedNativeTimeEntry(db: Knex, tenant: string, entryId: string,
  identify: () => Promise<CoManagedAuthenticatedActor>): Promise<NativeTimeReadResult> {
  if (!isCoManagedUuid(tenant) || !isCoManagedUuid(entryId)) throw new CoManagedSharedWorkError();
  return withTransaction(db, async trx => {
    await getCoManagedOperationalState(trx, tenant);
    const owner = tenantDb(trx, tenant);
    const workspace = await owner.table('tenants').forShare().first('product_code', 'suspended_at');
    const hint = await owner.table('time_entries').where('entry_id', entryId).first();
    if (workspace?.product_code !== 'co_managed' && hint?.billing_mode !== 'operational' && !await hasCoManagedConversationOwnership(trx, tenant)) return { handled: false };
    if (!workspace || workspace.suspended_at || !productTimeEntryMode(workspace.product_code)) throw new CoManagedSharedWorkError();
    const actor = snapshotCoManagedAuthenticatedActor(await identify());
    if (actor.tenant !== tenant) throw new CoManagedSharedWorkError();
    const credential = await lockCoManagedLocalAuthentication(trx, actor);
    if (!await hasCoManagedLocalPermission(trx, actor, 'time_entry', 'read', true)) throw new CoManagedSharedWorkError();
    if (!hint) { await credential.assertCurrent(); return { handled: true, entry: null }; }
    // Source locks precede the completed entry lock, matching native writers.
    const access = await admitCoManagedNativeTimeSource(trx, actor, { ...hint, work_item_id: hint.work_item_id || '__non_billable__' }, 'read');
    const entry = await owner.table('time_entries').where('entry_id', entryId).forShare().first();
    if (!entry || ['user_id', 'work_item_id', 'work_item_type', 'time_sheet_id', 'billing_mode'].some(field => entry[field] !== hint[field])) throw new CoManagedSharedWorkError();
    const hidden = (fields: string[]) => isNativeTimeFieldHidden(access.redactedTimeFields, fields);
    // These fields are required to represent an editable native interval. Do
    // not invent placeholder identity, dates or durations for hidden values.
    if (hidden(['entry_id', 'tenant', 'user_id', 'work_item_id', 'work_item_type', 'billing_mode', 'start_time', 'end_time',
      'work_date', 'work_timezone', 'created_at', 'updated_at', 'duration', 'duration_hours', 'elapsed_minutes'])) throw new CoManagedSharedWorkError();
    const minutes = Math.max(0, Math.round((new Date(entry.end_time).getTime() - new Date(entry.start_time).getTime()) / 60000));
    const result: any = { ...entry, duration_hours: Math.round(minutes / 60 * 100) / 100, elapsed_minutes: minutes,
      is_billable: entry.billable_duration > 0, workItem: { ...access.workItem, is_billable: entry.billable_duration > 0 } };
    for (const field of ['start_time', 'end_time', 'created_at', 'updated_at']) result[field] = new Date(entry[field]).toISOString();
    result.work_date = entry.work_date instanceof Date ? entry.work_date.toISOString().slice(0, 10) : entry.work_date;
    const financial = new Set(['service_id', 'tax_region', 'tax_rate_id', 'tax_percentage', 'contract_line_id', 'contract_line_source', 'contract_line_unresolved_reason', 'billable_duration', 'is_billable', 'invoiced']);
    for (const field of Object.keys(entry)) if (hidden([field, ...(financial.has(field) ? ['billing'] : [])])) result[field] = field === 'notes' ? '' : null;
    if (hidden(['billing', 'billable_duration', 'is_billable'])) { result.is_billable = null; delete result.workItem.is_billable; }
    if (hidden(['workItem', 'work_item', 'work_item_title'])) result.workItem = { work_item_id: access.workItem.work_item_id, type: access.workItem.type, name: '', description: '', is_billable: false };
    await access.assertCurrent(); await credential.assertCurrent();
    return { handled: true, entry: result };
  });
}
