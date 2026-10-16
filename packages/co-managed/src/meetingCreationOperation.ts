import { createHash, randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { tenantDb, withTransaction } from '@alga-psa/db';
import { assertCoManagedOperationalWrite } from '@alga-psa/licensing';
import { retainCoManagedTimeCalendar } from './nativeTimePeriod';
import { retainAppointmentApprovalPlan, retainAppointmentMeetingGenerationPlan, type NativeAppointmentApprovalInput } from './nativeAppointmentApproval';
import { nativeAppointmentRequestView, isAppointmentFieldHidden } from './nativeAppointmentRequest';
import { lockCoManagedLocalAuthentication, snapshotCoManagedAuthenticatedActor, type CoManagedAuthenticatedActor } from './localAuthentication';
import { authorizeCoManagedLocalRecord, CoManagedSharedWorkError } from './sharedWorkIdentity';
import { isCoManagedReadFieldHidden } from './sharedWorkRedaction';

export interface MeetingCreationTarget { microsoftTenantId: string; organizerUserId: string; organizerUpn: string; sendMeetingInvites: boolean }
export class MeetingCreationOperationConflict extends Error {
  readonly code = 'MEETING_CREATION_OPERATION_CONFLICT';
  constructor() { super('Recover the existing meeting creation operation before changing its details.'); this.name = 'MeetingCreationOperationConflict'; }
}
const TABLE = 'co_managed_meeting_creation_operations';
const email = (value: unknown) => typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value.trim() : null;

export type AppointmentMeetingIntent = { purpose: 'approve'; input: NativeAppointmentApprovalInput } | { purpose: 'generate'; input: { id: string } };

/** Retained callers own the request and allocation locks before inspecting
 * their provider binding. Only an undisclosed failed placeholder is reusable. */
export async function retainAppointmentMeetingSlot(trx: Knex.Transaction, tenant: string, request: any, purpose: AppointmentMeetingIntent['purpose']) {
  const owner = tenantDb(trx, tenant);
  if (!trx.isTransaction || request.online_meeting_id || request.online_meeting_url) throw new MeetingCreationOperationConflict();
  const rows = await owner.table('online_meetings').where(query => {
    query.where('appointment_request_id', request.appointment_request_id);
    if (request.schedule_entry_id) query.orWhere('schedule_entry_id', request.schedule_entry_id);
  }).orderBy('meeting_id').forUpdate();
  if (!rows.length) return null;
  const row = rows[0];
  if (purpose !== 'generate' || rows.length !== 1 || row.appointment_request_id !== request.appointment_request_id ||
    row.schedule_entry_id && row.schedule_entry_id !== request.schedule_entry_id || row.provider !== 'teams' || row.status !== 'failed' ||
    row.provider_meeting_id || row.provider_event_id || row.join_url || row.interaction_id || row.co_managed_sync_operation_id ||
    await owner.table('online_meeting_artifacts').where('meeting_id', row.meeting_id).forShare().first('artifact_id')) throw new MeetingCreationOperationConflict();
  return row;
}

export function prepareCoManagedAppointmentMeeting(db: Knex, tenant: string, input: NativeAppointmentApprovalInput, target: MeetingCreationTarget,
  identify: () => Promise<CoManagedAuthenticatedActor>) {
  return prepareAppointmentMeeting(db, tenant, { purpose: 'approve', input }, target, identify);
}

export function prepareCoManagedApprovedAppointmentMeeting(db: Knex, tenant: string, requestId: string, target: MeetingCreationTarget,
  identify: () => Promise<CoManagedAuthenticatedActor>) {
  return prepareAppointmentMeeting(db, tenant, { purpose: 'generate', input: { id: requestId } }, target, identify);
}

/** Reserves only an admitted disclosure. The provider target is supplied by the
 * trusted Teams adapter, never copied from browser input. No network call or
 * approval transition occurs here, and journal rows are not public DTOs. */
async function prepareAppointmentMeeting(db: Knex, tenant: string, intent: AppointmentMeetingIntent, suppliedTarget: MeetingCreationTarget,
  identify: () => Promise<CoManagedAuthenticatedActor>) {
  intent = intent.purpose === 'approve' ? { purpose: 'approve', input: { id: intent.input.id, assignedUserId: intent.input.assignedUserId,
    finalDate: intent.input.finalDate ?? null, finalTime: intent.input.finalTime ?? null, ticketId: intent.input.ticketId ?? null, internalNotes: intent.input.internalNotes ?? null } }
    : { purpose: 'generate', input: { id: intent.input.id } };
  const input = intent.input;
  const target = { microsoftTenantId: suppliedTarget.microsoftTenantId, organizerUserId: suppliedTarget.organizerUserId, organizerUpn: suppliedTarget.organizerUpn, sendMeetingInvites: suppliedTarget.sendMeetingInvites };
  if (![target.microsoftTenantId, target.organizerUserId, target.organizerUpn].every(value => typeof value === 'string' && value.trim()) || typeof target.sendMeetingInvites !== 'boolean') throw new CoManagedSharedWorkError();
  return withTransaction(db, async trx => {
    if (!await retainCoManagedTimeCalendar(trx, tenant)) return { handled: false as const };
    await assertCoManagedOperationalWrite(trx, tenant);
    const actor = snapshotCoManagedAuthenticatedActor(await identify()); if (actor.tenant !== tenant) throw new CoManagedSharedWorkError();
    const credential = await lockCoManagedLocalAuthentication(trx, actor), owner = tenantDb(trx, tenant);
    const plan = intent.purpose === 'approve' ? await retainAppointmentApprovalPlan(trx, actor, credential.subject, intent.input)
      : await retainAppointmentMeetingGenerationPlan(trx, actor, credential.subject, input.id);
    if (isAppointmentFieldHidden(plan.retained.fields, ['online_meeting_id', 'online_meeting_provider', 'online_meeting_url'])) throw new CoManagedSharedWorkError();
    const failedMeeting = await retainAppointmentMeetingSlot(trx, tenant, plan.request, intent.purpose);
    const view = await nativeAppointmentRequestView(trx, actor, credential.subject, plan.retained);
    const technicians: Array<{ email: string; name: string | null }> = [];
    for (const userId of plan.proposedAssignments) {
      const technician = await owner.table('users').where({ user_id: userId, user_type: 'internal', is_inactive: false }).forShare().first('email', 'first_name', 'last_name');
      const userScope = await authorizeCoManagedLocalRecord(trx, actor, credential.subject, 'user', 'read', { id: userId, ownerUserId: userId });
      if (isCoManagedReadFieldHidden(userScope.redactedFields, ['email', 'first_name', 'last_name', 'users.email', 'users.first_name', 'users.last_name', 'values.email', 'values.first_name', 'values.last_name'])) throw new CoManagedSharedWorkError();
      const technicianEmail = email(technician?.email);
      if (!technicianEmail) throw new CoManagedSharedWorkError();
      technicians.push({ email: technicianEmail, name: [technician.first_name, technician.last_name].filter(Boolean).join(' ') || null });
    }
    const requesterEmail = email(plan.request.is_authenticated && plan.request.contact_id ? view.contact_email : view.requester_email);
    if (!requesterEmail || typeof view.service_name !== 'string') throw new CoManagedSharedWorkError();
    const providerRequest = {
      subject: `Appointment: ${view.service_name}`, serviceName: view.service_name, description: view.description ?? null,
      appointmentRequestId: input.id, startDateTime: plan.values.scheduled_start.toISOString(), endDateTime: plan.values.scheduled_end.toISOString(),
      contact: { email: requesterEmail, name: plan.request.is_authenticated && plan.request.contact_id ? view.contact_name ?? null : view.requester_name ?? null },
      // Keep the existing approval journal encoding stable across deployment.
      ...(intent.purpose === 'approve' ? { technician: technicians[0] } : { technician: null, technicians }),
    };
    // Internal approval notes stay in approval_input for the local transaction;
    // they must never enter the frozen provider disclosure.
    const fingerprint = createHash('sha256').update(JSON.stringify({ input, target, providerRequest, request: plan.request, schedule: plan.schedule, assignments: plan.assignments,
      ...(intent.purpose === 'generate' ? { purpose: intent.purpose, failedMeeting } : {}) })).digest('hex');
    const active = await owner.table(TABLE).where('appointment_request_id', input.id).whereNull('completed_at').forUpdate().first();
    if (active && (active.purpose !== intent.purpose || active.requested_by !== actor.userId || active.request_fingerprint !== fingerprint)) throw new MeetingCreationOperationConflict();
    const operationId = active?.operation_id ?? randomUUID();
    if (!active) await owner.table(TABLE).insert({ tenant, operation_id: operationId, appointment_request_id: input.id, requested_by: actor.userId,
      credential_kind: actor.kind, credential_id: actor.kind === 'session' ? actor.sessionId : actor.apiKeyId, purpose: intent.purpose, approval_input: JSON.stringify(input),
      request_fingerprint: fingerprint, creation_target: JSON.stringify(target), provider_request: JSON.stringify(providerRequest), status: 'prepared' });
    await credential.assertCurrent(); await assertCoManagedOperationalWrite(trx, tenant);
    return { handled: true as const, operationId, status: active?.status ?? 'prepared' };
  });
}
