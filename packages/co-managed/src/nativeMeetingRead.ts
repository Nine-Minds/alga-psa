import type { IOnlineMeetingView, IOnlineMeetingArtifactView } from '@alga-psa/types';
import type { Knex } from 'knex';
import type { AuthorizationSubject } from '@alga-psa/authorization';
import { tenantDb, withTransaction } from '@alga-psa/db';
import { retainCoManagedTimeCalendar } from './nativeTimePeriod';
import { retainNativeAppointmentRequest } from './nativeAppointmentRequest';
import { retainScheduleSource } from './nativeScheduleRead';
import { lockCoManagedLocalAuthentication, snapshotCoManagedAuthenticatedActor, type CoManagedAuthenticatedActor } from './localAuthentication';
import { authorizeCoManagedLocalRecord, CoManagedSharedWorkError, isCoManagedUuid } from './sharedWorkIdentity';

/** A recording cannot have its confidential fields removed. Require full read
 * admission to every actual owner before exposing its metadata or bytes. */
export async function retainNativeOnlineMeeting(trx: Knex.Transaction, actor: CoManagedAuthenticatedActor, subject: AuthorizationSubject, meetingId: string) {
  if (!trx.isTransaction || !isCoManagedUuid(meetingId)) throw new CoManagedSharedWorkError();
  const owner = tenantDb(trx, actor.tenant), hint = await owner.table('online_meetings').where('meeting_id', meetingId).first();
  if (!hint || (!hint.appointment_request_id && !hint.interaction_id)) throw new CoManagedSharedWorkError();
  const appointment = hint.appointment_request_id ? await retainNativeAppointmentRequest(trx, actor, subject, hint.appointment_request_id) : null;
  if (appointment?.fields.length) throw new CoManagedSharedWorkError();
  const interaction = hint.interaction_id ? await retainScheduleSource(trx, actor, subject, { work_item_type: 'interaction', work_item_id: hint.interaction_id }) : null;
  if (interaction?.fields.length) throw new CoManagedSharedWorkError();
  if (appointment && interaction && appointment.request.client_id && interaction.record.clientId && appointment.request.client_id !== interaction.record.clientId) throw new CoManagedSharedWorkError();
  if (hint.schedule_entry_id) {
    const schedule = await owner.table('schedule_entries').where('entry_id', hint.schedule_entry_id).forShare().first();
    const assignments: string[] = (await owner.table('schedule_entry_assignees').where('entry_id', hint.schedule_entry_id).orderBy('user_id').forShare().select('user_id')).map(row => row.user_id);
    const canonical = schedule && ((appointment && schedule.work_item_type === 'appointment_request' && schedule.work_item_id === hint.appointment_request_id)
      || (appointment?.request.ticket_id && schedule.work_item_type === 'ticket' && schedule.work_item_id === appointment.request.ticket_id)
      || (interaction && schedule.work_item_type === 'interaction' && schedule.work_item_id === hint.interaction_id));
    if (!canonical || appointment && appointment.request.schedule_entry_id !== hint.schedule_entry_id || schedule.is_private && !(assignments.length === 1 && assignments[0] === actor.userId)) throw new CoManagedSharedWorkError();
    const fields = appointment ? await appointment.authorizeSchedule(schedule, assignments)
      : (await authorizeCoManagedLocalRecord(trx, actor, subject, 'user_schedule', 'read', { ...interaction!.record, id: schedule.entry_id, assignedUserIds: assignments, ownerUserId: assignments.length === 1 ? assignments[0] : undefined })).redactedFields;
    if (fields.length) throw new CoManagedSharedWorkError();
  } else if (appointment?.request.schedule_entry_id) throw new CoManagedSharedWorkError();
  const meeting = await owner.table('online_meetings').where('meeting_id', meetingId).forShare().first();
  if (!meeting || ['appointment_request_id', 'interaction_id', 'schedule_entry_id'].some(key => meeting[key] !== hint[key])) throw new CoManagedSharedWorkError();
  return { meeting, clientId: appointment?.request.client_id ?? interaction?.record.clientId ?? null };
}

async function retainArtifactDocument(trx: Knex.Transaction, actor: CoManagedAuthenticatedActor, subject: AuthorizationSubject, artifact: any, clientId: string | null) {
  if (!artifact.document_id) return null;
  const document = await tenantDb(trx, actor.tenant).table('documents').where('document_id', artifact.document_id).forShare().first();
  if (!document) throw new CoManagedSharedWorkError();
  const decision = await authorizeCoManagedLocalRecord(trx, actor, subject, 'document', 'read', { id: document.document_id, clientId: clientId ?? undefined, ownerUserId: document.created_by ?? document.user_id });
  if (decision.redactedFields.length) throw new CoManagedSharedWorkError();
  return document;
}

async function nativeMeetingArtifacts(trx: Knex.Transaction, actor: CoManagedAuthenticatedActor, subject: AuthorizationSubject,
  retained: Awaited<ReturnType<typeof retainNativeOnlineMeeting>>): Promise<IOnlineMeetingArtifactView[]> {
  const owner = tenantDb(trx, actor.tenant), views: IOnlineMeetingArtifactView[] = [];
  const artifacts = await owner.table('online_meeting_artifacts').where('meeting_id', retained.meeting.meeting_id).orderBy('created_date_time', 'desc').orderBy('artifact_id').forShare();
  for (const artifact of artifacts) {
    if (!['recording', 'transcript'].includes(artifact.artifact_type)) continue;
    try {
      await retainArtifactDocument(trx, actor, subject, artifact, retained.clientId);
      views.push({ artifact_id: artifact.artifact_id, artifact_type: artifact.artifact_type, document_id: null,
        created_date_time: artifact.created_date_time, download_url: `/api/online-meetings/artifacts/${artifact.artifact_id}` });
    } catch (error) { if (!(error instanceof CoManagedSharedWorkError)) throw error; }
  }
  return views;
}

export async function nativeAppointmentMeetingArtifacts(trx: Knex.Transaction, actor: CoManagedAuthenticatedActor, subject: AuthorizationSubject, requestId: string) {
  const owner = tenantDb(trx, actor.tenant), views: IOnlineMeetingArtifactView[] = [];
  const ids = await owner.table('online_meetings').where('appointment_request_id', requestId).orderBy('meeting_id').select('meeting_id');
  for (const row of ids) {
    try { views.push(...await nativeMeetingArtifacts(trx, actor, subject, await retainNativeOnlineMeeting(trx, actor, subject, row.meeting_id))); }
    catch (error) { if (!(error instanceof CoManagedSharedWorkError)) throw error; }
  }
  return views;
}

export async function nativeInteractionMeetingView(trx: Knex.Transaction, actor: CoManagedAuthenticatedActor, subject: AuthorizationSubject, interactionId: string): Promise<IOnlineMeetingView | null> {
  const source = await retainScheduleSource(trx, actor, subject, { work_item_type: 'interaction', work_item_id: interactionId });
  if (source.fields.length) return null;
  const hint = await tenantDb(trx, actor.tenant).table('online_meetings').where('interaction_id', interactionId).orderBy('created_at', 'desc').orderBy('meeting_id').first('meeting_id');
  if (!hint) return null;
  let retained: Awaited<ReturnType<typeof retainNativeOnlineMeeting>>;
  try { retained = await retainNativeOnlineMeeting(trx, actor, subject, hint.meeting_id); }
  catch (error) { if (!(error instanceof CoManagedSharedWorkError)) throw error; return null; }
  if (retained.meeting.interaction_id !== interactionId) throw new CoManagedSharedWorkError();
  const row = retained.meeting;
  return { tenant: actor.tenant, meeting_id: row.meeting_id, provider: row.provider, subject: row.subject, join_url: row.join_url,
    start_time: row.start_time, end_time: row.end_time, status: row.status, appointment_request_id: row.appointment_request_id,
    interaction_id: row.interaction_id, schedule_entry_id: row.schedule_entry_id, created_at: row.created_at, updated_at: row.updated_at,
    artifacts: await nativeMeetingArtifacts(trx, actor, subject, retained) };
}

export async function readCoManagedInteractionMeeting(db: Knex, tenant: string, interactionId: string, identify: () => Promise<CoManagedAuthenticatedActor>) {
  return withTransaction(db, async trx => {
    if (!await retainCoManagedTimeCalendar(trx, tenant)) return { handled: false as const };
    const actor = snapshotCoManagedAuthenticatedActor(await identify()); if (actor.tenant !== tenant) throw new CoManagedSharedWorkError();
    const credential = await lockCoManagedLocalAuthentication(trx, actor);
    const meeting = await nativeInteractionMeetingView(trx, actor, credential.subject, interactionId);
    await credential.assertCurrent();
    return { handled: true as const, meeting };
  });
}

export interface NativeMeetingArtifactContent {
  artifactId: string; type: 'recording' | 'transcript'; fileId: string | null; blocks: unknown;
  provider: { microsoftTenantId: string; organizerUserId: string; meetingId: string; artifactId: string } | null;
}

/** Callback delivery keeps source, calendar, artifact and actual credential
 * retained through content lookup. Streaming callers cancel a prepared body if
 * final credential validation fails before the response is returned. */
export async function consumeCoManagedMeetingArtifact<T>(db: Knex, tenant: string, artifactId: string,
  identify: () => Promise<CoManagedAuthenticatedActor>, consume: (content: NativeMeetingArtifactContent) => Promise<{ value: T; discard?: () => Promise<void> }>) {
  return withTransaction(db, async trx => {
    if (!await retainCoManagedTimeCalendar(trx, tenant)) return { handled: false as const };
    if (!isCoManagedUuid(artifactId)) throw new CoManagedSharedWorkError();
    const actor = snapshotCoManagedAuthenticatedActor(await identify()); if (actor.tenant !== tenant) throw new CoManagedSharedWorkError();
    const credential = await lockCoManagedLocalAuthentication(trx, actor), owner = tenantDb(trx, tenant);
    const hint = await owner.table('online_meeting_artifacts').where('artifact_id', artifactId).first('meeting_id');
    if (!hint) throw new CoManagedSharedWorkError();
    const retained = await retainNativeOnlineMeeting(trx, actor, credential.subject, hint.meeting_id);
    const artifact = await owner.table('online_meeting_artifacts').where('artifact_id', artifactId).forShare().first();
    if (!artifact || artifact.meeting_id !== hint.meeting_id || !['recording', 'transcript'].includes(artifact.artifact_type)) throw new CoManagedSharedWorkError();
    const document = await retainArtifactDocument(trx, actor, credential.subject, artifact, retained.clientId);
    const fileId = artifact.file_id ?? document?.file_id ?? null;
    if (fileId && !await owner.table('external_files').where({ file_id: fileId, is_deleted: false }).forShare().first('file_id')) throw new CoManagedSharedWorkError();
    const block = document ? await owner.table('document_block_content').where('document_id', document.document_id).forShare().first('block_data') : null;
    const creation = await owner.table('co_managed_meeting_creation_operations').where({ meeting_id: retained.meeting.meeting_id, status: 'attached' }).forShare().first('creation_target', 'event_receipt', 'provider_meeting_id');
    const provider = creation?.creation_target?.microsoftTenantId && creation.event_receipt?.eventId === retained.meeting.provider_event_id && creation.provider_meeting_id === retained.meeting.provider_meeting_id && creation.creation_target.organizerUserId === retained.meeting.organizer_user_id
      ? { microsoftTenantId: creation.creation_target.microsoftTenantId, organizerUserId: retained.meeting.organizer_user_id, meetingId: retained.meeting.provider_meeting_id, artifactId: artifact.provider_artifact_id } : null;
    const prepared = await consume({ artifactId, type: artifact.artifact_type, fileId, blocks: block?.block_data ?? null, provider });
    try { await credential.assertCurrent(); } catch (error) { await prepared.discard?.(); throw error; }
    return { handled: true as const, value: prepared.value };
  });
}

/** Generic document routes must not turn a captured transcript into an escape
 * from the meeting's current owners. All artifact bindings must admit the reader. */
export async function admitCoManagedMeetingDocuments(db: Knex, tenant: string, documentIds: string[], identify: () => Promise<CoManagedAuthenticatedActor>) {
  return withTransaction(db, async trx => {
    if (!await retainCoManagedTimeCalendar(trx, tenant)) return { handled: false as const };
    const owner = tenantDb(trx, tenant), bindings = await owner.table('online_meeting_artifacts').whereIn('document_id', documentIds).orderBy('meeting_id').select('artifact_id', 'document_id', 'meeting_id');
    if (!bindings.length) return { handled: true as const, deniedDocumentIds: [] as string[] };
    const actor = snapshotCoManagedAuthenticatedActor(await identify()); if (actor.tenant !== tenant) throw new CoManagedSharedWorkError();
    const credential = await lockCoManagedLocalAuthentication(trx, actor), denied = new Set<string>();
    for (const binding of bindings) {
      try {
        const retained = await retainNativeOnlineMeeting(trx, actor, credential.subject, binding.meeting_id);
        const current = await owner.table('online_meeting_artifacts').where('artifact_id', binding.artifact_id).forShare().first();
        if (!current || current.document_id !== binding.document_id || current.meeting_id !== binding.meeting_id) throw new CoManagedSharedWorkError();
        await retainArtifactDocument(trx, actor, credential.subject, current, retained.clientId);
      }
      catch (error) { if (!(error instanceof CoManagedSharedWorkError)) throw error; denied.add(binding.document_id); }
    }
    await credential.assertCurrent();
    return { handled: true as const, deniedDocumentIds: [...denied], assertCurrent: credential.assertCurrent };
  });
}
