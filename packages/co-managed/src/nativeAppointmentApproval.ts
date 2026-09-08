import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import type { AuthorizationSubject } from '@alga-psa/authorization';
import { tenantDb, withTransaction, registerAfterCommit, timePeriodCalendarDate } from '@alga-psa/db';
import { assertCoManagedOperationalWrite } from '@alga-psa/licensing';
import { appointmentDateTime } from '@alga-psa/shared/utils/appointmentDateTime';
import ScheduleEntry from '@alga-psa/shared/models/scheduleEntry';
import { retainCoManagedTimeCalendar } from './nativeTimePeriod';
import { retainScheduleSource, isScheduleFieldHidden } from './nativeScheduleRead';
import { lockCoManagedLocalAuthentication, snapshotCoManagedAuthenticatedActor, type CoManagedAuthenticatedActor } from './localAuthentication';
import { CoManagedSharedWorkError, isCoManagedUuid } from './sharedWorkIdentity';
import { retainNativeAppointmentRequest, nativeAppointmentRequestView, isAppointmentFieldHidden } from './nativeAppointmentRequest';
import { applyNativeScheduleRelations, NativeScheduleRelationError } from './nativeScheduleRelations';

type AppointmentEvent = { eventType: 'SCHEDULE_ENTRY_CREATED' | 'SCHEDULE_ENTRY_UPDATED'; payload: { tenantId: string; userId: string; entryId: string } };
export type NativeAppointmentApprovalInput = { id: string; assignedUserId: string; finalDate?: string | null; finalTime?: string | null; ticketId?: string | null; internalNotes?: string | null };

type AppointmentPublisher = (event: AppointmentEvent) => Promise<unknown>;

/** Retain both old/proposed ticket roots before the appointment write lock. */
async function retainAppointmentTicketChange(trx: Knex.Transaction, actor: CoManagedAuthenticatedActor, subject: AuthorizationSubject, requestId: string, ticketId?: string | null) {
  const owner = tenantDb(trx, actor.tenant), hint = await owner.table('appointment_requests').where('appointment_request_id', requestId).first('ticket_id');
  if (!hint) throw new CoManagedSharedWorkError();
  const targetId = ticketId ?? hint.ticket_id;
  let target: Awaited<ReturnType<typeof retainScheduleSource>> | null = null;
  for (const id of [...new Set([hint.ticket_id, targetId].filter(Boolean))].sort() as string[]) {
    const source = await retainScheduleSource(trx, actor, subject, { work_item_type: 'ticket', work_item_id: id });
    if (id === targetId) target = source;
  }
  const retained = await retainNativeAppointmentRequest(trx, actor, subject, requestId, true);
  if (retained.request.ticket_id !== hint.ticket_id) throw new CoManagedSharedWorkError();
  if (retained.source.fields.length || target?.fields.length || isAppointmentFieldHidden(retained.fields, ['ticket_id', 'client_id'])) throw new CoManagedSharedWorkError();
  if (target && retained.request.client_id && retained.request.client_id !== target.record.clientId) throw new NativeScheduleRelationError();
  return { retained, ticketId: targetId ?? null, clientId: retained.request.client_id ?? target?.record.clientId ?? null };
}

// LEVERAGE: pattern native-appointment-schedule-admission — decline/reschedule retain this same canonical request, allocation and assignee boundary.
async function retainAppointmentSchedule(trx: Knex.Transaction, actor: CoManagedAuthenticatedActor, retained: Awaited<ReturnType<typeof retainNativeAppointmentRequest>>) {
  const owner = tenantDb(trx, actor.tenant), request = retained.request;
  if (!request.schedule_entry_id) return { schedule: null, assignments: [] as string[] };
  const schedule = await owner.table('schedule_entries').where('entry_id', request.schedule_entry_id).forUpdate().first();
  const canonical = schedule?.work_item_type === 'appointment_request' && schedule.work_item_id === request.appointment_request_id;
  const legacyTicket = request.ticket_id && schedule?.work_item_type === 'ticket' && schedule.work_item_id === request.ticket_id;
  if (!schedule || (!canonical && !legacyTicket) || schedule.is_recurring || await owner.table('appointment_requests').where('schedule_entry_id', schedule.entry_id).whereNot('appointment_request_id', request.appointment_request_id).forShare().first('appointment_request_id')) throw new NativeScheduleRelationError();
  const assignments: string[] = (await owner.table('schedule_entry_assignees').where('entry_id', schedule.entry_id).orderBy('user_id').forUpdate().select('user_id')).map(row => row.user_id);
  const fields = await retained.authorizeSchedule(schedule, assignments);
  if (isScheduleFieldHidden(fields, ['tenant', 'entry_id', 'scheduled_start', 'scheduled_end', 'assigned_user_ids', 'is_private', 'work_item_id', 'work_item_type']) || schedule.is_private && !(assignments.length === 1 && assignments[0] === actor.userId)) throw new CoManagedSharedWorkError();
  return { schedule, assignments };
}

export async function associateCoManagedNativeAppointmentTicket(db: Knex, tenant: string, input: { id: string; ticketId: string },
  identify: () => Promise<CoManagedAuthenticatedActor>, publish: AppointmentPublisher) {
  input = { ...input };
  if (![input.id, input.ticketId].every(isCoManagedUuid)) throw new CoManagedSharedWorkError();
  return withTransaction(db, async trx => {
    if (!await retainCoManagedTimeCalendar(trx, tenant)) return { handled: false as const };
    await assertCoManagedOperationalWrite(trx, tenant);
    const actor = snapshotCoManagedAuthenticatedActor(await identify()); if (actor.tenant !== tenant) throw new CoManagedSharedWorkError();
    const credential = await lockCoManagedLocalAuthentication(trx, actor), owner = tenantDb(trx, tenant);
    const change = await retainAppointmentTicketChange(trx, actor, credential.subject, input.id, input.ticketId);
    const { schedule, assignments } = await retainAppointmentSchedule(trx, actor, change.retained);
    await owner.table('appointment_requests').where('appointment_request_id', input.id).update({ ticket_id: change.ticketId, client_id: change.clientId, updated_at: trx.fn.now() });
    if (schedule) await owner.table('schedule_entries').where('entry_id', schedule.entry_id).update({ work_item_type: 'appointment_request', work_item_id: input.id, updated_at: trx.fn.now() });
    // A ticket is a source of the appointment. It must not replace the
    // appointment as the calendar's canonical work item, which breaks all
    // subsequent reschedule/cancellation relation checks.
    const current = await retainNativeAppointmentRequest(trx, actor, credential.subject, input.id, true);
    if (schedule) await current.authorizeSchedule(schedule, assignments);
    await credential.assertCurrent(); await assertCoManagedOperationalWrite(trx, tenant);
    if (schedule) registerAfterCommit(trx, async () => { await publish({ eventType: 'SCHEDULE_ENTRY_UPDATED', payload: { tenantId: tenant, userId: actor.userId, entryId: schedule.entry_id } }); }, 'native-appointment-ticket');
    return { handled: true as const };
  });
}

/** Retained preparation shared by local approval and durable provider creation. */
export async function retainAppointmentApprovalPlan(trx: Knex.Transaction, actor: CoManagedAuthenticatedActor, subject: AuthorizationSubject, input: NativeAppointmentApprovalInput) {
  if (!trx.isTransaction || ![input.id, input.assignedUserId].every(isCoManagedUuid) || input.ticketId != null && !isCoManagedUuid(input.ticketId) || input.internalNotes != null && (typeof input.internalNotes !== 'string' || input.internalNotes.length > 2000)) throw new CoManagedSharedWorkError();
  const owner = tenantDb(trx, actor.tenant);
  const change = await retainAppointmentTicketChange(trx, actor, subject, input.id, input.ticketId), retained = change.retained, request = retained.request;
  if (request.status !== 'pending') throw new NativeScheduleRelationError();
  if (isAppointmentFieldHidden(retained.fields, ['requested_date', 'requested_time', 'requested_duration', 'requester_timezone', 'preferred_assigned_user_id', 'schedule_entry_id', 'approved_by_user_id', 'approved_at', 'description', 'service_id', 'service_name'])) throw new CoManagedSharedWorkError();
  if (!await owner.table('users').where({ user_id: input.assignedUserId, user_type: 'internal', is_inactive: false }).forShare().first('user_id')) throw new CoManagedSharedWorkError();
  const service = await owner.table('service_catalog').where('service_id', request.service_id).forShare().first('service_name');
  if (!service) throw new NativeScheduleRelationError();
  const date = input.finalDate ?? timePeriodCalendarDate(request.requested_date), time = input.finalTime ?? request.requested_time;
  // Existing approval form overrides are UTC. With no override, interpret
  // the stored wall-clock in the requester's zone, as the requester entered it.
  const { start, end } = appointmentDateTime(date, time, !input.finalDate && !input.finalTime ? request.requester_timezone || 'UTC' : 'UTC', request.requested_duration);
  const { schedule, assignments } = await retainAppointmentSchedule(trx, actor, retained);
  const entryId = schedule?.entry_id ?? randomUUID(), proposedAssignments = [input.assignedUserId];
  const fields = await retained.authorizeSchedule({ entry_id: entryId }, proposedAssignments, schedule ? 'update' : 'create');
  if (isScheduleFieldHidden(fields, ['tenant', 'entry_id', 'title', 'notes', 'scheduled_start', 'scheduled_end', 'assigned_user_ids', 'work_item_id', 'work_item_type', 'is_private', 'status'])) throw new CoManagedSharedWorkError();
  const values = { title: `Appointment: ${service.service_name}`, notes: [request.description, input.internalNotes].filter(Boolean).join('\n\n'), scheduled_start: start, scheduled_end: end,
    work_item_type: 'appointment_request' as const, work_item_id: input.id, status: 'scheduled', is_recurring: false, is_private: schedule?.is_private ?? false };
  return { change, retained, request, schedule, assignments, entryId, proposedAssignments, values };
}

/** Local approval transaction. This entry point does not create an external
 * meeting or deliver requester mail. */
export async function approveCoManagedNativeAppointment(db: Knex, tenant: string,
  input: NativeAppointmentApprovalInput,
  identify: () => Promise<CoManagedAuthenticatedActor>, publish: AppointmentPublisher) {
  input = { ...input };
  if (![input.id, input.assignedUserId].every(isCoManagedUuid) || input.ticketId != null && !isCoManagedUuid(input.ticketId) || input.internalNotes != null && (typeof input.internalNotes !== 'string' || input.internalNotes.length > 2000)) throw new CoManagedSharedWorkError();
  return withTransaction(db, async trx => {
    if (!await retainCoManagedTimeCalendar(trx, tenant)) return { handled: false as const };
    await assertCoManagedOperationalWrite(trx, tenant);
    const actor = snapshotCoManagedAuthenticatedActor(await identify()); if (actor.tenant !== tenant) throw new CoManagedSharedWorkError();
    const credential = await lockCoManagedLocalAuthentication(trx, actor), owner = tenantDb(trx, tenant);
    const { change, request, schedule, assignments, entryId, proposedAssignments, values } = await retainAppointmentApprovalPlan(trx, actor, credential.subject, input);
    let after: any;
    if (schedule) {
      [after] = await owner.table('schedule_entries').where('entry_id', entryId).update({ ...values, updated_at: trx.fn.now() }).returning('*');
      await owner.table('schedule_entry_assignees').where('entry_id', entryId).del();
      await owner.table('schedule_entry_assignees').insert({ tenant, entry_id: entryId, user_id: input.assignedUserId });
    } else after = await ScheduleEntry.create(trx, tenant, { ...values, assigned_user_ids: proposedAssignments }, { entryId, assignedUserIds: proposedAssignments, assignedByUserId: actor.userId });
    await owner.table('appointment_requests').where('appointment_request_id', input.id).update({ status: 'approved', schedule_entry_id: after.entry_id, preferred_assigned_user_id: input.assignedUserId,
      approved_by_user_id: actor.userId, approved_at: trx.fn.now(), ticket_id: change.ticketId, client_id: change.clientId, declined_reason: null, updated_at: trx.fn.now() });
    // The explicit status transition precedes relation synchronization. Generic
    // calendar edits still cannot approve a pending request.
    await applyNativeScheduleRelations(trx, actor, schedule, after, assignments, proposedAssignments, input.id);
    const current = await retainNativeAppointmentRequest(trx, actor, credential.subject, input.id, true);
    await current.authorizeSchedule(after, proposedAssignments, schedule ? 'update' : 'create');
    const requestView = await nativeAppointmentRequestView(trx, actor, credential.subject, current);
    await credential.assertCurrent(); await assertCoManagedOperationalWrite(trx, tenant);
    registerAfterCommit(trx, async () => { await publish({ eventType: schedule ? 'SCHEDULE_ENTRY_UPDATED' : 'SCHEDULE_ENTRY_CREATED', payload: { tenantId: tenant, userId: actor.userId, entryId: after.entry_id } }); }, 'native-appointment-approve');
    return { handled: true as const, request: requestView };
  });
}
