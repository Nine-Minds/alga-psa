import type { Knex } from 'knex';
import { tenantDb, withTransaction } from '@alga-psa/db';
import { productTimeEntryMode } from '@alga-psa/types';
import { getCoManagedOperationalState } from '@alga-psa/licensing';
import { hasCoManagedConversationOwnership } from './nativeConversationEvents';
import { lockCoManagedLocalAuthentication, snapshotCoManagedAuthenticatedActor, type CoManagedAuthenticatedActor } from './localAuthentication';
import { admitCoManagedNativeTimeSource, admitCoManagedNativeTimeOwner, isNativeTimeFieldHidden } from './nativeTimeEntryAccess';
import { hasCoManagedLocalPermission } from './localPermission';
import { CoManagedSharedWorkError, isCoManagedUuid, authorizeCoManagedLocalRecord } from './sharedWorkIdentity';

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
    const entry = await readNativeTimeEntry(trx, actor, hint);
    await credential.assertCurrent();
    return { handled: true, entry };
  });
}

async function readNativeTimeEntry(trx: Knex.Transaction, actor: CoManagedAuthenticatedActor, hint: any, changes = false) {
    const owner = tenantDb(trx, actor.tenant);
    // Source locks precede the completed entry lock, matching native writers.
    const access = await admitCoManagedNativeTimeSource(trx, actor, { ...hint, work_item_id: hint.work_item_id || '__non_billable__' }, 'read');
    const entry = await owner.table('time_entries').where('entry_id', hint.entry_id).forShare().first();
    if (!entry || ['user_id', 'work_item_id', 'work_item_type', 'time_sheet_id', 'billing_mode'].some(field => entry[field] !== hint[field])) throw new CoManagedSharedWorkError();
    const hidden = (fields: string[]) => isNativeTimeFieldHidden(access.redactedTimeFields, fields);
    // These fields are required to represent an editable native interval. Do
    // not invent placeholder identity, dates or durations for hidden values.
    if (hidden(['entry_id', 'tenant', 'user_id', 'work_item_id', 'work_item_type', 'billing_mode', 'start_time', 'end_time',
      'work_date', 'work_timezone', 'created_at', 'updated_at', 'duration', 'duration_hours', 'elapsed_minutes'])) throw new CoManagedSharedWorkError();
    const minutes = Math.max(0, Math.round((new Date(entry.end_time).getTime() - new Date(entry.start_time).getTime()) / 60000));
    const result: any = { ...entry, date: new Date(entry.start_time), duration_hours: Math.round(minutes / 60 * 100) / 100, elapsed_minutes: minutes,
      is_billable: entry.billable_duration > 0, workItem: { ...access.workItem, is_billable: entry.billable_duration > 0 } };
    for (const field of ['start_time', 'end_time', 'created_at', 'updated_at']) result[field] = new Date(entry[field]).toISOString();
    result.work_date = entry.work_date instanceof Date ? entry.work_date.toISOString().slice(0, 10) : entry.work_date;
    const financial = new Set(['service_id', 'tax_region', 'tax_rate_id', 'tax_percentage', 'contract_line_id', 'contract_line_source', 'contract_line_unresolved_reason', 'billable_duration', 'is_billable', 'invoiced']);
    for (const field of Object.keys(entry)) if (hidden([field, ...(financial.has(field) ? ['billing'] : [])])) result[field] = field === 'notes' ? '' : null;
    if (hidden(['billing', 'billable_duration', 'is_billable'])) { result.is_billable = null; delete result.workItem.is_billable; }
    if (entry.work_item_type === 'non_billable_category' && !hidden(['notes'])) result.workItem.name = typeof entry.notes === 'string' ? entry.notes.trim() : '';
    if (hidden(['workItem', 'work_item', 'work_item_title'])) result.workItem = { work_item_id: access.workItem.work_item_id, type: access.workItem.type, name: '', description: '', is_billable: false };
    if (changes) {
      if (entry.work_item_type === 'non_billable_category' && !entry.work_item_id) result.work_item_id = '__non_billable__';
      const requests = hidden(['notes', 'change_requests', 'latest_change_request', 'change_request_state']) ? [] : await readChangeRequests(trx, actor.tenant, entry);
      result.change_requests = requests;
      result.latest_change_request = requests[0];
      result.change_request_state = requests.length ? requests.some((request: any) => !request.handled_at) ? 'unresolved' : 'handled' : null;
    }
    await access.assertCurrent();
    return result;
}

async function readChangeRequests(trx: Knex.Transaction, tenant: string, entry: any) {
  const owner = tenantDb(trx, tenant);
  const requests = await owner.table('time_entry_change_requests').where({ time_entry_id: entry.entry_id, time_sheet_id: entry.time_sheet_id })
    .orderBy('created_at', 'desc').orderBy('change_request_id').forShare().select('*');
  const authors = await owner.table('users').whereIn('user_id', [...new Set(requests.map(row => row.created_by))]).forShare().select('user_id', 'first_name', 'last_name');
  const iso = (value: any) => value ? new Date(value).toISOString() : undefined;
  return requests.map(row => {
    const author = authors.find(user => user.user_id === row.created_by);
    return { change_request_id: row.change_request_id, time_entry_id: row.time_entry_id, time_sheet_id: row.time_sheet_id, comment: row.comment,
      created_at: iso(row.created_at), created_by: row.created_by, created_by_name: `${author?.first_name ?? ''} ${author?.last_name ?? ''}`.trim(),
      handled_at: iso(row.handled_at), handled_by: row.handled_by ?? undefined, tenant };
  });
}

/** A timesheet is a collection of independently admitted work records. Hidden
 * entries and their review comments never enter the returned collection. */
export async function readCoManagedNativeTimeSheet(db: Knex, tenant: string, sheetId: string,
  identify: () => Promise<CoManagedAuthenticatedActor>): Promise<{ handled: false } | { handled: true; entries: any[] }> {
  if (!isCoManagedUuid(tenant) || !isCoManagedUuid(sheetId)) throw new CoManagedSharedWorkError();
  return withTransaction(db, async trx => {
    await getCoManagedOperationalState(trx, tenant);
    const owner = tenantDb(trx, tenant), workspace = await owner.table('tenants').forShare().first('product_code', 'suspended_at');
    const operational = await owner.table('time_entries').where({ time_sheet_id: sheetId, billing_mode: 'operational' }).first('entry_id');
    if (workspace?.product_code !== 'co_managed' && !operational && !await hasCoManagedConversationOwnership(trx, tenant)) return { handled: false };
    if (!workspace || workspace.suspended_at || !productTimeEntryMode(workspace.product_code)) throw new CoManagedSharedWorkError();
    const actor = snapshotCoManagedAuthenticatedActor(await identify());
    if (actor.tenant !== tenant) throw new CoManagedSharedWorkError();
    const credential = await lockCoManagedLocalAuthentication(trx, actor);
    if (!await hasCoManagedLocalPermission(trx, actor, 'time_entry', 'read', true)) throw new CoManagedSharedWorkError();
    const hint = await owner.table('time_sheets').where('id', sheetId).first('user_id');
    if (!hint) throw new CoManagedSharedWorkError();
    await admitCoManagedNativeTimeOwner(trx, actor, credential.subject, hint.user_id, true);
    const sheet = await owner.table('time_sheets').where('id', sheetId).forShare().first();
    if (!sheet || sheet.user_id !== hint.user_id) throw new CoManagedSharedWorkError();
    const sheetPolicy = await authorizeCoManagedLocalRecord(trx, actor, credential.subject, 'time_sheet', 'read', { id: sheetId, ownerUserId: sheet.user_id, assignedUserIds: [sheet.user_id] });
    if (isNativeTimeFieldHidden(sheetPolicy.redactedFields, ['id', 'time_sheet_id', 'user_id', 'time_entries', 'entries', 'time_sheets.id', 'time_sheets.user_id', 'time_sheets.time_entries'])) throw new CoManagedSharedWorkError();
    const hints = await owner.table('time_entries').where({ time_sheet_id: sheetId, user_id: sheet.user_id }).orderBy('entry_id').select('*');
    const entries: any[] = [];
    for (const entry of hints) {
      try { entries.push(await readNativeTimeEntry(trx, actor, entry, true)); }
      catch (error) { if (!(error instanceof CoManagedSharedWorkError)) throw error; }
    }
    // A scoped-out entry is omitted; an expired credential invalidates the
    // whole response, including an otherwise empty sheet.
    await credential.assertCurrent();
    entries.sort((a, b) => b.start_time.localeCompare(a.start_time) || a.entry_id.localeCompare(b.entry_id));
    return { handled: true, entries };
  });
}
