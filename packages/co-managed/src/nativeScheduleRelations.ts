import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type { CoManagedAuthenticatedActor } from './localAuthentication';
import { CoManagedSharedWorkError } from './sharedWorkIdentity';

export class NativeScheduleRelationError extends Error {
  readonly code = 'SCHEDULE_RELATION_CONFLICT';
  constructor() { super('The appointment or meeting no longer matches this schedule entry'); this.name = 'NativeScheduleRelationError'; }
}
const cancelled = (row: any) => !row || ['cancelled', 'canceled'].includes(String(row.status).toLowerCase());
const sameInstant = (a: unknown, b: unknown) => new Date(a as string).getTime() === new Date(b as string).getTime();
function localAppointmentDate(start: unknown, timezone: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(start as string)).map(part => [part.type, part.value]));
  return { requested_date: `${parts.year}-${parts.month}-${parts.day}`, requested_time: `${parts.hour}:${parts.minute}:${parts.second}` };
}

/** Runs only inside an admitted schedule command. Provider work is represented
 * by a durable pending operation on the actual retained meeting row; no Graph
 * call or requester message runs before the schedule transaction commits.
 * An explicitly admitted appointment command may identify an unlinked request
 * for cancellation, or reschedule that same pending request without approval. */
export async function applyNativeScheduleRelations(trx: Knex.Transaction, actor: CoManagedAuthenticatedActor,
  before: any | null, after: any | null, previousAssignments: string[], assignments: string[], requestId?: string, pendingRescheduleRequestId?: string) {
  if (!trx.isTransaction) throw new CoManagedSharedWorkError();
  const owner = tenantDb(trx, actor.tenant), entryIds = [...new Set([before?.entry_id, after?.entry_id].filter(Boolean))];
  const requestIds = [...new Set([...(requestId ? [requestId] : []), ...[before, after].filter(row => row?.work_item_type === 'appointment_request').map(row => row.work_item_id)])];
  const requests = await owner.table('appointment_requests').where(query => query.whereIn('appointment_request_id', requestIds).orWhereIn('schedule_entry_id', entryIds)).orderBy('appointment_request_id').forUpdate();
  // Calendar mutation cannot silently adopt another request's slot or approve
  // a pending request; approval remains an explicit appointment operation.
  for (const request of requests) {
    if (!requestIds.includes(request.appointment_request_id) || (request.schedule_entry_id && !entryIds.includes(request.schedule_entry_id))) throw new NativeScheduleRelationError();
    if (after?.work_item_type === 'appointment_request' && after.work_item_id === request.appointment_request_id && !cancelled(after) && ((request.status !== 'approved' && !(request.status === 'pending' && pendingRescheduleRequestId === request.appointment_request_id)) || after.is_recurring)) throw new NativeScheduleRelationError();
  }
  if (requests.length !== requestIds.length) throw new NativeScheduleRelationError();
  const meetings = await owner.table('online_meetings').where(query => query.whereIn('schedule_entry_id', entryIds).orWhereIn('appointment_request_id', requestIds)).orderBy('meeting_id').forUpdate();
  for (const meeting of meetings) {
    if ((meeting.schedule_entry_id && !entryIds.includes(meeting.schedule_entry_id)) || (meeting.appointment_request_id && !requestIds.includes(meeting.appointment_request_id))) throw new NativeScheduleRelationError();
  }
  if (after?.is_recurring && meetings.some(meeting => meeting.status !== 'cancelled')) throw new NativeScheduleRelationError();
  if (before && after && before.entry_id !== after.entry_id && (requests.length || meetings.length)) throw new NativeScheduleRelationError();

  // Older approved requests may carry provider IDs without an online_meetings
  // row. Retain those IDs before clearing the request's live join fields.
  for (const request of requests) if (request.online_meeting_provider === 'teams' && request.online_meeting_id && !meetings.some(meeting => meeting.appointment_request_id === request.appointment_request_id && meeting.provider_meeting_id === request.online_meeting_id)) {
    const bound = before ?? after;
    if (!bound) throw new NativeScheduleRelationError();
    const collision = await owner.table('online_meetings').where({ provider: 'teams', provider_meeting_id: request.online_meeting_id }).forUpdate().first('meeting_id');
    if (collision) throw new NativeScheduleRelationError();
    const [meeting] = await owner.table('online_meetings').insert({ tenant: actor.tenant, provider: 'teams', provider_meeting_id: request.online_meeting_id,
      subject: 'Appointment', join_url: request.online_meeting_url ?? '', start_time: bound.scheduled_start, end_time: bound.scheduled_end,
      status: 'scheduled', appointment_request_id: request.appointment_request_id, schedule_entry_id: bound.entry_id, created_by: actor.userId }).returning('*');
    meetings.push(meeting);
  }
  const assignmentChanged = [...previousAssignments].sort().join(',') !== [...assignments].sort().join(',');
  const moved = before && after && (!sameInstant(before.scheduled_start, after.scheduled_start) || !sameInstant(before.scheduled_end, after.scheduled_end));
  for (const request of requests) {
    const current = after?.work_item_type === 'appointment_request' && after.work_item_id === request.appointment_request_id ? after : null;
    if (cancelled(current)) {
      await owner.table('appointment_requests').where('appointment_request_id', request.appointment_request_id).update({
        schedule_entry_id: null, online_meeting_provider: null, online_meeting_url: null, online_meeting_id: null,
        ...(request.status === 'approved' ? { status: 'cancelled', declined_reason: 'Cancelled from calendar' } : {}), updated_at: trx.fn.now(),
      });
    } else {
      const duration = (new Date(current.scheduled_end).getTime() - new Date(current.scheduled_start).getTime()) / 60000;
      if (!Number.isInteger(duration) || duration <= 0) throw new NativeScheduleRelationError();
      const local = localAppointmentDate(current.scheduled_start, request.requester_timezone || 'UTC');
      await owner.table('appointment_requests').where('appointment_request_id', request.appointment_request_id).update({
        ...local, requested_duration: duration, schedule_entry_id: current.entry_id,
        preferred_assigned_user_id: assignments.length === 1 ? assignments[0] : null, updated_at: trx.fn.now(),
      });
    }
  }
  for (const meeting of meetings) {
    const current = meeting.appointment_request_id ? after?.work_item_type === 'appointment_request' && after.work_item_id === meeting.appointment_request_id ? after : null : after;
    const cancel = cancelled(current);
    if (!cancel && (meeting.status === 'cancelled' || (!moved && !assignmentChanged))) continue;
    const patch: Record<string, unknown> = cancel ? { status: 'cancelled' } : { start_time: current.scheduled_start, end_time: current.scheduled_end };
    if (meeting.provider === 'teams' && meeting.provider_meeting_id) Object.assign(patch, { co_managed_sync_operation_id: trx.raw('gen_random_uuid()'), co_managed_sync_action: cancel ? 'delete' : 'update',
      co_managed_sync_requested_at: trx.fn.now(), co_managed_sync_attempts: 0, co_managed_sync_attempted_at: null, co_managed_sync_last_error: null });
    await owner.table('online_meetings').where('meeting_id', meeting.meeting_id).update({ ...patch, updated_at: trx.fn.now() });
  }
  if (before && (!after || moved || assignmentChanged || JSON.stringify(before.recurrence_pattern) !== JSON.stringify(after.recurrence_pattern))) await owner.table('schedule_conflicts').where(query => query.where('entry_id_1', before.entry_id).orWhere('entry_id_2', before.entry_id)).del();
}
