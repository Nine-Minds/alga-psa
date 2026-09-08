/**
 * Resumable artifact worker for the durable inbound email pipeline.
 *
 * Artifact workers read the staged MIME (never the provider) and process the
 * inbox's artifact manifest. Each claim is token/version fenced. The existing
 * best-effort artifact machinery provides the deterministic idempotency guard
 * (`email_processed_attachments` PK) and the legacy compatibility mirror; the
 * durable `inbound_email_artifacts` rows track resumable state on top. A
 * successful compatibility mirror prevents another file/document on replay.
 *
 * Artifact failure never recreates or erases the core ticket/comment.
 */

import type { InboundEmailQueueDisposition, UnifiedInboundEmailQueueJobV2 } from '../../interfaces/inbound-email.interfaces';
import type { InboundV2JobContext } from './unifiedInboundEmailQueueJobProcessorV2';
import { isCoManagedLifecycleError, getCoManagedOperationalState } from '@alga-psa/licensing';
import {
  claimArtifact,
  deferArtifactForCoManagedLifecycle,
  deferInboundArtifact,
  getArtifact,
  getDurableLeaseTtlMs,
  getDurableMaxAttempts,
  getInbox,
  reclaimArtifact,
  transitionArtifact,
  type InboundArtifactRecord,
} from './inboundEmailDurableStore';
import {
  parseStagedMimeIntoEmailDetails,
  readStagedSourceMime,
} from './inboundEmailSourceStager';
import { processInboundEmailArtifactsBestEffort } from './processInboundEmailArtifacts';
import { ORIGINAL_EMAIL_ATTACHMENT_ID, extractEmbeddedImageAttachments, sanitizeGeneratedFileName } from './inboundEmailArtifactHelpers';
import { hasNamedConversationReplyHint, qualifiedReplyTokenFromBody } from './qualifiedReplyAdmission';
import type { QualifiedReplyArtifactProcessor, QualifiedReplyArtifactInput } from './qualifiedReplyArtifacts';

const TERMINAL_ARTIFACT_STATUSES = new Set(['succeeded', 'skipped', 'terminal_failed']);

export async function processInboundArtifactJob(
  job: UnifiedInboundEmailQueueJobV2,
  ctx: InboundV2JobContext,
  qualifiedReplyArtifacts?: QualifiedReplyArtifactProcessor
): Promise<InboundEmailQueueDisposition> {
  const db = await (await import('@alga-psa/db/admin')).getAdminConnection();
  const owner = `artifact-worker-${job.jobId}`;
  const ttl = getDurableLeaseTtlMs();
  const inboxId = job.inboxId ?? '';
  const artifactKey = job.recordId;

  if (!inboxId) {
    return { disposition: 'retry', error: 'artifact_job_missing_inbox_id' };
  }

  const existing = await getArtifact(db, job.tenantId, inboxId, artifactKey);
  if (existing && TERMINAL_ARTIFACT_STATUSES.has(existing.status)) return { disposition: 'ack' };
  if (!existing) return { disposition: 'retry', error: 'artifact_missing' };
  const lifecycle = await getCoManagedOperationalState(db, job.tenantId);
  if (!lifecycle.canWrite) {
    const until = new Date(Date.now() + 60_000);
    await deferArtifactForCoManagedLifecycle(db, { tenant: job.tenantId, inboxId, artifactKey, until });
    return { disposition: 'defer', untilIso: until.toISOString(), reason: `co_managed_${lifecycle.state}` };
  }

  const claim = await claimArtifact(db, {
    tenant: job.tenantId,
    inbox_id: inboxId,
    artifact_key: artifactKey,
    owner,
    leaseTtlMs: ttl,
  });

  let artifact: InboundArtifactRecord;
  if (claim.claimed === true) {
    artifact = claim.row;
  } else {
    const current = await getArtifact(db, job.tenantId, inboxId, artifactKey);
    if (current && TERMINAL_ARTIFACT_STATUSES.has(current.status)) {
      return { disposition: 'ack' };
    }
    if (current?.status === 'processing') {
      // Crash between claim and transition: atomically reclaim the expired
      // lease and continue processing (old worker is fenced out). An unexpired
      // lease is deferred, never classified as a duplicate.
      const expiry = current.lease_expires_at ? new Date(current.lease_expires_at).getTime() : Date.now() + 30_000;
      if (expiry > Date.now()) {
        return { disposition: 'defer', untilIso: new Date(expiry).toISOString(), reason: 'artifact_lease_active' };
      }
      const reclaim = await reclaimArtifact(db, {
        tenant: job.tenantId,
        inbox_id: inboxId,
        artifact_key: artifactKey,
        owner,
        leaseTtlMs: ttl,
      });
      if (reclaim.claimed === true) {
        artifact = reclaim.row;
      } else {
        const latest = await getArtifact(db, job.tenantId, inboxId, artifactKey);
        if (latest && TERMINAL_ARTIFACT_STATUSES.has(latest.status)) {
          return { disposition: 'ack' };
        }
        return { disposition: 'defer', untilIso: new Date(Date.now() + 30_000).toISOString(), reason: 'artifact_reclaim_race' };
      }
    } else if (current?.status === 'retryable_failed' || current?.status === 'pending') {
      const next = current.next_attempt_at ? new Date(current.next_attempt_at).getTime() : Date.now();
      return { disposition: 'defer', untilIso: new Date(Math.max(Date.now(), next)).toISOString(), reason: 'artifact_not_due' };
    } else {
      return { disposition: 'retry', error: `artifact_unclaimable:${claim.reason}` };
    }
  }
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
    const failure = await markArtifactRetryable(db, artifact, { owner, token, version }, message);
    if (failure.terminal) return { disposition: 'ack', outcome: 'terminal_failed', reason: 'max_attempts_exhausted' };
    return { disposition: 'retry', error: message };
  }

  // Use the digest-verified original MIME, not editable comment metadata, to
  // select the protected artifact path. Its conversation adapter must preserve
  // current thread authority; native folder defaults cannot decide visibility.
  const namedReply = hasNamedConversationReplyHint(parsed.emailData);
  if (namedReply || /^cm2:/i.test(qualifiedReplyTokenFromBody(parsed.emailData.body) ?? '')) {
    let reason = namedReply ? 'named_conversation_artifact_admission_pending' : 'co_managed_artifact_admission_pending';
    if (qualifiedReplyArtifacts && !namedReply) {
      try {
        await qualifiedReplyArtifacts(db, { tenant: job.tenantId, inboxId, artifactKey, sourceSha256: inbox.source_sha256!,
          claim: { owner, token, version }, payload: qualifiedArtifactPayload(artifact, parsed.emailData) }, async (path, content, mimeType) => {
          // LEVERAGE: pattern conversation-object-upload — worker and interactive composition share storage validation/confirmation, without generic file rows.
          const { StorageService } = await import('@alga-psa/storage/StorageService');
          const { StorageProviderFactory } = await import('@alga-psa/storage/StorageProviderFactory');
          await StorageService.validateFileUpload(inbox.tenant, mimeType, content.length);
          const provider = await StorageProviderFactory.createProvider();
          const result = await provider.upload(Buffer.from(content), path, { mime_type: mimeType });
          if (result.path !== path || result.size !== content.length) throw new Error('Attachment storage did not confirm the complete object');
        });
        return { disposition: 'ack' };
      } catch (error: any) {
        if (isCoManagedLifecycleError(error)) reason = `co_managed_${error.lifecycle.state}`;
        else if (error?.code === 'CO_MANAGED_SHARED_WORK_FORBIDDEN') reason = 'co_managed_artifact_authority_unavailable';
        else {
          const message = error?.message || String(error);
          const failure = await markArtifactRetryable(db, artifact, { owner, token, version }, message);
          return failure.terminal ? { disposition: 'ack', outcome: 'terminal_failed', reason: 'max_attempts_exhausted' } : { disposition: 'retry', error: message };
        }
      }
    }
    const until = new Date(Date.now() + 60_000);
    await deferInboundArtifact(db, { tenant: job.tenantId, inboxId, artifactKey, until,
      claim: { owner, token, version, refundAttempt: claim.claimed } });
    return { disposition: 'defer', untilIso: until.toISOString(), reason };
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
    if (isCoManagedLifecycleError(error)) {
      const until = new Date(Date.now() + 60_000);
      await deferArtifactForCoManagedLifecycle(db, { tenant: job.tenantId, inboxId, artifactKey, until,
        claim: { owner, token, version, refundAttempt: claim.claimed } });
      return { disposition: 'defer', untilIso: until.toISOString(), reason: `co_managed_${error.lifecycle.state}` };
    }
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
    const failure = await markArtifactRetryable(db, artifact, { owner, token, version }, processError);
    if (failure.terminal) return { disposition: 'ack', outcome: 'terminal_failed', reason: 'max_attempts_exhausted' };
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

  // 'processing' / 'failed' / missing mirror: retryable (terminal at cap).
  const failure = await markArtifactRetryable(
    db,
    artifact,
    { owner, token, version },
    mirror?.error_message ?? processError ?? 'artifact_failed'
  );
  if (failure.terminal) return { disposition: 'ack', outcome: 'terminal_failed', reason: 'max_attempts_exhausted' };
  return { disposition: 'retry', error: mirror?.error_message ?? processError ?? 'artifact_failed' };
}

function boundedBackoffMs(attemptCount: number): number {
  const base = 2 ** Math.min(attemptCount, 6) * 1000;
  const jitter = Math.floor(Math.random() * 1000);
  return Math.min(base + jitter, 5 * 60 * 1000);
}

/** Fenced retryable/terminal failure write honoring the configured attempt cap. */
async function markArtifactRetryable(
  db: any,
  artifact: InboundArtifactRecord,
  lease: { owner: string; token: string; version: number },
  error: string
): Promise<{ terminal: boolean }> {
  const maxAttempts = getDurableMaxAttempts();
  const terminal = artifact.attempt_count >= maxAttempts;
  await transitionArtifact(db, {
    tenant: artifact.tenant,
    inbox_id: artifact.inbox_id,
    artifact_key: artifact.artifact_key,
    owner: lease.owner,
    token: lease.token,
    version: lease.version,
    status: terminal ? 'terminal_failed' : 'retryable_failed',
    nextAttemptAt: terminal ? undefined : new Date(Date.now() + boundedBackoffMs(artifact.attempt_count)),
    error,
  });
  return { terminal };
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

/** Select only this durable manifest entry from the verified staged MIME.
 * No provider fetch or native document/folder processing can widen its audience. */
function qualifiedArtifactPayload(artifact: InboundArtifactRecord,
  emailData: Awaited<ReturnType<typeof parseStagedMimeIntoEmailDetails>>['emailData']): QualifiedReplyArtifactInput['payload'] {
  if (artifact.artifact_type === 'original_email') return { kind: 'original_email' };
  const attachments = emailData.attachments ?? [];
  let attachment: import('./inboundEmailArtifactHelpers').EmailAttachmentLike | undefined;
  if (artifact.artifact_type === 'attachment') {
    attachment = attachments.find((item, index) => (item.id || `att-${index}`) === artifact.source_attachment_id);
  } else if (artifact.artifact_type === 'embedded_image') {
    const embedded = extractEmbeddedImageAttachments({ emailId: emailData.id, html: emailData.body?.html, attachments }).attachments
      .find(item => item.id === artifact.source_attachment_id);
    if (embedded) attachment = { ...embedded, content: embedded.content ?? attachments.find(item => item.id === embedded.providerAttachmentId)?.content };
  }
  if (!attachment || typeof attachment.content !== 'string') throw new Error('Qualified artifact bytes are absent from the retained MIME');
  const encoded = attachment.content.replace(/\s+/g, '');
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) throw new Error('Qualified artifact has invalid base64 content');
  const content = Buffer.from(encoded, 'base64');
  if (attachment.size !== undefined && attachment.size !== content.length) throw new Error('Qualified artifact size disagrees with retained MIME');
  return { kind: artifact.artifact_type as 'attachment' | 'embedded_image', fileName: sanitizeGeneratedFileName(attachment.name ?? ''),
    mimeType: attachment.contentType || 'application/octet-stream', content };
}
