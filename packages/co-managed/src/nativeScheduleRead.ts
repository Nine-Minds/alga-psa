import type { Knex } from 'knex';
import type { AuthorizationRecord, AuthorizationSubject } from '@alga-psa/authorization';
import { tenantDb, withTransaction } from '@alga-psa/db';
import { generateOccurrences } from '@alga-psa/shared/utils/recurrenceUtils';
import { retainCoManagedTimeCalendar } from './nativeTimePeriod';
import { lockCoManagedLocalAuthentication, snapshotCoManagedAuthenticatedActor, type CoManagedAuthenticatedActor } from './localAuthentication';
import { authorizeCoManagedLocalRecord, CoManagedSharedWorkError, isCoManagedUuid } from './sharedWorkIdentity';
import { hasCoManagedLocalPermission } from './localPermission';
import { isCoManagedReadFieldHidden } from './sharedWorkRedaction';

export interface ScheduleSource { record: AuthorizationRecord; fields: readonly string[]; workItem: { id: string; type: string; title: string } | null }

// LEVERAGE: pattern native-operational-source-admission — time and schedule read the same work roots; keep schedule authority independent of time-entry permissions.
export async function retainScheduleSource(trx: Knex.Transaction, actor: CoManagedAuthenticatedActor, subject: AuthorizationSubject,
  entry: { work_item_type: string; work_item_id: string | null }): Promise<ScheduleSource> {
  const owner = tenantDb(trx, actor.tenant), id = entry.work_item_id;
  if (['ad_hoc', 'non_billable_category'].includes(entry.work_item_type) && (!id || id === '__non_billable__')) return { record: {}, fields: [], workItem: null };
  if (!isCoManagedUuid(id)) throw new CoManagedSharedWorkError();
  let resource: string, record: AuthorizationRecord, title: string;
  if (entry.work_item_type === 'project_task') {
    const locate = owner.table('project_tasks as task').where('task.task_id', id);
    owner.tenantJoin(locate, 'project_phases as phase', 'task.phase_id', 'phase.phase_id');
    const hint = await locate.first('phase.project_id');
    if (!hint) throw new CoManagedSharedWorkError();
    const project = await owner.table('projects').where('project_id', hint.project_id).forShare().first('project_id', 'client_id', 'assigned_to');
    const query = owner.table('project_tasks as task').where('task.task_id', id);
    owner.tenantJoin(query, 'project_phases as phase', 'task.phase_id', 'phase.phase_id');
    const task = await query.forShare('task', 'phase').first('task.task_name', 'phase.project_id');
    if (!project || !task || task.project_id !== project.project_id) throw new CoManagedSharedWorkError();
    resource = 'project'; title = task.task_name;
    record = { id: project.project_id, clientId: project.client_id, assignedUserIds: project.assigned_to ? [project.assigned_to] : [], teamIds: [] };
  } else if (entry.work_item_type === 'ticket') {
    const ticket = await owner.table('tickets').where('ticket_id', id).forShare().first('ticket_id', 'title', 'client_id', 'board_id', 'assigned_to', 'entered_by');
    if (!ticket) throw new CoManagedSharedWorkError();
    resource = 'ticket'; title = ticket.title;
    record = { id, clientId: ticket.client_id, boardId: ticket.board_id, ownerUserId: ticket.entered_by, assignedUserIds: ticket.assigned_to ? [ticket.assigned_to] : [], teamIds: [] };
  } else if (entry.work_item_type === 'interaction') {
    const interaction = await owner.table('interactions').where('interaction_id', id).forShare().first('title', 'client_id', 'user_id');
    if (!interaction) throw new CoManagedSharedWorkError();
    resource = 'interaction'; title = interaction.title;
    record = { id, clientId: interaction.client_id, ownerUserId: interaction.user_id };
  } else if (entry.work_item_type === 'appointment_request') {
    const hint = await owner.table('appointment_requests').where('appointment_request_id', id).first('ticket_id');
    if (!hint) throw new CoManagedSharedWorkError();
    const source = hint.ticket_id ? await retainScheduleSource(trx, actor, subject, { work_item_type: 'ticket', work_item_id: hint.ticket_id }) : { record: {}, fields: [], workItem: null };
    const request = await owner.table('appointment_requests').where('appointment_request_id', id).forShare().first('ticket_id');
    if (!request || request.ticket_id !== hint.ticket_id) throw new CoManagedSharedWorkError();
    // Appointment requests use user_schedule authority, evaluated below against
    // the actual schedule and assignments, plus their linked ticket's scope.
    return { record: source.record, fields: source.fields, workItem: { id: id!, type: entry.work_item_type, title: source.workItem?.title ?? '' } };
  } else throw new CoManagedSharedWorkError();
  const fields = (await authorizeCoManagedLocalRecord(trx, actor, subject, resource, 'read', record)).redactedFields;
  const sourceId = entry.work_item_type === 'project_task' ? 'task_id' : entry.work_item_type === 'ticket' ? 'ticket_id' : 'interaction_id';
  if (isCoManagedReadFieldHidden(fields, ['schedule_entries', 'work_item_id', sourceId, `values.${sourceId}`])) throw new CoManagedSharedWorkError();
  const hiddenTitle = isCoManagedReadFieldHidden(fields, ['name', 'title', 'task_name', 'values.title', 'values.task_name', 'project_tasks.task_name', 'tickets.title', 'interactions.title']);
  return { record, fields, workItem: { id: id!, type: entry.work_item_type, title: hiddenTitle ? '' : title } };
}

export function isScheduleFieldHidden(fields: readonly string[], names: readonly string[]) {
  return isCoManagedReadFieldHidden(fields, names.flatMap(name => [name, `values.${name}`, `schedule_entries.${name}`]));
}

export function scheduleView(row: any, assignments: string[], actor: CoManagedAuthenticatedActor, fields: readonly string[], source: ScheduleSource) {
  const hidden = (...names: string[]) => isScheduleFieldHidden(fields, names);
  if (hidden('tenant', 'entry_id', 'scheduled_start', 'scheduled_end', 'assigned_user_ids', 'assigned_users', 'is_private')) throw new CoManagedSharedWorkError();
  const privateBusy = row.is_private && !assignments.includes(actor.userId);
  const contentHidden = privateBusy || source.fields.length > 0;
  const start = new Date(row.scheduled_start).toISOString(), end = new Date(row.scheduled_end).toISOString();
  const view: any = { tenant: row.tenant, entry_id: row.entry_id, scheduled_start: start, scheduled_end: end,
    assigned_user_ids: assignments, assigned_users: assignments.map(user_id => ({ user_id })),
    title: hidden('title') ? '' : privateBusy ? 'Busy' : contentHidden ? '' : row.title,
    notes: contentHidden || hidden('notes') ? '' : row.notes ?? '',
    work_item_id: contentHidden || hidden('work_item_id', 'work_item') ? null : source.workItem?.id ?? null,
    work_item_type: contentHidden || hidden('work_item_type', 'work_item') ? 'ad_hoc' : row.work_item_type,
    work_item: contentHidden || hidden('work_item', 'work_item_id', 'work_item_type') ? null : source.workItem,
    is_private: !!row.is_private,
    status: privateBusy || hidden('status') ? '' : row.status,
    recurrence_pattern: contentHidden || hidden('recurrence_pattern') ? null : row.recurrence_pattern ?? null };
  for (const field of ['created_by', 'original_entry_id', 'is_recurring']) if (!contentHidden && !hidden(field) && row[field] != null) view[field] = row[field];
  for (const field of ['created_at', 'updated_at']) if (!hidden(field) && row[field]) view[field] = new Date(row[field]).toISOString();
  if (!hidden('duration_hours')) view.duration_hours = Math.round((Date.parse(end) - Date.parse(start)) / 36000) / 100;
  if (!hidden('is_current')) view.is_current = Date.parse(start) <= Date.now() && Date.now() < Date.parse(end);
  return view;
}

/** API and native detail readers share actual schedule, assignee and source
 * admission. Collection filters run after projection, so hidden fields cannot
 * become a membership oracle. Calendar occurrences inherit actual master and
 * linked-source authority; raw recurrence data stays inside the transaction. */
export async function readCoManagedNativeSchedules(db: Knex, tenant: string, identify: () => Promise<CoManagedAuthenticatedActor>,
  options: { id?: string; start?: string; end?: string; userId?: string; calendar?: { start: string; end: string; technicianIds?: string[] } } = {}
): Promise<{ handled: false } | { handled: true; entries: any[] }> {
  options = { ...options, calendar: options.calendar ? { ...options.calendar, technicianIds: options.calendar.technicianIds ? [...options.calendar.technicianIds] : undefined } : undefined };
  if (!isCoManagedUuid(tenant) || (options.id && !isCoManagedUuid(options.id)) || (options.userId && !isCoManagedUuid(options.userId))) throw new CoManagedSharedWorkError();
  const start = options.start ? new Date(options.start).getTime() : null, end = options.end ? new Date(options.end).getTime() : null;
  if ((start !== null && !Number.isFinite(start)) || (end !== null && !Number.isFinite(end))) throw new CoManagedSharedWorkError();
  const calendarStart = options.calendar ? Date.parse(options.calendar.start) : null, calendarEnd = options.calendar ? Date.parse(options.calendar.end) : null;
  if (options.calendar && (options.id || !Number.isFinite(calendarStart) || !Number.isFinite(calendarEnd) || calendarEnd! <= calendarStart! || (options.calendar.technicianIds !== undefined && !options.calendar.technicianIds.every(isCoManagedUuid)))) throw new CoManagedSharedWorkError();
  return withTransaction(db, async trx => {
    if (!await retainCoManagedTimeCalendar(trx, tenant)) return { handled: false };
    const actor = snapshotCoManagedAuthenticatedActor(await identify());
    if (actor.tenant !== tenant) throw new CoManagedSharedWorkError();
    const credential = await lockCoManagedLocalAuthentication(trx, actor);
    if (!await hasCoManagedLocalPermission(trx, actor, 'user_schedule', 'read', true)) throw new CoManagedSharedWorkError();
    const canReadOthers = await hasCoManagedLocalPermission(trx, actor, 'user_schedule', 'update', true), owner = tenantDb(trx, tenant);
    const query = owner.table('schedule_entries').orderBy('entry_id');
    if (options.id) query.where('entry_id', options.id);
    if (options.calendar) query.whereNull('original_entry_id').where('scheduled_start', '<', new Date(calendarEnd!))
      .where(query => query.where('is_recurring', true).orWhere('scheduled_end', '>', new Date(calendarStart!)));
    const hints = await query.select('entry_id', 'work_item_id', 'work_item_type'), entries: any[] = [];
    let holidays: any[] | undefined;
    const calendarRows = async (row: any) => {
      if (!options.calendar || !row.is_recurring || !row.recurrence_pattern) return [row];
      const pattern = typeof row.recurrence_pattern === 'string' ? JSON.parse(row.recurrence_pattern) : row.recurrence_pattern;
      const duration = new Date(row.scheduled_end).getTime() - new Date(row.scheduled_start).getTime();
      if (!Number.isFinite(duration) || duration <= 0) throw new CoManagedSharedWorkError();
      // Include occurrences beginning before the range whose duration crosses
      // into it. Final overlap filtering uses the actual occurrence timestamps.
      const from = new Date(Math.max(calendarStart! - duration, new Date(row.scheduled_start).getTime()));
      if (!holidays) holidays = (await owner.table('holidays').whereNull('schedule_id').orderBy('holiday_id').forShare().select('*')).map(holiday => ({
        ...holiday, holiday_date: holiday.holiday_date instanceof Date ? holiday.holiday_date.toISOString().slice(0, 10) : holiday.holiday_date,
      }));
      return generateOccurrences({ ...row, recurrence_pattern: pattern }, from, new Date(calendarEnd!), { holidays, includeMaster: true }).map(occurrence => ({
        ...row, entry_id: `${row.entry_id}_${occurrence.getTime()}`, original_entry_id: row.entry_id,
        scheduled_start: occurrence, scheduled_end: new Date(occurrence.getTime() + duration), recurrence_pattern: pattern,
      }));
    };
    for (const hint of hints) {
      try {
        const source = await retainScheduleSource(trx, actor, credential.subject, hint);
        const row = await owner.table('schedule_entries').where('entry_id', hint.entry_id).forShare().first();
        if (!row || row.work_item_id !== hint.work_item_id || row.work_item_type !== hint.work_item_type) throw new CoManagedSharedWorkError();
        if (options.calendar && row.original_entry_id) continue;
        const assignments = (await owner.table('schedule_entry_assignees').where('entry_id', row.entry_id).orderBy('user_id').forShare().select('user_id')).map(item => item.user_id);
        if (!canReadOthers && !assignments.includes(actor.userId)) throw new CoManagedSharedWorkError();
        const policy = await authorizeCoManagedLocalRecord(trx, actor, credential.subject, 'user_schedule', 'read', {
          ...source.record, id: row.entry_id, ownerUserId: assignments.length === 1 ? assignments[0] : undefined, assignedUserIds: assignments,
        });
        // Admit critical fields before expanding. An explicit recurrence-field
        // restriction also withholds derived occurrences; private Busy entries
        // still disclose their authorized occupancy without the stored pattern.
        scheduleView(row, assignments, actor, policy.redactedFields, source);
        if (options.calendar && row.is_recurring && isScheduleFieldHidden([...policy.redactedFields, ...source.fields], ['recurrence_pattern', 'is_recurring', 'original_entry_id'])) continue;
        for (const occurrence of await calendarRows(row)) {
          const view = scheduleView(occurrence, assignments, actor, policy.redactedFields, source);
          if (options.calendar) {
            if (Date.parse(view.scheduled_start) >= calendarEnd! || Date.parse(view.scheduled_end) <= calendarStart!) continue;
            const ids = options.calendar.technicianIds;
            if (canReadOthers && ids?.length && !assignments.some(id => ids.includes(id)) && !(assignments.length === 0 && row.work_item_type === 'appointment_request')) continue;
          }
          if ((!options.userId || view.assigned_user_ids.includes(options.userId)) && (start === null || Date.parse(view.scheduled_start) >= start) && (end === null || Date.parse(view.scheduled_end) <= end)) entries.push(view);
        }
      } catch (error) { if (!(error instanceof CoManagedSharedWorkError) || options.id) throw error; }
    }
    await credential.assertCurrent();
    entries.sort((a, b) => a.scheduled_start.localeCompare(b.scheduled_start) || a.entry_id.localeCompare(b.entry_id));
    return { handled: true, entries };
  });
}
