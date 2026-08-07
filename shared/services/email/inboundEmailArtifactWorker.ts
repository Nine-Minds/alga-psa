/**
 * Resumable artifact worker for the durable inbound email pipeline.
 *
 * Artifact workers read the staged MIME (never the provider) and process the
 * inbox's artifact manifest. Each claim is token/version fenced. The existing
 * best-effort artifact machinery provides the deterministic idempotency guard
 * (`email_processed_attachments` PK) and the legacy compatibility mirror; the
 * durable `inbound_email_artifacts` rows track resumable state on top. A
 * storage-success/DB-failure retry reuses the deterministic object and never
 * generates another file/document for an already-successful artifact.
 *
 * Artifact failure never recreates or erases the core ticket/comment.
 */

import type { InboundEmailQueueDisposition, UnifiedInboundEmailQueueJobV2 } from '../../interfaces/inbound-email.interfaces';
import type { InboundV2JobContext } from './unifiedInboundEmailQueueJobProcessorV2';
import {
  claimArtifact,
  getDurableLeaseTtlMs,
  getInbox,
  transitionArtifact,
  type InboundArtifactRecord,
} from './inboundEmailDurableStore';
import {
  parseStagedMimeIntoEmailDetails,
  readStagedSourceMime,
} from './inboundEmailSourceStager';
import { processInboundEmailArtifactsBestEffort } from './processInboundEmailArtifacts';
import { ORIGINAL_EMAIL_ATTACHMENT_ID } from './inboundEmailArtifactHelpers';

const TERMINAL_ARTIFACT_STATUSES = new Set(['succeeded', 'skipped', 'terminal_failed']);

export async function processInboundArtifactJob(
  job: UnifiedInboundEmailQueueJobV2,
  ctx: InboundV2JobContext
): Promise<InboundEmailQueueDisposition> {
  const db = await (await import('@alga-psa/db/admin')).getAdminConnection();
  const owner = `artifact-worker-${job.jobId}`;
  const ttl = getDurableLeaseTtlMs();
  const inboxId = job.inboxId ?? '';
  const artifactKey = job.recordId;

  if (!inboxId) {
    return { disposition: 'retry', error: 'artifact_job_missing_inbox_id' };
  }

  const claim = await claimArtifact(db, {
    tenant: job.tenantId,
    inbox_id: inboxId,
    artifact_key: artifactKey,
    owner,
    leaseTtlMs: ttl,
  });

  if (claim.claimed === false) {
    if (claim.reason === 'terminal') return { disposition: 'ack' };
    if (claim.reason === 'already_claimed') {
      return { disposition: 'defer', untilIso: new Date(Date.now() + 30_000).toISOString(), reason: 'artifact_lease_active' };
    }
    return { disposition: 'retry', error: `artifact_unclaimable:${claim.reason}` };
  }

  const artifact = claim.row;
  const token = String(artifact.lease_token);
  const version = Number(artifact.lease_version);

  const inbox = await getInbox(db, job.tenantId, inboxId);
  if (!inbox || !inbox.source_object_key || !inbox.source_sha256) {
    await transitionArtifact(db, {
      tenant: job.tenantId,
      inbox_id: inboxId,
      artifact_key: artifactKey,
      owner,
      token,
      version,
      status: 'terminal_failed',
      error: 'inbox_source_unavailable',
    });
    return { disposition: 'ack' };
  }

  if (inbox.status !== 'succeeded' || !inbox.ticket_id) {
    await transitionArtifact(db, {
      tenant: job.tenantId,
      inbox_id: inboxId,
      artifact_key: artifactKey,
      owner,
      token,
      version,
      status: 'terminal_failed',
      error: `inbox_not_ready_for_artifacts:${inbox.status}`,
    });
    return { disposition: 'ack' };
  }

  let parsed: Awaited<ReturnType<typeof parseStagedMimeIntoEmailDetails>>;
  try {
    const rawMime = await readStagedSourceMime({
      tenant: inbox.tenant,
      providerId: inbox.provider_id,
      objectKey: inbox.source_object_key,
      expectedSha256: inbox.source_sha256,
    });
    parsed = await parseStagedMimeIntoEmailDetails({
      tenant: inbox.tenant,
      providerId: inbox.provider_id,
      providerType: inbox.provider_type,
      rawMime,
      fallbackProviderMessageId: inbox.provider_message_id,
    });
  } catch (error: any) {
    const message = error?.message || String(error);
    await transitionArtifact(db, {
      tenant: job.tenantId,
      inbox_id: inboxId,
      artifact_key: artifactKey,
      owner,
      token,
      version,
      status: 'retryable_failed',
      nextAttemptAt: new Date(Date.now() + 60_000),
      error: message,
    });
    return { disposition: 'retry', error: message };
  }

  let processError: string | null = null;
  try {
    await processInboundEmailArtifactsBestEffort({
      tenantId: inbox.tenant,
      providerId: inbox.provider_id,
      ticketId: inbox.ticket_id,
      emailData: parsed.emailData,
      scopeLabel: 'reply',
      clientVisibleAttachments: true,
    });
  } catch (error: any) {
    processError = error?.message || String(error);
  }

  const legacyAttachmentId = resolveLegacyAttachmentId(artifact, parsed.emailData.id);
  const mirror = await readLegacyMirror(db, {
    tenant: inbox.tenant,
    providerId: inbox.provider_id,
    emailId: parsed.emailData.id,
    attachmentId: legacyAttachmentId,
  });

  if (processError && !mirror) {
    await transitionArtifact(db, {
      tenant: job.tenantId,
      inbox_id: inboxId,
      artifact_key: artifactKey,
      owner,
      token,
      version,
      status: 'retryable_failed',
      nextAttemptAt: new Date(Date.now() + 60_000),
      error: processError,
    });
    return { disposition: 'retry', error: processError };
  }

  const status = mirror?.status ?? 'failed';
  if (status === 'success' && mirror) {
    const written = await transitionArtifact(db, {
      tenant: job.tenantId,
      inbox_id: inboxId,
      artifact_key: artifactKey,
      owner,
      token,
      version,
      status: 'succeeded',
      file_id: mirror.file_id,
      document_id: mirror.document_id,
    });
    if (!written) return { disposition: 'retry', error: 'artifact_fence_superseded' };
    return { disposition: 'ack' };
  }

  if (status === 'skipped') {
    await transitionArtifact(db, {
      tenant: job.tenantId,
      inbox_id: inboxId,
      artifact_key: artifactKey,
      owner,
      token,
      version,
      status: 'skipped',
      error: mirror?.error_message ?? null,
    });
    return { disposition: 'ack' };
  }

  // 'processing' / 'failed' / missing mirror: retryable.
  await transitionArtifact(db, {
    tenant: job.tenantId,
    inbox_id: inboxId,
    artifact_key: artifactKey,
    owner,
    token,
    version,
    status: 'retryable_failed',
    nextAttemptAt: new Date(Date.now() + 60_000),
    error: mirror?.error_message ?? processError ?? 'artifact_failed',
  });
  return { disposition: 'retry', error: mirror?.error_message ?? processError ?? 'artifact_failed' };
}

function resolveLegacyAttachmentId(artifact: InboundArtifactRecord, emailId: string): string {
  if (artifact.artifact_type === 'original_email') return ORIGINAL_EMAIL_ATTACHMENT_ID;
  return artifact.source_attachment_id ?? artifact.artifact_key;
}

async function readLegacyMirror(
  db: any,
  params: { tenant: string; providerId: string; emailId: string; attachmentId: string }
): Promise<{ status: string; file_id: string | null; document_id: string | null; error_message: string | null } | null> {
  const { tenantDb } = await import('@alga-psa/db');
  const row = await tenantDb(db, params.tenant).table('email_processed_attachments')
    .where({
      provider_id: params.providerId,
      email_id: params.emailId,
      attachment_id: params.attachmentId,
    })
    .first('processing_status as status', 'file_id', 'document_id', 'error_message');
  if (!row) return null;
  return {
    status: String(row.status),
    file_id: row.file_id ?? null,
    document_id: row.document_id ?? null,
    error_message: row.error_message ?? null,
  };
}

export { TERMINAL_ARTIFACT_STATUSES };
