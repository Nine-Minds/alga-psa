import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { tenantDb, withTransaction } from '@alga-psa/db';
import { assertCoManagedOperationalWrite } from '@alga-psa/licensing';
import { retainCoManagedTimeCalendar } from './nativeTimePeriod';
import { approveCoManagedNativeAppointment, type NativeAppointmentApprovalInput } from './nativeAppointmentApproval';
import { prepareCoManagedAppointmentMeeting, MeetingCreationOperationConflict, type MeetingCreationTarget } from './meetingCreationOperation';
import { lockCoManagedLocalAuthentication, type CoManagedAuthenticatedActor } from './localAuthentication';
import { retainNativeAppointmentRequest, nativeAppointmentRequestView } from './nativeAppointmentRequest';
import { CoManagedSharedWorkError, isCoManagedUuid } from './sharedWorkIdentity';

const TABLE = 'co_managed_meeting_creation_operations';
type Identify = () => Promise<CoManagedAuthenticatedActor>;
type Publisher = Parameters<typeof approveCoManagedNativeAppointment>[4];
export interface AppointmentMeetingReceipt {
  eventId: string; organizerUserId: string; organizerUpn: string; microsoftTenantId: string; joinWebUrl: string | null;
}
export interface AppointmentMeetingDisclosure {
  subject: string; serviceName: string; description: string | null; appointmentRequestId: string;
  startDateTime: string; endDateTime: string;
  contact: { email: string; name: string | null }; technician: { email: string; name: string | null };
}
export type AppointmentMeetingIdentity = { operationId: string; target: MeetingCreationTarget };
export interface AppointmentMeetingProvider {
  target(): Promise<{ status: 'ready'; target: MeetingCreationTarget } | { status: 'skipped'; reason: string }>;
  create(disclosure: AppointmentMeetingDisclosure, identity: AppointmentMeetingIdentity): Promise<
    { status: 'created'; meeting: { eventId: string; meetingId: string; joinWebUrl: string; organizerUserId: string; organizerUpn: string } }
    | { status: 'skipped'; reason: string } | { status: 'failed'; errorCode: string; createdEvent?: AppointmentMeetingReceipt }>;
  recover(identity: AppointmentMeetingIdentity): Promise<{ status: 'found'; event: AppointmentMeetingReceipt; meetingId: string | null }
    | { status: 'absent' | 'skipped' | 'failed' }>;
  remove(receipt: AppointmentMeetingReceipt): Promise<{ status: 'deleted' | 'skipped' | 'failed' }>;
}

function receiptFor(target: MeetingCreationTarget, value: AppointmentMeetingReceipt | undefined): AppointmentMeetingReceipt | null {
  if (!value || typeof value.eventId !== 'string' || !value.eventId.trim() || value.organizerUserId !== target.organizerUserId || value.organizerUpn !== target.organizerUpn || typeof value.microsoftTenantId !== 'string' || value.microsoftTenantId.toLowerCase() !== target.microsoftTenantId.toLowerCase()) return null;
  let joinWebUrl: string | null = null;
  if (typeof value.joinWebUrl === 'string') {
    try { const url = new URL(value.joinWebUrl); if (url.protocol === 'https:' && !url.username && !url.password) joinWebUrl = url.href; } catch { /* Retain the event identity for cleanup even without a usable join URL. */ }
  }
  return { eventId: value.eventId, organizerUserId: target.organizerUserId, organizerUpn: target.organizerUpn, microsoftTenantId: target.microsoftTenantId, joinWebUrl };
}
const identityFor = (row: any): AppointmentMeetingIdentity => ({ operationId: row.operation_id, target: row.creation_target });
const actorFor = (tenant: string, row: any): CoManagedAuthenticatedActor => row.credential_kind === 'session'
  ? { kind: 'session', tenant, userId: row.requested_by, sessionId: row.credential_id }
  : { kind: 'api_key', tenant, userId: row.requested_by, apiKeyId: row.credential_id };

/** Re-admit the frozen intent in canonical source -> calendar -> operation lock
 * order. A hint is never authorization, nor is the captured credential alone. */
async function retainCreation(trx: Knex.Transaction, tenant: string, operationId: string, identify: Identify) {
  const owner = tenantDb(trx, tenant), hint = await owner.table(TABLE).where('operation_id', operationId).first();
  if (!hint || hint.completed_at || hint.purpose !== 'approve') throw new MeetingCreationOperationConflict();
  const admission = await prepareCoManagedAppointmentMeeting(trx, tenant, hint.approval_input, hint.creation_target, identify);
  if (!admission.handled || admission.operationId !== operationId) throw new CoManagedSharedWorkError();
  return owner.table(TABLE).where('operation_id', operationId).forUpdate().first();
}

/** Commit uncertainty BEFORE any provider call. Only the invocation which made
 * this transition may POST; retries and maintenance perform GET recovery. */
async function beginCreation(db: Knex, tenant: string, operationId: string, identify: Identify) {
  return withTransaction(db, async trx => {
    const row = await retainCreation(trx, tenant, operationId, identify);
    if (row.status !== 'prepared') return false;
    await tenantDb(trx, tenant).table(TABLE).where('operation_id', operationId).update({ status: 'uncertain', external_attempted_at: trx.fn.now(),
      attempt_count: row.attempt_count + 1, next_attempt_at: trx.raw("clock_timestamp() + interval '2 minutes'"), updated_at: trx.fn.now() });
    return true;
  });
}

async function executeCreation(db: Knex, tenant: string, operationId: string, identify: Identify, provider: AppointmentMeetingProvider) {
  return withTransaction(db, async trx => {
    const row = await retainCreation(trx, tenant, operationId, identify);
    if (row.status !== 'uncertain') return;
    let outcome: Awaited<ReturnType<AppointmentMeetingProvider['create']>>;
    try { outcome = await provider.create(row.provider_request, identityFor(row)); }
    catch { outcome = { status: 'failed', errorCode: 'provider_exception' }; }
    const event = receiptFor(row.creation_target, outcome.status === 'created'
      ? { ...outcome.meeting, microsoftTenantId: row.creation_target.microsoftTenantId } : outcome.status === 'failed' ? outcome.createdEvent : undefined);
    const meetingId = outcome.status === 'created' && typeof outcome.meeting.meetingId === 'string' && outcome.meeting.meetingId.trim() ? outcome.meeting.meetingId : null;
    const created = event?.joinWebUrl && meetingId;
    // Receipt bookkeeping must survive expiry DURING the irreversible provider
    // effect. Fresh authorization is required in the separate attachment tx.
    await tenantDb(trx, tenant).table(TABLE).where('operation_id', operationId).update({
      status: created ? 'created' : outcome.status === 'skipped' ? 'cleaned' : 'cleanup_pending',
      event_receipt: event ? JSON.stringify(event) : null, provider_meeting_id: meetingId,
      completed_at: outcome.status === 'skipped' ? trx.fn.now() : null,
      last_error_code: created ? null : outcome.status === 'skipped' ? 'provider_unavailable' : 'provider_creation_failed',
      next_attempt_at: trx.raw("clock_timestamp() + interval '2 minutes'"), updated_at: trx.fn.now(),
    });
  });
}

/** Narrow compensation authority comes from the actual durable operation. It
 * remains valid after source deletion, credential revocation or product lapse. */
async function requestCreationCleanup(db: Knex, tenant: string, operationId: string) {
  await withTransaction(db, async trx => {
    const owner = tenantDb(trx, tenant);
    if (!await owner.table('tenants').forShare().first('tenant')) return;
    const row = await owner.table(TABLE).where('operation_id', operationId).forUpdate().first();
    if (!row || row.completed_at) return;
    const untouched = row.status === 'prepared' && !row.external_attempted_at;
    await owner.table(TABLE).where('operation_id', operationId).update({ status: untouched ? 'abandoned' : 'cleanup_pending',
      completed_at: untouched ? trx.fn.now() : null, next_attempt_at: trx.fn.now(), updated_at: trx.fn.now() });
  });
}

async function attachCreation(db: Knex, tenant: string, operationId: string, identify: Identify, publish: Publisher) {
  return withTransaction(db, async trx => {
    const row = await retainCreation(trx, tenant, operationId, identify), owner = tenantDb(trx, tenant);
    const event = receiptFor(row.creation_target, row.event_receipt);
    if (row.status !== 'created' || !event?.joinWebUrl || !row.provider_meeting_id) throw new MeetingCreationOperationConflict();
    const actor = await identify(), credential = await lockCoManagedLocalAuthentication(trx, actor);
    const approval = await approveCoManagedNativeAppointment(trx, tenant, row.approval_input, identify, publish);
    if (!approval.handled) throw new CoManagedSharedWorkError();
    const request = await owner.table('appointment_requests').where('appointment_request_id', row.appointment_request_id).first();
    if (request.online_meeting_id || await owner.table('online_meetings').where('appointment_request_id', row.appointment_request_id).forUpdate().first('meeting_id')) throw new MeetingCreationOperationConflict();
    const meetingId = randomUUID();
    await owner.table('online_meetings').insert({ tenant, meeting_id: meetingId, provider: 'teams', provider_meeting_id: row.provider_meeting_id,
      provider_event_id: event.eventId, organizer_user_id: event.organizerUserId, organizer_upn: event.organizerUpn,
      subject: row.provider_request.subject, join_url: event.joinWebUrl, start_time: row.provider_request.startDateTime, end_time: row.provider_request.endDateTime,
      status: 'scheduled', appointment_request_id: row.appointment_request_id, schedule_entry_id: request.schedule_entry_id, created_by: actor.userId });
    await owner.table('appointment_requests').where('appointment_request_id', row.appointment_request_id).update({ online_meeting_id: row.provider_meeting_id,
      online_meeting_provider: 'teams', online_meeting_url: event.joinWebUrl, updated_at: trx.fn.now() });
    await owner.table(TABLE).where('operation_id', operationId).update({ status: 'attached', meeting_id: meetingId, completed_at: trx.fn.now(), updated_at: trx.fn.now() });
    const retained = await retainNativeAppointmentRequest(trx, actor, credential.subject, row.appointment_request_id);
    const view = await nativeAppointmentRequestView(trx, actor, credential.subject, retained);
    await credential.assertCurrent(); await assertCoManagedOperationalWrite(trx, tenant);
    return { handled: true as const, request: view };
  });
}

/** Actual Teams-enabled approval. No provider payload, credentials or journal
 * rows escape this boundary. Explicit failure never becomes later approval. */
export async function approveCoManagedAppointmentWithMeeting(db: Knex, tenant: string, input: NativeAppointmentApprovalInput,
  identify: Identify, publish: Publisher, provider: AppointmentMeetingProvider, approveWithoutMeeting = false) {
  if (!await withTransaction(db, trx => retainCoManagedTimeCalendar(trx, tenant))) return { handled: false as const };
  const target = await provider.target();
  if (target.status !== 'ready') {
    const result = await approveCoManagedNativeAppointment(db, tenant, input, identify, publish);
    return { ...result, warning: 'Appointment approved without a Teams meeting because Teams is unavailable.' };
  }
  const prepared = await prepareCoManagedAppointmentMeeting(db, tenant, input, target.target, identify);
  if (!prepared.handled) throw new CoManagedSharedWorkError();
  const operationId = prepared.operationId;
  try {
    if (await beginCreation(db, tenant, operationId, identify)) await executeCreation(db, tenant, operationId, identify, provider);
    const row = await tenantDb(db, tenant).table(TABLE).where('operation_id', operationId).first('status');
    if (row?.status === 'created') return await attachCreation(db, tenant, operationId, identify, publish);
    // Concurrent or interrupted calls must settle before a fresh attempt. Do
    // not convert an in-flight successful invocation into cleanup here.
    if (row?.status === 'uncertain' || row?.status === 'attached') throw new MeetingCreationOperationConflict();
    if (approveWithoutMeeting || row?.status === 'cleaned') {
      const result = await approveCoManagedNativeAppointment(db, tenant, input, identify, publish);
      return { ...result, warning: 'Appointment approved without a Teams meeting. Any incomplete meeting will be cleaned up.' };
    }
    return { handled: true as const, meetingCreationFailed: true as const };
  } catch (error) {
    // Conflict may simply mean another invocation still owns the attempt.
    if (!(error instanceof MeetingCreationOperationConflict)) await requestCreationCleanup(db, tenant, operationId);
    throw error;
  }
}

/** GET-only recovery of an interrupted creation; deletion is bound to the
 * original directory, organizer and actual event receipt. No source text or
 * new attendees can be disclosed by this worker. */
export async function recoverCoManagedAppointmentMeeting(db: Knex, tenant: string, operationId: string,
  provider: AppointmentMeetingProvider, publish: Publisher) {
  if (![tenant, operationId].every(isCoManagedUuid)) throw new CoManagedSharedWorkError();
  const recovered = await withTransaction(db, async trx => {
    const owner = tenantDb(trx, tenant);
    if (!await owner.table('tenants').forShare().first('tenant')) return { status: 'obsolete' as const };
    const row = await owner.table(TABLE).where('operation_id', operationId).forUpdate().first();
    if (!row || row.completed_at) return { status: 'obsolete' as const };
    if (!await owner.table(TABLE).where('operation_id', operationId).where('next_attempt_at', '<=', trx.raw('clock_timestamp()')).first('operation_id')) return { status: 'deferred' as const };
    if (row.status === 'prepared') {
      if (await owner.table(TABLE).where('operation_id', operationId).where('created_at', '<=', trx.raw("clock_timestamp() - interval '15 minutes'")).first('operation_id')) {
        await owner.table(TABLE).where('operation_id', operationId).update({ status: 'abandoned', completed_at: trx.fn.now(), updated_at: trx.fn.now() });
        return { status: 'abandoned' as const };
      }
      return { status: 'deferred' as const };
    }
    let event = receiptFor(row.creation_target, row.event_receipt), meetingId = row.provider_meeting_id;
    let status = row.status, terminal = false;
    try {
      if (!event || status !== 'cleanup_pending' && (!meetingId || !event.joinWebUrl)) {
        const outcome = await provider.recover(identityFor(row));
        if (outcome.status === 'found') {
          event = receiptFor(row.creation_target, outcome.event);
          meetingId = typeof outcome.meetingId === 'string' && outcome.meetingId.trim() ? outcome.meetingId : null;
        }
      }
      if (status === 'cleanup_pending' && event) terminal = (await provider.remove(event)).status === 'deleted';
      else if (event?.joinWebUrl && meetingId) status = 'created';
    } catch { /* Persist a bounded retry, never a raw transport error. */ }
    await owner.table(TABLE).where('operation_id', operationId).update({ status: terminal ? 'cleaned' : status,
      event_receipt: event ? JSON.stringify(event) : null, provider_meeting_id: meetingId, completed_at: terminal ? trx.fn.now() : null,
      attempt_count: Math.min(2147483647, row.attempt_count + 1), last_error_code: terminal || status === 'created' ? null : 'creation_recovery_pending',
      next_attempt_at: trx.raw("clock_timestamp() + (least(3600, power(2, least(?, 12)) * 30) * interval '1 second')", [row.attempt_count + 1]), updated_at: trx.fn.now() });
    return { status: terminal ? 'cleaned' as const : status === 'created' ? 'attach' as const : 'retry' as const, actor: actorFor(tenant, row) };
  });
  if (recovered.status !== 'attach') return { status: recovered.status };
  try {
    await attachCreation(db, tenant, operationId, async () => recovered.actor!, publish);
    return { status: 'attached' as const };
  } catch {
    await requestCreationCleanup(db, tenant, operationId);
    return { status: 'retry' as const };
  }
}
