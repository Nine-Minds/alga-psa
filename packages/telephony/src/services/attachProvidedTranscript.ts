import logger from '@alga-psa/core/logger';
import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';
import type { TelephonyCallArtifactRow, TelephonyCallRecordRow } from '../types';
import { buildCallInteractionTitle } from '../lib/callInteractions';
import {
  appendCallSummaryToInteraction,
  createCallTranscriptDocument,
  resolveCallDocumentOwner,
} from '../lib/callArtifactDocuments';

export interface AttachProvidedTranscriptInput {
  tenantId: string;
  callRecordId: string;
  transcription: string;
  summary?: string | null;
  /** Defaults to 'report-call': the transcript arrived with the call itself. */
  providerArtifactId?: string;
  createdDateTime?: string | Date | null;
  actorUserId?: string | null;
  isClientVisible?: boolean;
  knex?: any;
  now?: () => Date;
}

export type AttachProvidedTranscriptOutcome =
  | { status: 'skipped'; reason: 'not_found' | 'empty_transcript' | 'no_owner' }
  | {
      status: 'attached';
      documentId: string;
      artifactId: string;
      created: boolean;
      summaryAppended: boolean;
    };

/**
 * File a transcript the provider handed us together with the call (3CX's
 * ReportCall carries the PBX transcription), instead of polling for it.
 *
 * Idempotent on (call, provider_artifact_id): a re-delivered report re-links
 * the document already filed and never appends the summary twice. Records
 * that arrive without a transcript are untouched and stay `pending` for the
 * artifact sweep.
 */
export async function attachProvidedTranscript(
  input: AttachProvidedTranscriptInput,
): Promise<AttachProvidedTranscriptOutcome> {
  const transcription = input.transcription?.trim() ?? '';
  if (!transcription) {
    return { status: 'skipped', reason: 'empty_transcript' };
  }

  const knex = input.knex ?? (await createTenantKnex(input.tenantId)).knex;
  const providerArtifactId = input.providerArtifactId ?? 'report-call';
  const now = input.now ?? (() => new Date());

  return withTransaction(knex, async (trx: any) => {
    const db = tenantDb(trx, input.tenantId);

    const call: TelephonyCallRecordRow | undefined = await db.table('telephony_call_records')
      .where({ call_record_id: input.callRecordId })
      .first();
    if (!call) {
      return { status: 'skipped' as const, reason: 'not_found' as const };
    }

    const existing: TelephonyCallArtifactRow | undefined = await db.table('telephony_call_artifacts')
      .where({ call_record_id: call.call_record_id, artifact_type: 'transcript', provider_artifact_id: providerArtifactId })
      .first();

    let documentId = existing?.document_id ?? null;
    let artifactId = existing?.artifact_id ?? null;

    if (!documentId) {
      const owner = input.actorUserId ?? await resolveCallDocumentOwner(db);
      if (!owner) {
        logger.warn('[Telephony] No internal user to own the provided call transcript', {
          tenantId: input.tenantId,
          callRecordId: call.call_record_id,
        });
        return { status: 'skipped' as const, reason: 'no_owner' as const };
      }

      documentId = await createCallTranscriptDocument({
        tenantId: input.tenantId,
        knex: trx,
        callRecordId: call.call_record_id,
        title: buildCallInteractionTitle({
          direction: call.direction,
          callerNumberE164: call.caller_number_e164,
          callerNumberRaw: call.caller_number_raw,
          calleeNumberE164: call.callee_number_e164,
          calleeNumberRaw: call.callee_number_raw,
        }),
        artifact: {
          artifactType: 'transcript',
          providerArtifactId,
          contentUrl: null,
          createdDateTime: null,
          transcriptContent: transcription,
        },
        actorUserId: owner,
        clientId: call.matched_client_id,
        contactNameId: call.matched_contact_id,
        interactionId: call.interaction_id,
        isClientVisible: input.isClientVisible ?? false,
      });
    }

    const timestamp = now();
    if (existing) {
      await db.table('telephony_call_artifacts')
        .where({ artifact_id: existing.artifact_id })
        .update({ document_id: documentId, updated_at: timestamp });
    } else {
      const [inserted] = await db.table('telephony_call_artifacts')
        .insert({
          tenant: input.tenantId,
          call_record_id: call.call_record_id,
          artifact_type: 'transcript',
          provider_artifact_id: providerArtifactId,
          content_url: null,
          document_id: documentId,
          file_id: null,
          created_date_time: input.createdDateTime ?? timestamp,
          created_at: timestamp,
          updated_at: timestamp,
        } as any)
        .returning('artifact_id');
      artifactId = (inserted as any).artifact_id as string;
    }

    const summaryAppended = await appendCallSummaryToInteraction({
      db,
      interactionId: call.interaction_id,
      summary: input.summary,
      now: timestamp,
    });

    await db.table('telephony_call_records')
      .where({ call_record_id: call.call_record_id })
      .update({
        artifact_status: 'ready',
        last_artifact_fetch_at: timestamp,
        updated_at: timestamp,
      });

    return {
      status: 'attached' as const,
      documentId: documentId!,
      artifactId: artifactId!,
      created: !existing,
      summaryAppended,
    };
  });
}
