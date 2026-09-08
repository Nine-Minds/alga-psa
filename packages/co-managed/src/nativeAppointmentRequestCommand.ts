import type { Knex } from 'knex';
import { tenantDb, withTransaction, registerAfterCommit } from '@alga-psa/db';
import { assertCoManagedOperationalWrite } from '@alga-psa/licensing';
import { appointmentDateTime } from '@alga-psa/shared/utils/appointmentDateTime';
import { isScheduleFieldHidden } from './nativeScheduleRead';
import { retainCoManagedTimeCalendar } from './nativeTimePeriod';
import { lockCoManagedLocalAuthentication, snapshotCoManagedAuthenticatedActor, type CoManagedAuthenticatedActor } from './localAuthentication';
import { CoManagedSharedWorkError, isCoManagedUuid } from './sharedWorkIdentity';
import { retainNativeAppointmentRequest, nativeAppointmentRequestView, isAppointmentFieldHidden } from './nativeAppointmentRequest';
import { applyNativeScheduleRelations, NativeScheduleRelationError } from './nativeScheduleRelations';

export async function declineCoManagedNativeAppointment(db: Knex, tenant: string, input: { id: string; reason: string },
  identify: () => Promise<CoManagedAuthenticatedActor>, publish: (event: { eventType: 'SCHEDULE_ENTRY_DELETED'; payload: { tenantId: string; userId: string; entryId: string } }) => Promise<unknown>) {
  input = { ...input };
  if (!isCoManagedUuid(input.id) || typeof input.reason !== 'string' || !input.reason.trim() || input.reason.length > 2000) throw new CoManagedSharedWorkError();
  return withTransaction(db, async trx => {
    if (!await retainCoManagedTimeCalendar(trx, tenant)) return { handled: false as const };
    await assertCoManagedOperationalWrite(trx, tenant);
    const actor = snapshotCoManagedAuthenticatedActor(await identify());
    if (actor.tenant !== tenant) throw new CoManagedSharedWorkError();
    const credential = await lockCoManagedLocalAuthentication(trx, actor), owner = tenantDb(trx, tenant);
    const retained = await retainNativeAppointmentRequest(trx, actor, credential.subject, input.id, true), request = retained.request;
    if (!['pending', 'approved'].includes(request.status)) throw new NativeScheduleRelationError();
    if (retained.source.fields.length || isAppointmentFieldHidden(retained.fields, ['declined_reason', 'schedule_entry_id', 'approved_by_user_id', 'approved_at', 'online_meeting_id', 'online_meeting_url'])) throw new CoManagedSharedWorkError();
    // LEVERAGE: pattern native-appointment-schedule-admission — approval/association share this actual request-to-calendar binding and assignee admission.
    const schedule = request.schedule_entry_id ? await owner.table('schedule_entries').where('entry_id', request.schedule_entry_id).forUpdate().first() : null;
    if (request.schedule_entry_id && (!schedule || schedule.work_item_type !== 'appointment_request' || schedule.work_item_id !== input.id || schedule.is_recurring)) throw new NativeScheduleRelationError();
    const assignments: string[] = schedule ? (await owner.table('schedule_entry_assignees').where('entry_id', schedule.entry_id).orderBy('user_id').forUpdate().select('user_id')).map(row => row.user_id) : [];
    if (schedule) {
      const fields = await retained.authorizeSchedule(schedule, assignments);
      if (isScheduleFieldHidden(fields, ['tenant', 'entry_id', 'scheduled_start', 'scheduled_end', 'assigned_user_ids', 'is_private'])) throw new CoManagedSharedWorkError();
      if (schedule.is_private && !(assignments.length === 1 && assignments[0] === actor.userId)) throw new CoManagedSharedWorkError();
      if (await owner.table('time_entries').where({ work_item_type: 'ad_hoc', work_item_id: schedule.entry_id }).forShare().first('entry_id') ||
          await owner.table('native_time_tracking_sessions').where({ work_item_type: 'ad_hoc', work_item_id: schedule.entry_id }).whereNull('completed_entry_id').forShare().first('session_id')) throw new NativeScheduleRelationError();
    }
    await applyNativeScheduleRelations(trx, actor, schedule, null, assignments, [], input.id);
    if (schedule) {
      await owner.table('schedule_entry_assignees').where('entry_id', schedule.entry_id).del();
      await owner.table('schedule_entries').where('entry_id', schedule.entry_id).del();
    }
    await owner.table('appointment_requests').where('appointment_request_id', input.id).update({ status: 'declined', declined_reason: input.reason,
      approved_by_user_id: actor.userId, approved_at: trx.fn.now(), updated_at: trx.fn.now() });
    await credential.assertCurrent(); await assertCoManagedOperationalWrite(trx, tenant);
    if (schedule) registerAfterCommit(trx, async () => { await publish({ eventType: 'SCHEDULE_ENTRY_DELETED', payload: { tenantId: tenant, userId: actor.userId, entryId: schedule.entry_id } }); }, 'native-appointment-decline');
    return { handled: true as const };
  });
}

export async function rescheduleCoManagedNativeAppointment(db: Knex, tenant: string,
  input: { id: string; date: string; time: string; timezone?: string | null; duration?: number | null },
  identify: () => Promise<CoManagedAuthenticatedActor>, publish: (event: { eventType: 'SCHEDULE_ENTRY_UPDATED'; payload: { tenantId: string; userId: string; entryId: string } }) => Promise<unknown>) {
  input = { ...input };
  if (!isCoManagedUuid(input.id)) throw new CoManagedSharedWorkError();
  return withTransaction(db, async trx => {
    if (!await retainCoManagedTimeCalendar(trx, tenant)) return { handled: false as const };
    await assertCoManagedOperationalWrite(trx, tenant);
    const actor = snapshotCoManagedAuthenticatedActor(await identify());
    if (actor.tenant !== tenant) throw new CoManagedSharedWorkError();
    const credential = await lockCoManagedLocalAuthentication(trx, actor), owner = tenantDb(trx, tenant);
    const retained = await retainNativeAppointmentRequest(trx, actor, credential.subject, input.id, true), request = retained.request;
    if (!['pending', 'approved'].includes(request.status)) throw new NativeScheduleRelationError();
    if (retained.source.fields.length || isAppointmentFieldHidden(retained.fields, ['requested_date', 'requested_time', 'requested_duration', 'requester_timezone', 'schedule_entry_id'])) throw new CoManagedSharedWorkError();
    const timezone = input.timezone ?? request.requester_timezone ?? 'UTC', duration = input.duration ?? request.requested_duration;
    const { start, end } = appointmentDateTime(input.date, input.time, timezone, duration);
    // LEVERAGE: pattern native-appointment-schedule-admission — approval/association share this actual request-to-calendar binding and assignee admission.
    const schedule = request.schedule_entry_id ? await owner.table('schedule_entries').where('entry_id', request.schedule_entry_id).forUpdate().first() : null;
    if (request.schedule_entry_id && (!schedule || schedule.work_item_type !== 'appointment_request' || schedule.work_item_id !== input.id || schedule.is_recurring)) throw new NativeScheduleRelationError();
    const assignments: string[] = schedule ? (await owner.table('schedule_entry_assignees').where('entry_id', schedule.entry_id).orderBy('user_id').forUpdate().select('user_id')).map(row => row.user_id) : [];
    if (schedule) {
      const fields = await retained.authorizeSchedule(schedule, assignments);
      if (isScheduleFieldHidden(fields, ['tenant', 'entry_id', 'scheduled_start', 'scheduled_end', 'assigned_user_ids', 'is_private']) || schedule.is_private && !(assignments.length === 1 && assignments[0] === actor.userId)) throw new CoManagedSharedWorkError();
    } else if (request.online_meeting_id || await owner.table('online_meetings').where('appointment_request_id', input.id).forUpdate().first('meeting_id')) throw new NativeScheduleRelationError();
    await owner.table('appointment_requests').where('appointment_request_id', input.id).update({ requested_date: input.date, requested_time: input.time.slice(0, 5), requester_timezone: timezone, requested_duration: duration, updated_at: trx.fn.now() });
    if (schedule) {
      const [after] = await owner.table('schedule_entries').where('entry_id', schedule.entry_id).update({ scheduled_start: start, scheduled_end: end, updated_at: trx.fn.now() }).returning('*');
      await applyNativeScheduleRelations(trx, actor, schedule, after, assignments, assignments, input.id, request.status === 'pending' ? input.id : undefined);
    }
    const current = await retainNativeAppointmentRequest(trx, actor, credential.subject, input.id);
    const requestView = await nativeAppointmentRequestView(trx, actor, credential.subject, current);
    await credential.assertCurrent(); await assertCoManagedOperationalWrite(trx, tenant);
    if (schedule) registerAfterCommit(trx, async () => { await publish({ eventType: 'SCHEDULE_ENTRY_UPDATED', payload: { tenantId: tenant, userId: actor.userId, entryId: schedule.entry_id } }); }, 'native-appointment-reschedule');
    return { handled: true as const, request: requestView };
  });
}
