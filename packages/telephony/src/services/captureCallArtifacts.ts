import logger from '@alga-psa/core/logger';
import { createTenantKnex, tenantDb } from '@alga-psa/db';
import type {
  CallArtifactPayload,
  CallArtifactStatus,
  TelephonyCallArtifactRow,
  TelephonyCallRecordRow,
} from '../types';
import { buildCallInteractionTitle } from '../lib/callInteractions';
import { hasCallArtifactWindowElapsed, isCallArtifactFetchDue } from '../lib/callArtifactBackoff';
import { createCallTranscriptDocument } from '../lib/callArtifactDocuments';
import { tenantHasTelephonyFeatureAccess } from '../lib/telephonyFeatureGate';

export interface CallArtifactCaptureSettings {
  /** Store the recording blob, not just the pointer (recordings are large). */
  downloadRecordings: boolean;
  /** Whether the transcript document is visible in the client portal. */
  exposeRecordingsInPortal: boolean;
}

export interface CaptureCallArtifactsInput {
  tenantId: string;
  callRecordId: string;
  actorUserId?: string | null;
  knex?: any;
}

export interface CaptureCallArtifactsDependencies {
  /** Provider fetch (Teams ad hoc call artifacts); injected so the core stays vendor-neutral. */
  fetchArtifacts?: (input: {
    tenantId: string;
    providerCallId: string;
    organizerUserId: string;
    startedAt?: Date | string | null;
  }) => Promise<CallArtifactPayload[]>;
  /** Download and store a recording blob; returns the stored file id. */
  downloadRecording?: (input: {
    tenantId: string;
    call: TelephonyCallRecordRow;
    artifact: CallArtifactPayload;
    actorUserId: string;
  }) => Promise<string | null>;
  createTranscriptDocument?: typeof createCallTranscriptDocument;
  /** EE hook: AI-summarize a fresh transcript onto the call's ticket. */
  annotateTicketFromTranscript?: (input: {
    tenantId: string;
    source: 'call';
    callRecordId: string;
    ticketId?: string | null;
    interactionId?: string | null;
    subject?: string | null;
    transcriptVtt: string;
    providerArtifactId?: string | null;
  }) => Promise<unknown>;
  loadSettings?: (tenantId: string) => Promise<CallArtifactCaptureSettings>;
  now?: () => Date;
}

export type CaptureCallArtifactsOutcome =
  | {
      status: 'skipped';
      reason: 'feature_disabled' | 'not_found' | 'not_due' | 'no_organizer' | 'settled';
    }
  | { status: 'captured'; artifactStatus: CallArtifactStatus; captured: number };

async function noopFetchArtifacts(): Promise<CallArtifactPayload[]> {
  return [];
}

async function defaultSettings(): Promise<CallArtifactCaptureSettings> {
  return { downloadRecordings: false, exposeRecordingsInPortal: false };
}

/**
 * Poll one call's recording/transcript artifacts and persist what is there
 * (F066/F067).
 *
 * Graph publishes ad hoc call artifacts minutes after the call ends and never
 * notifies about them, so this runs on a bounded poll: the notification handler
 * takes the first attempt and the sweep retries until artifacts land or the
 * window closes. Every step is idempotent — a re-poll re-links the artifacts it
 * already stored instead of duplicating them.
 */
export async function captureCallArtifacts(
  input: CaptureCallArtifactsInput,
  dependencies: CaptureCallArtifactsDependencies = {},
): Promise<CaptureCallArtifactsOutcome> {
  const fetchArtifacts = dependencies.fetchArtifacts ?? noopFetchArtifacts;
  const persistTranscript = dependencies.createTranscriptDocument ?? createCallTranscriptDocument;
  const loadSettings = dependencies.loadSettings ?? defaultSettings;
  const now = dependencies.now ?? (() => new Date());

  const knex = input.knex ?? (await createTenantKnex(input.tenantId)).knex;
  const db = tenantDb(knex, input.tenantId);

  if (!(await tenantHasTelephonyFeatureAccess(input.tenantId))) {
    return { status: 'skipped', reason: 'feature_disabled' };
  }

  const call: TelephonyCallRecordRow | undefined = await db.table('telephony_call_records')
    .where({ call_record_id: input.callRecordId })
    .first();

  if (!call) {
    return { status: 'skipped', reason: 'not_found' };
  }

  // `ready` and `none` are settled: nothing more to fetch, or nothing to find.
  if (call.artifact_status === 'ready' || call.artifact_status === 'none') {
    return { status: 'skipped', reason: 'settled' };
  }

  if (!isCallArtifactFetchDue(call, now())) {
    return { status: 'skipped', reason: 'not_due' };
  }

  if (!call.organizer_user_id) {
    // Artifacts hang off /users/{id}/adhocCalls — with no Entra user on the CDR
    // there is no endpoint to ask, so this call can never yield artifacts.
    await settle(db, call.call_record_id, 'none', call, now());
    return { status: 'skipped', reason: 'no_organizer' };
  }

  let fetched: CallArtifactPayload[];
  try {
    fetched = await fetchArtifacts({
      tenantId: input.tenantId,
      providerCallId: call.provider_call_id,
      organizerUserId: call.organizer_user_id,
      // Windows the getAll enumeration to this call's lifetime.
      startedAt: call.started_at ?? null,
    });
  } catch (error) {
    // Record the attempt before rethrowing so a persistently failing tenant
    // backs off instead of being retried on every sweep.
    await db.table('telephony_call_records')
      .where({ call_record_id: call.call_record_id })
      .update({
        artifact_fetch_attempts: (call.artifact_fetch_attempts ?? 0) + 1,
        last_artifact_fetch_at: now(),
        updated_at: knex.fn.now(),
      });
    throw error;
  }

  const existing: TelephonyCallArtifactRow[] = await db.table('telephony_call_artifacts')
    .where({ call_record_id: call.call_record_id })
    .select('*');

  const settings = await loadSettings(input.tenantId);
  const actorUserId = input.actorUserId ?? null;
  const title = buildCallInteractionTitle({
    direction: call.direction,
    callerNumberE164: call.caller_number_e164,
    callerNumberRaw: call.caller_number_raw,
    calleeNumberE164: call.callee_number_e164,
    calleeNumberRaw: call.callee_number_raw,
  });

  let captured = 0;

  for (const artifact of fetched) {
    const previous = existing.find(
      (row) => row.artifact_type === artifact.artifactType
        && row.provider_artifact_id === artifact.providerArtifactId,
    );
    let documentId = previous?.document_id ?? null;
    let fileId = previous?.file_id ?? null;

    if (artifact.artifactType === 'transcript' && artifact.transcriptContent && !documentId) {
      const owner = actorUserId ?? await resolveDocumentOwner(db);
      if (owner) {
        documentId = await persistTranscript({
          tenantId: input.tenantId,
          knex,
          callRecordId: call.call_record_id,
          title,
          artifact,
          actorUserId: owner,
          clientId: call.matched_client_id,
          contactNameId: call.matched_contact_id,
          isClientVisible: settings.exposeRecordingsInPortal,
        });

        // First capture of this transcript (the !documentId guard is the
        // once-per-artifact dedupe): summarize onto the linked ticket.
        // Best-effort — capture never fails because annotation did.
        if (dependencies.annotateTicketFromTranscript) {
          try {
            await dependencies.annotateTicketFromTranscript({
              tenantId: input.tenantId,
              source: 'call',
              callRecordId: call.call_record_id,
              ticketId: call.ticket_id,
              interactionId: call.interaction_id,
              subject: title,
              transcriptVtt: artifact.transcriptContent,
              providerArtifactId: artifact.providerArtifactId,
            });
          } catch (error) {
            logger.warn('[Telephony] Call transcript ticket annotation failed', {
              tenantId: input.tenantId,
              callRecordId: call.call_record_id,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
      } else {
        logger.warn('[Telephony] No internal user to own the call transcript document', {
          tenantId: input.tenantId,
          callRecordId: call.call_record_id,
        });
      }
    }

    if (
      artifact.artifactType === 'recording'
      && settings.downloadRecordings
      && artifact.contentUrl
      && !fileId
      && dependencies.downloadRecording
    ) {
      fileId = await dependencies.downloadRecording({
        tenantId: input.tenantId,
        call,
        artifact,
        actorUserId: actorUserId ?? (await resolveDocumentOwner(db)) ?? '',
      });
    }

    if (previous) {
      await db.table('telephony_call_artifacts')
        .where({ artifact_id: previous.artifact_id })
        .update({
          content_url: artifact.contentUrl,
          document_id: documentId,
          file_id: fileId,
          created_date_time: artifact.createdDateTime ?? previous.created_date_time,
          updated_at: knex.fn.now(),
        });
    } else {
      await db.table('telephony_call_artifacts').insert({
        tenant: input.tenantId,
        call_record_id: call.call_record_id,
        artifact_type: artifact.artifactType,
        provider_artifact_id: artifact.providerArtifactId,
        content_url: artifact.contentUrl,
        document_id: documentId,
        file_id: fileId,
        created_date_time: artifact.createdDateTime ?? null,
        created_at: knex.fn.now(),
        updated_at: knex.fn.now(),
      } as any);
      captured += 1;
    }
  }

  const total = existing.length + captured;
  const artifactStatus: CallArtifactStatus = total > 0
    ? 'ready'
    : hasCallArtifactWindowElapsed(call, now())
      ? 'none'
      : 'pending';

  await settle(db, call.call_record_id, artifactStatus, call, now());

  logger.info('[Telephony] Call artifact capture complete', {
    tenantId: input.tenantId,
    callRecordId: call.call_record_id,
    artifactStatus,
    captured,
  });

  return { status: 'captured', artifactStatus, captured };
}

async function settle(
  db: any,
  callRecordId: string,
  artifactStatus: CallArtifactStatus,
  call: TelephonyCallRecordRow,
  now: Date,
): Promise<void> {
  await db.table('telephony_call_records')
    .where({ call_record_id: callRecordId })
    .update({
      artifact_status: artifactStatus,
      artifact_fetch_attempts: (call.artifact_fetch_attempts ?? 0) + 1,
      last_artifact_fetch_at: now,
      updated_at: now,
    });
}

async function resolveDocumentOwner(db: any): Promise<string | null> {
  const row = await db.table('users')
    .where({ user_type: 'internal', is_inactive: false })
    .orderBy('created_at', 'asc')
    .first('user_id');
  return row?.user_id ?? null;
}

/**
 * Calls still waiting on artifacts, oldest first — the sweep's work list.
 */
export async function listCallsAwaitingArtifacts(params: {
  tenantId: string;
  knex?: any;
  limit?: number;
}): Promise<TelephonyCallRecordRow[]> {
  const knex = params.knex ?? (await createTenantKnex(params.tenantId)).knex;
  return await tenantDb(knex, params.tenantId).table('telephony_call_records')
    .where({ artifact_status: 'pending' })
    .orderBy('ended_at', 'asc')
    .limit(params.limit ?? 50)
    .select('*');
}
