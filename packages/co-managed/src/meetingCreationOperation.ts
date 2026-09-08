import { createHash, randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { tenantDb, withTransaction } from '@alga-psa/db';
import { assertCoManagedOperationalWrite } from '@alga-psa/licensing';
import { retainCoManagedTimeCalendar } from './nativeTimePeriod';
import { retainAppointmentApprovalPlan, type NativeAppointmentApprovalInput } from './nativeAppointmentApproval';
import { nativeAppointmentRequestView } from './nativeAppointmentRequest';
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

/** Reserves only an admitted disclosure. The provider target is supplied by the
 * trusted Teams adapter, never copied from browser input. No network call or
 * approval transition occurs here, and journal rows are not public DTOs. */
export async function prepareCoManagedAppointmentMeeting(db: Knex, tenant: string, input: NativeAppointmentApprovalInput, suppliedTarget: MeetingCreationTarget,
  identify: () => Promise<CoManagedAuthenticatedActor>) {
  input = { id: input.id, assignedUserId: input.assignedUserId, finalDate: input.finalDate ?? null, finalTime: input.finalTime ?? null, ticketId: input.ticketId ?? null, internalNotes: input.internalNotes ?? null };
  const target = { microsoftTenantId: suppliedTarget.microsoftTenantId, organizerUserId: suppliedTarget.organizerUserId, organizerUpn: suppliedTarget.organizerUpn, sendMeetingInvites: suppliedTarget.sendMeetingInvites };
  if (![target.microsoftTenantId, target.organizerUserId, target.organizerUpn].every(value => typeof value === 'string' && value.trim()) || typeof target.sendMeetingInvites !== 'boolean') throw new CoManagedSharedWorkError();
  return withTransaction(db, async trx => {
    if (!await retainCoManagedTimeCalendar(trx, tenant)) return { handled: false as const };
    await assertCoManagedOperationalWrite(trx, tenant);
    const actor = snapshotCoManagedAuthenticatedActor(await identify()); if (actor.tenant !== tenant) throw new CoManagedSharedWorkError();
    const credential = await lockCoManagedLocalAuthentication(trx, actor), owner = tenantDb(trx, tenant);
    const plan = await retainAppointmentApprovalPlan(trx, actor, credential.subject, input);
    const view = await nativeAppointmentRequestView(trx, actor, credential.subject, plan.retained);
    const technician = await owner.table('users').where({ user_id: input.assignedUserId, user_type: 'internal', is_inactive: false }).forShare().first('email', 'first_name', 'last_name');
    const userScope = await authorizeCoManagedLocalRecord(trx, actor, credential.subject, 'user', 'read', { id: input.assignedUserId, ownerUserId: input.assignedUserId });
    if (isCoManagedReadFieldHidden(userScope.redactedFields, ['email', 'first_name', 'last_name', 'users.email', 'users.first_name', 'users.last_name', 'values.email', 'values.first_name', 'values.last_name'])) throw new CoManagedSharedWorkError();
    const technicianEmail = email(technician?.email), requesterEmail = email(plan.request.is_authenticated && plan.request.contact_id ? view.contact_email : view.requester_email);
    if (!technicianEmail || !requesterEmail || typeof view.service_name !== 'string') throw new CoManagedSharedWorkError();
    const providerRequest = {
      subject: `Appointment: ${view.service_name}`, serviceName: view.service_name, description: view.description ?? null,
      appointmentRequestId: input.id, startDateTime: plan.values.scheduled_start.toISOString(), endDateTime: plan.values.scheduled_end.toISOString(),
      contact: { email: requesterEmail, name: plan.request.is_authenticated && plan.request.contact_id ? view.contact_name ?? null : view.requester_name ?? null },
      technician: { email: technicianEmail, name: [technician.first_name, technician.last_name].filter(Boolean).join(' ') || null },
    };
    // Internal approval notes stay in approval_input for the local transaction;
    // they must never enter the frozen provider disclosure.
    const fingerprint = createHash('sha256').update(JSON.stringify({ input, target, providerRequest, request: plan.request, schedule: plan.schedule, assignments: plan.assignments })).digest('hex');
    const active = await owner.table(TABLE).where('appointment_request_id', input.id).whereNull('completed_at').forUpdate().first();
    if (active && (active.requested_by !== actor.userId || active.request_fingerprint !== fingerprint)) throw new MeetingCreationOperationConflict();
    const operationId = active?.operation_id ?? randomUUID();
    if (!active) await owner.table(TABLE).insert({ tenant, operation_id: operationId, appointment_request_id: input.id, requested_by: actor.userId,
      credential_kind: actor.kind, credential_id: actor.kind === 'session' ? actor.sessionId : actor.apiKeyId, purpose: 'approve', approval_input: JSON.stringify(input),
      request_fingerprint: fingerprint, creation_target: JSON.stringify(target), provider_request: JSON.stringify(providerRequest), status: 'prepared' });
    await credential.assertCurrent(); await assertCoManagedOperationalWrite(trx, tenant);
    return { handled: true as const, operationId, status: active?.status ?? 'prepared' };
  });
}
