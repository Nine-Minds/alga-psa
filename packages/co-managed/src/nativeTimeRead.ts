import type { Knex } from 'knex';
import { tenantDb, withTransaction } from '@alga-psa/db';
import { toCalendarDateString } from '@alga-psa/core';
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
    const { entry } = await readNativeTimeEntry(trx, actor, hint);
    await credential.assertCurrent();
    return { handled: true, entry };
  });
}

async function readNativeTimeEntry(trx: Knex.Transaction, actor: CoManagedAuthenticatedActor, hint: any, changes = false, collection = false) {
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
    if (collection) {
      result.client_id = hidden(['client', 'client_id', 'clientId']) ? null : access.clientId ?? null;
      result.user_name = null;
      if (!hidden(['user', 'user_id', 'user_name'])) {
        const user = await owner.table('users').where('user_id', entry.user_id).forShare().first('first_name', 'last_name');
        result.user_name = user ? `${user.first_name ?? ''} ${user.last_name ?? ''}`.trim() : null;
      }
      result.service_name = null;
      if (result.service_id && !hidden(['billing', 'service', 'service_id', 'service_name'])) {
        const service = await owner.table('service_catalog').where('service_id', result.service_id).forShare().first('service_name');
        result.service_name = service?.service_name ?? null;
      }
      result.work_item_title = result.workItem.name;
    }
    await access.assertCurrent();
    return { entry: result, fullContentVisible: access.redactedTimeFields.length === 0 && access.redactedSourceFields.length === 0 };
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
  identify: () => Promise<CoManagedAuthenticatedActor>, options: { view?: boolean; comments?: boolean; requireCompleteContent?: boolean; approval?: boolean; employee?: boolean; summary?: boolean } = {}
): Promise<{ handled: false } | { handled: true; entries: any[]; sheet?: any; comments: any[]; visibility: { completeEntries: boolean; redactedFields: readonly string[] } }> {
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
    if (options.approval) {
      const approval = await authorizeCoManagedLocalRecord(trx, actor, credential.subject, 'time_sheet', 'approve', { id: sheetId, ownerUserId: sheet.user_id, assignedUserIds: [sheet.user_id] });
      sheetPolicy.redactedFields = [...sheetPolicy.redactedFields, ...approval.redactedFields];
    }
    if (isNativeTimeFieldHidden(sheetPolicy.redactedFields, ['id', 'time_sheet_id', 'user_id', 'time_entries', 'entries', 'time_sheets.id', 'time_sheets.user_id', 'time_sheets.time_entries'])) throw new CoManagedSharedWorkError();
    const hints = await owner.table('time_entries').where({ time_sheet_id: sheetId }).orderBy('entry_id').select('*');
    const entries: any[] = [];
    let completeContent = true;
    for (const entry of hints) {
      try {
        if (entry.user_id !== sheet.user_id) throw new CoManagedSharedWorkError();
        const projected = await readNativeTimeEntry(trx, actor, entry, true);
        entries.push(projected.entry); completeContent &&= projected.fullContentVisible;
      } catch (error) { if (!(error instanceof CoManagedSharedWorkError)) throw error; completeContent = false; }
    }
    if (options.requireCompleteContent && !completeContent) throw new CoManagedSharedWorkError();
    const hidden = (fields: string[]) => isNativeTimeFieldHidden(sheetPolicy.redactedFields, fields.flatMap(field => [field, `time_sheets.${field}`]));
    let view: any;
    if (options.view) {
      if (hidden(['id', 'tenant', 'user_id', 'period_id', 'approval_status'])) throw new CoManagedSharedWorkError();
      view = { ...sheet };
      // Persistent sheet notes can mention every source, just like comments.
      if (!completeContent) delete view.notes;
      for (const field of Object.keys(view)) if (hidden([field])) delete view[field];
      for (const field of ['submitted_at', 'approved_at', 'created_at', 'updated_at']) if (field in view) view[field] = view[field] ? new Date(view[field]).toISOString() : undefined;
      if (!view.approved_by) delete view.approved_by;
      if (options.employee) {
        const employee = await owner.table('users').where('user_id', sheet.user_id).forShare().first('first_name', 'last_name', 'email');
        view.employee_name = hidden(['employee', 'employee_name', 'first_name', 'last_name', 'user_name']) ? '' : `${employee?.first_name ?? ''} ${employee?.last_name ?? ''}`.trim();
        view.employee_email = hidden(['employee', 'employee_email', 'email']) ? '' : employee?.email ?? '';
      }
      if (!hidden(['time_period', 'time_period.start_date', 'time_period.end_date', 'period_start_date', 'period_end_date'])) {
        const period = await owner.table('time_periods').where('period_id', sheet.period_id).forShare().first('period_id', 'start_date', 'end_date');
        if (!period) throw new CoManagedSharedWorkError();
        view.time_period = { tenant, period_id: period.period_id, start_date: toCalendarDateString(period.start_date), end_date: toCalendarDateString(period.end_date) };
      }
      if (!hidden(['entry_count', 'total_entries'])) view.entry_count = entries.length;
      if (!hidden(['total_hours', 'total_minutes', 'hoursEntered', 'hours_entered', 'duration', 'elapsed_minutes'])) {
        view.total_minutes = entries.reduce((sum, entry) => sum + entry.elapsed_minutes, 0); view.total_hours = view.total_minutes / 60;
      }
      if (options.summary) {
        const billable = hidden(['billing', 'billable_hours', 'summary.billable_hours']) || entries.some(entry => entry.billable_duration == null)
          ? null : entries.reduce((sum, entry) => sum + Number(entry.billable_duration), 0) / 60;
        view.billable_hours = billable;
        if (!hidden(['summary'])) {
          const group = (field: string) => Object.fromEntries(entries.reduce((counts, entry) => {
            if (entry[field] != null) counts.set(String(entry[field]), (counts.get(String(entry[field])) ?? 0) + 1);
            return counts;
          }, new Map<string, number>()));
          view.summary = { total_hours: hidden(['summary.total_hours']) ? null : view.total_hours ?? null, billable_hours: billable,
            non_billable_hours: hidden(['summary.non_billable_hours', 'non_billable_hours']) || view.total_hours == null || billable == null ? null : Math.max(0, view.total_hours - billable),
            entries_by_type: hidden(['summary.entries_by_type', 'entries_by_type']) ? {} : group('work_item_type'),
            entries_by_day: hidden(['summary.entries_by_day', 'entries_by_day']) ? {} : group('work_date'),
            approval_ready: hidden(['summary.approval_ready', 'approval_ready', 'entry_count', 'total_entries']) || entries.length !== hints.length ? null : entries.length > 0 };
        }
      }
    }
    // A sheet comment can mention any of its work. No entry filtering or field
    // masking can safely redact that free text, so withhold the whole stream.
    const comments = options.comments && completeContent && !hidden(['comments', 'time_sheet_comments', 'comment'])
      ? await readSheetComments(trx, tenant, sheetId, sheetPolicy.redactedFields) : [];
    // A scoped-out entry is omitted; an expired credential invalidates the
    // whole response, including an otherwise empty sheet.
    await credential.assertCurrent();
    entries.sort((a, b) => b.start_time.localeCompare(a.start_time) || a.entry_id.localeCompare(b.entry_id));
    return { handled: true, entries, sheet: view, comments, visibility: { completeEntries: entries.length === hints.length, redactedFields: sheetPolicy.redactedFields } };
  });
}

/** All collection consumers share detail authority and projection. Filtering,
 * counts and aggregation must operate on these projections, never raw hints.
 * Retain one credential through the complete read so expiry cannot produce a
 * misleading partial result. Ordinary independent PSA queries stay unchanged. */
export async function readCoManagedNativeTimeEntries(db: Knex, tenant: string,
  identify: () => Promise<CoManagedAuthenticatedActor>): Promise<{ handled: false } | { handled: true; entries: any[] }> {
  if (!isCoManagedUuid(tenant)) throw new CoManagedSharedWorkError();
  return withTransaction(db, async trx => {
    await getCoManagedOperationalState(trx, tenant);
    const owner = tenantDb(trx, tenant), workspace = await owner.table('tenants').forShare().first('product_code', 'suspended_at');
    const operational = await owner.table('time_entries').where('billing_mode', 'operational').first('entry_id');
    if (workspace?.product_code !== 'co_managed' && !operational && !await hasCoManagedConversationOwnership(trx, tenant)) return { handled: false };
    if (!workspace || workspace.suspended_at || !productTimeEntryMode(workspace.product_code)) throw new CoManagedSharedWorkError();
    const actor = snapshotCoManagedAuthenticatedActor(await identify());
    if (actor.tenant !== tenant) throw new CoManagedSharedWorkError();
    const credential = await lockCoManagedLocalAuthentication(trx, actor);
    if (!await hasCoManagedLocalPermission(trx, actor, 'time_entry', 'read', true)) throw new CoManagedSharedWorkError();
    const hints = await owner.table('time_entries').orderBy('entry_id').select('*'), entries: any[] = [];
    // Native writers acquire owners and sheets before source parents. Retain
    // the complete collection's owners/sheets in that order before its first
    // source, avoiding a later sheet wait while holding an earlier parent.
    await owner.table('users').whereIn('user_id', [...new Set(hints.map(row => row.user_id))]).orderBy('user_id').forShare().select('user_id');
    await owner.table('time_sheets').whereIn('id', [...new Set(hints.map(row => row.time_sheet_id).filter(Boolean))]).orderBy('id').forShare().select('id');
    for (const hint of hints) {
      try { entries.push((await readNativeTimeEntry(trx, actor, hint, false, true)).entry); }
      catch (error) { if (!(error instanceof CoManagedSharedWorkError)) throw error; }
    }
    await credential.assertCurrent();
    return { handled: true, entries };
  });
}

async function readSheetComments(trx: Knex.Transaction, tenant: string, sheetId: string, fields: readonly string[]) {
  const owner = tenantDb(trx, tenant);
  if (isNativeTimeFieldHidden(fields, ['comment_text', 'user_role', 'comments.comment_text', 'comments.user_role', 'time_sheet_comments.comment_text', 'time_sheet_comments.user_role', 'comments.comment', 'comments.comment_id', 'comments.user_id', 'comments.created_at',
    'comments.is_approver', 'time_sheet_comments.is_approver',
    'time_sheet_comments.comment', 'time_sheet_comments.comment_id', 'time_sheet_comments.user_id', 'time_sheet_comments.created_at'])) return [];
  const rows = await owner.table('time_sheet_comments').where('time_sheet_id', sheetId).orderBy('created_at', 'desc').orderBy('comment_id').forShare().select('*');
  const users = await owner.table('users').whereIn('user_id', [...new Set(rows.map(row => row.user_id))]).forShare().select('user_id', 'first_name', 'last_name');
  return rows.map(row => {
    const user = users.find(user => user.user_id === row.user_id);
    return { tenant, comment_id: row.comment_id, time_sheet_id: sheetId, user_id: row.user_id, comment: row.comment,
      created_at: new Date(row.created_at).toISOString(), is_approver: row.is_approver,
      user_name: isNativeTimeFieldHidden(fields, ['user_name', 'comments.user_name', 'time_sheet_comments.user_name']) ? undefined : `${user?.first_name ?? ''} ${user?.last_name ?? ''}`.trim() };
  });
}
