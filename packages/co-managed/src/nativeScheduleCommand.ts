import type { Knex } from 'knex';
import { tenantDb, withTransaction, registerAfterCommit } from '@alga-psa/db';
import { assertCoManagedOperationalWrite } from '@alga-psa/licensing';
import { createAuthorizationKernel, BuiltinAuthorizationKernelProvider, BundleAuthorizationKernelProvider, resolveBundleNarrowingRulesForEvaluation,
  type AuthorizationRecord, type AuthorizationSubject } from '@alga-psa/authorization';
import ScheduleEntry from '@alga-psa/shared/models/scheduleEntry';
import { generateOccurrences } from '@alga-psa/shared/utils/recurrenceUtils';
import type { IEditScope } from '@alga-psa/types';
import { retainCoManagedTimeCalendar } from './nativeTimePeriod';
import { retainScheduleSource, isScheduleFieldHidden, scheduleView } from './nativeScheduleRead';
import { lockCoManagedLocalAuthentication, snapshotCoManagedAuthenticatedActor, type CoManagedAuthenticatedActor } from './localAuthentication';
import { authorizeCoManagedLocalRecord, matchesCoManagedScopeConstraints, CoManagedSharedWorkError, isCoManagedUuid } from './sharedWorkIdentity';
import { hasCoManagedLocalPermission } from './localPermission';

export class NativeScheduleError extends Error {
  constructor(readonly code: 'SCHEDULE_INVALID' | 'SCHEDULE_NOT_FOUND' | 'SCHEDULE_IN_USE' | 'SCHEDULE_OCCURRENCE_NOT_FOUND') {
    super(code === 'SCHEDULE_OCCURRENCE_NOT_FOUND' ? 'This schedule occurrence is no longer available' : code === 'SCHEDULE_INVALID' ? 'Invalid schedule entry' : code === 'SCHEDULE_NOT_FOUND' ? 'Schedule entry not found' : 'Schedule entry has recorded time or an active timer');
    this.name = 'NativeScheduleError';
  }
}
const writable = ['title', 'notes', 'scheduled_start', 'scheduled_end', 'status', 'work_item_id', 'work_item_type', 'assigned_user_ids', 'is_private', 'recurrence_pattern'] as const;
const invalid = () => { throw new NativeScheduleError('SCHEDULE_INVALID'); };
function instant(value: unknown) {
  if (!(typeof value === 'string' || value instanceof Date)) return invalid();
  const date = new Date(value); if (!Number.isFinite(date.getTime())) return invalid(); return date;
}
function recurrence(value: unknown) {
  if (value == null || value === '') return null;
  let pattern: any; try { pattern = typeof value === 'string' ? JSON.parse(value) : value; } catch { return invalid(); }
  if (!pattern || typeof pattern !== 'object' || Array.isArray(pattern) || !['daily', 'weekly', 'monthly', 'yearly'].includes(pattern.frequency) || !Number.isSafeInteger(pattern.interval) || pattern.interval < 1) return invalid();
  const startDate = instant(pattern.startDate), endDate = pattern.endDate == null ? undefined : instant(pattern.endDate);
  if (endDate && endDate < startDate) return invalid();
  for (const [name, min, max] of [['dayOfMonth', 1, 31], ['monthOfYear', 1, 12], ['count', 1, 2147483647]] as const) if (pattern[name] != null && (!Number.isSafeInteger(pattern[name]) || pattern[name] < min || pattern[name] > max)) return invalid();
  if (pattern.daysOfWeek !== undefined && (!Array.isArray(pattern.daysOfWeek) || !pattern.daysOfWeek.length || !pattern.daysOfWeek.every((day: unknown) => Number.isInteger(day) && Number(day) >= 0 && Number(day) <= 6))) return invalid();
  if (pattern.exceptions !== undefined && !Array.isArray(pattern.exceptions)) return invalid();
  if (pattern.workdaysOnly !== undefined && typeof pattern.workdaysOnly !== 'boolean') return invalid();
  return { frequency: pattern.frequency, interval: pattern.interval, startDate, ...(endDate ? { endDate } : {}),
    ...Object.fromEntries(['dayOfMonth', 'monthOfYear', 'count', 'workdaysOnly'].filter(key => pattern[key] != null).map(key => [key, pattern[key]])),
    ...(pattern.daysOfWeek ? { daysOfWeek: [...new Set(pattern.daysOfWeek)] } : {}),
    ...(pattern.exceptions ? { exceptions: pattern.exceptions.map(instant) } : {}),
  };
}
function normalize(input: Record<string, any>, existing: any, actor: CoManagedAuthenticatedActor) {
  const fields: Record<string, any> = Object.fromEntries(writable.filter(key => input[key] !== undefined).map(key => [key, input[key]]));
  const merged = { title: '', notes: '', status: 'scheduled', work_item_type: 'ad_hoc', work_item_id: null, assigned_user_ids: [actor.userId], is_private: false, recurrence_pattern: null, ...existing, ...fields };
  if (typeof merged.title !== 'string' || !merged.title.trim() || typeof merged.status !== 'string' || !merged.status.trim() || (merged.notes != null && typeof merged.notes !== 'string') || typeof merged.is_private !== 'boolean') return invalid();
  merged.notes ??= ''; merged.scheduled_start = instant(merged.scheduled_start); merged.scheduled_end = instant(merged.scheduled_end);
  if (merged.scheduled_end <= merged.scheduled_start) return invalid();
  if (['meeting', 'break', 'other'].includes(merged.work_item_type)) merged.work_item_type = 'ad_hoc';
  if (!['ad_hoc', 'ticket', 'project_task', 'interaction', 'non_billable_category', 'appointment_request'].includes(merged.work_item_type)) return invalid();
  if (['ad_hoc', 'non_billable_category'].includes(merged.work_item_type)) merged.work_item_id = null;
  else if (!isCoManagedUuid(merged.work_item_id)) return invalid();
  if (!Array.isArray(merged.assigned_user_ids) || !merged.assigned_user_ids.every(isCoManagedUuid)) return invalid();
  merged.assigned_user_ids = [...new Set(merged.assigned_user_ids)].sort();
  merged.recurrence_pattern = recurrence(merged.recurrence_pattern);
  if (input.work_item_type !== undefined) fields.work_item_id = merged.work_item_id;
  return { merged, patch: Object.fromEntries(Object.keys(fields).map(key => [key, merged[key]])) };
}

/** Own-calendar commands retain the established read permission, while the
 * authorization kernel evaluates the actual command action's bundle rules.
 * This mapping is derived from locked assignments, never a request flag. */
async function commandPolicy(trx: Knex.Transaction, actor: CoManagedAuthenticatedActor, subject: AuthorizationSubject,
  action: 'create' | 'update' | 'delete', record: AuthorizationRecord, own: boolean) {
  const kernel = createAuthorizationKernel({ builtinProvider: new BuiltinAuthorizationKernelProvider(),
    bundleProvider: new BundleAuthorizationKernelProvider({ resolveRules: input => resolveBundleNarrowingRulesForEvaluation(trx, input, { lock: true }) }),
    rbacEvaluator: () => hasCoManagedLocalPermission(trx, actor, 'user_schedule', own ? 'read' : action === 'delete' ? 'delete' : 'update', true),
  });
  const decision = await kernel.authorizeResource({ knex: trx, subject, resource: { type: 'user_schedule', action, id: record.id }, record });
  if (!decision.allowed || !matchesCoManagedScopeConstraints(decision.scope.constraints, record)) throw new CoManagedSharedWorkError();
  return decision;
}

type ScheduleCommand = { action: 'create'; data: Record<string, any> } | { action: 'update'; id: string; data: Record<string, any>; scope?: 'single' | 'future' | 'all' } | { action: 'delete'; id: string; scope?: 'single' | 'future' | 'all' };
export async function commandCoManagedNativeSchedule(db: Knex, tenant: string, input: ScheduleCommand, identify: () => Promise<CoManagedAuthenticatedActor>,
  publish: (event: { eventType: 'SCHEDULE_ENTRY_CREATED' | 'SCHEDULE_ENTRY_UPDATED' | 'SCHEDULE_ENTRY_DELETED'; payload: { tenantId: string; userId: string; entryId: string } }) => Promise<unknown>
): Promise<{ handled: false } | { handled: true; entry: any | null }> {
  input = structuredClone(input);
  const locator = input.action === 'create' ? [] : input.id.split('_');
  const masterId = locator[0], occurrenceTime = locator[1] === undefined ? null : Number(locator[1]);
  if (!isCoManagedUuid(tenant) || !['create', 'update', 'delete'].includes(input.action) ||
    (input.action !== 'create' && (!isCoManagedUuid(masterId) || locator.length > 2 || (input.scope !== undefined && !['single', 'future', 'all'].includes(input.scope)))) ||
    (occurrenceTime !== null && (!/^\d+$/.test(locator[1]) || !Number.isSafeInteger(occurrenceTime) || !Number.isFinite(new Date(occurrenceTime).getTime())))) return invalid();
  return withTransaction(db, async trx => {
    if (!await retainCoManagedTimeCalendar(trx, tenant)) return { handled: false };
    await assertCoManagedOperationalWrite(trx, tenant);
    const actor = snapshotCoManagedAuthenticatedActor(await identify()); if (actor.tenant !== tenant) throw new CoManagedSharedWorkError();
    const credential = await lockCoManagedLocalAuthentication(trx, actor), owner = tenantDb(trx, tenant);
    if (!await hasCoManagedLocalPermission(trx, actor, 'user_schedule', 'read', true)) throw new CoManagedSharedWorkError();
    const hint = input.action === 'create' ? null : await owner.table('schedule_entries').where('entry_id', masterId).first();
    if (input.action !== 'create' && !hint) throw new NativeScheduleError('SCHEDULE_NOT_FOUND');
    const previous = hint ? await retainScheduleSource(trx, actor, credential.subject, hint) : null;
    // Resolve both source roots before taking the schedule write lock. The
    // locked row must still agree with this old-source hint below.
    let proposedSource = previous;
    if (hint && input.action === 'update') {
      let type = input.data.work_item_type ?? hint.work_item_type;
      if (['meeting', 'break', 'other'].includes(type)) type = 'ad_hoc';
      proposedSource = await retainScheduleSource(trx, actor, credential.subject, { work_item_type: type,
        work_item_id: ['ad_hoc', 'non_billable_category'].includes(type) ? null : input.data.work_item_id === undefined ? hint.work_item_id : input.data.work_item_id });
    }
    const row = hint ? await owner.table('schedule_entries').where('entry_id', hint.entry_id).forUpdate().first() : null;
    if (hint && (!row || row.work_item_id !== hint.work_item_id || row.work_item_type !== hint.work_item_type)) throw new CoManagedSharedWorkError();
    const assignments: string[] = row ? (await owner.table('schedule_entry_assignees').where('entry_id', row.entry_id).orderBy('user_id').forUpdate().select('user_id')).map(item => item.user_id) : [];
    const own = assignments.length === 1 && assignments[0] === actor.userId;
    const record = { ...previous?.record, id: row?.entry_id, ownerUserId: assignments.length === 1 ? assignments[0] : undefined, assignedUserIds: assignments };
    let fields: string[] = [];
    if (row) {
      const read = await authorizeCoManagedLocalRecord(trx, actor, credential.subject, 'user_schedule', 'read', record);
      const command = await commandPolicy(trx, actor, credential.subject, input.action as 'update' | 'delete', record, own);
      fields.push(...read.redactedFields, ...command.redactedFields);
      scheduleView(row, assignments, actor, fields, previous!);
      if (row.is_private && !own) throw new CoManagedSharedWorkError();
    }
    let scope = input.action === 'create' ? undefined : input.scope ?? (occurrenceTime !== null ? 'single' : undefined);
    let effectiveId = masterId, occurrence = occurrenceTime;
    const recurring = !!row?.is_recurring && !!row?.recurrence_pattern;
    if (occurrence !== null || recurring && scope && scope !== 'all') {
      if (!recurring) throw new NativeScheduleError('SCHEDULE_OCCURRENCE_NOT_FOUND');
      occurrence ??= new Date(row.scheduled_start).getTime();
      const pattern = recurrence(row.recurrence_pattern);
      const holidays = (await owner.table('holidays').whereNull('schedule_id').orderBy('holiday_id').forShare().select('*')).map(holiday => ({
        ...holiday, holiday_date: holiday.holiday_date instanceof Date ? holiday.holiday_date.toISOString().slice(0, 10) : holiday.holiday_date,
      }));
      const candidates = generateOccurrences({ ...row, recurrence_pattern: pattern }, new Date(occurrence), new Date(occurrence), { includeMaster: true, holidays });
      if (!candidates.some(date => date.getTime() === occurrence)) throw new NativeScheduleError('SCHEDULE_OCCURRENCE_NOT_FOUND');
      if (isScheduleFieldHidden([...fields, ...(previous?.fields ?? [])], ['recurrence_pattern', 'is_recurring', 'original_entry_id'])) throw new CoManagedSharedWorkError();
      if (scope === 'future' && occurrence === new Date(row.scheduled_start).getTime()) scope = 'all';
      effectiveId = scope === 'all' ? masterId : `${masterId}_${occurrence}`;
    }
    const occurrenceBase = row && occurrence !== null ? { ...row, scheduled_start: new Date(occurrence),
      scheduled_end: new Date(occurrence + new Date(row.scheduled_end).getTime() - new Date(row.scheduled_start).getTime()) } : row;
    const normalized = input.action === 'delete' ? null : normalize(input.data, occurrenceBase ? { ...occurrenceBase, assigned_user_ids: assignments } : undefined, actor);
    if (normalized && recurring && scope) {
      if (scope === 'all') {
        // Editing all occurrences changes the clock/duration while retaining
        // the series anchor date, including when the clicked ID is virtual.
        const duration = normalized.merged.scheduled_end.getTime() - normalized.merged.scheduled_start.getTime();
        const start = new Date(row.scheduled_start), proposed = normalized.merged.scheduled_start;
        start.setHours(proposed.getHours(), proposed.getMinutes(), proposed.getSeconds(), proposed.getMilliseconds());
        normalized.merged.scheduled_start = start; normalized.merged.scheduled_end = new Date(start.getTime() + duration);
      }
      normalized.patch.scheduled_start = normalized.merged.scheduled_start;
      normalized.patch.scheduled_end = normalized.merged.scheduled_end;
      if (isScheduleFieldHidden(fields, ['recurrence_pattern', 'is_recurring', 'original_entry_id'])) throw new CoManagedSharedWorkError();
    }
    const next = normalized ? proposedSource ?? await retainScheduleSource(trx, actor, credential.subject, normalized.merged) : previous!;
    if (normalized) {
      const ids: string[] = normalized.merged.assigned_user_ids, nextOwn = ids.length === 1 && ids[0] === actor.userId;
      const nextRecord = { ...next.record, id: row?.entry_id, ownerUserId: ids.length === 1 ? ids[0] : undefined, assignedUserIds: ids };
      const read = await authorizeCoManagedLocalRecord(trx, actor, credential.subject, 'user_schedule', 'read', nextRecord);
      const command = await commandPolicy(trx, actor, credential.subject, input.action as 'create' | 'update', nextRecord, input.action === 'create' ? nextOwn : own && nextOwn);
      fields.push(...read.redactedFields, ...command.redactedFields);
      const changed = input.action === 'create' ? [...writable] : Object.keys(normalized.patch);
      if (isScheduleFieldHidden(fields, [...changed, 'entry_id', 'work_item_id', 'work_item_type', 'assigned_user_ids', 'assigned_users']) ||
        ((previous?.fields.length || next.fields.length) && changed.some(field => ['title', 'notes', 'work_item_id', 'work_item_type'].includes(field)))) throw new CoManagedSharedWorkError();
      const users = await owner.table('users').whereIn('user_id', ids).where({ user_type: 'internal', is_inactive: false }).orderBy('user_id').forShare().select('user_id');
      if (users.length !== ids.length) throw new CoManagedSharedWorkError();
    }
    const retainsMaster = recurring && (scope === 'single' || scope === 'future');
    if (row && !retainsMaster && (input.action === 'delete' || row.work_item_type === 'ad_hoc' && normalized?.merged.work_item_type !== 'ad_hoc')) {
      if (await owner.table('time_entries').where({ work_item_type: 'ad_hoc', work_item_id: row.entry_id }).forShare().first('entry_id') ||
        await owner.table('native_time_tracking_sessions').where({ work_item_type: 'ad_hoc', work_item_id: row.entry_id }).whereNull('completed_entry_id').forShare().first('session_id')) throw new NativeScheduleError('SCHEDULE_IN_USE');
    }
    let saved: any = null;
    if (input.action === 'create') saved = await ScheduleEntry.create(trx, tenant, normalized!.merged, { assignedUserIds: normalized!.merged.assigned_user_ids, assignedByUserId: actor.userId });
    else if (input.action === 'update') saved = await ScheduleEntry.update(trx, tenant, effectiveId, normalized!.patch, scope as IEditScope | undefined);
    else if (!await ScheduleEntry.delete(trx, tenant, effectiveId, scope as IEditScope | undefined)) throw new NativeScheduleError('SCHEDULE_NOT_FOUND');
    let view: any = null;
    if (saved) {
      const retained = await owner.table('schedule_entries').where('entry_id', saved.entry_id).forShare().first();
      if (!retained || retained.work_item_id !== normalized!.merged.work_item_id || retained.work_item_type !== normalized!.merged.work_item_type) throw new CoManagedSharedWorkError();
      recurrence(retained.recurrence_pattern);
      const ids = (await owner.table('schedule_entry_assignees').where('entry_id', saved.entry_id).orderBy('user_id').forShare().select('user_id')).map(item => item.user_id);
      if (ids.join(',') !== normalized!.merged.assigned_user_ids.join(',')) throw new CoManagedSharedWorkError();
      const read = await authorizeCoManagedLocalRecord(trx, actor, credential.subject, 'user_schedule', 'read', { ...next.record, id: saved.entry_id, ownerUserId: ids.length === 1 ? ids[0] : undefined, assignedUserIds: ids });
      view = scheduleView(retained, ids, actor, [...fields, ...read.redactedFields], next);
    }
    await credential.assertCurrent(); await assertCoManagedOperationalWrite(trx, tenant);
    const events: Array<{ eventType: 'SCHEDULE_ENTRY_CREATED' | 'SCHEDULE_ENTRY_UPDATED' | 'SCHEDULE_ENTRY_DELETED'; entryId: string }> = [];
    if (!row) events.push({ eventType: 'SCHEDULE_ENTRY_CREATED', entryId: saved.entry_id });
    else if (saved && saved.entry_id !== row.entry_id) {
      events.push({ eventType: 'SCHEDULE_ENTRY_UPDATED', entryId: row.entry_id }, { eventType: 'SCHEDULE_ENTRY_CREATED', entryId: saved.entry_id });
    } else {
      const retained = saved || await owner.table('schedule_entries').where('entry_id', row.entry_id).first('entry_id');
      events.push({ eventType: retained ? 'SCHEDULE_ENTRY_UPDATED' : 'SCHEDULE_ENTRY_DELETED', entryId: row.entry_id });
    }
    registerAfterCommit(trx, async () => { for (const event of events) await publish({ eventType: event.eventType,
      payload: { tenantId: tenant, userId: actor.userId, entryId: event.entryId } }); }, 'native-schedule-command');
    return { handled: true, entry: view };
  });
}
