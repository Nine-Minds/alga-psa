/**
 * Ingress staging worker for the durable inbound email pipeline.
 *
 * Claims a `received` ingress row (token/version fenced), fetches the provider
 * source, stages raw MIME to a deterministic object key, derives normalized
 * identities, and inserts one `inbound_email_inbox` row per message. Google
 * history notifications may fan out to several inbox rows. Only after every
 * inbox row is durable does the ingress become `staged`.
 *
 * Never advances a provider cursor past a message whose source could not be
 * staged — producers persist ingress before cursor advancement, and this worker
 * only marks the ingress staged when object upload + inbox insert succeed.
 */

import type { InboundEmailQueueDisposition, UnifiedInboundEmailQueueJobV2 } from '../../interfaces/inbound-email.interfaces';
import type { InboundV2JobContext } from './unifiedInboundEmailQueueJobProcessorV2';
import { randomUUID } from 'node:crypto';
import {
  claimIngress,
  getDurableLeaseTtlMs,
  getDurableMaxAttempts,
  getInboundDurableMode,
  getIngress,
  reclaimIngress,
  transitionIngress,
  upsertIngress,
  upsertInbox,
  type InboundIngressRecord,
} from './inboundEmailDurableStore';
import { stageInboundSourceMime } from './inboundEmailSourceStager';
import { maybeExtractRawMimeFromEmailData } from './inboundEmailArtifactHelpers';
import { buildIngressKey } from './inboundEmailIdentity';
import { enqueueInboundEmailDurableJob } from './unifiedInboundEmailQueueV2';
import { GmailAdapter } from './providers/GmailAdapter';

const TERMINAL_INGRESS_STATUSES = new Set(['staged', 'terminal_failed']);

function boundedBackoffMs(attemptCount: number): number {
  const base = 2 ** Math.min(attemptCount, 6) * 1000;
  const jitter = Math.floor(Math.random() * 1000);
  return Math.min(base + jitter, 5 * 60 * 1000);
}

export async function processIngressStageJob(
  job: UnifiedInboundEmailQueueJobV2,
  ctx: InboundV2JobContext
): Promise<InboundEmailQueueDisposition> {
  const db = await (await import('@alga-psa/db/admin')).getAdminConnection();
  const owner = `ingress-stager-${job.jobId}`;
  const ttl = getDurableLeaseTtlMs();
  const maxAttempts = getDurableMaxAttempts();

  let claim = await claimIngress(db, {
    tenant: job.tenantId,
    ingress_id: job.recordId,
    owner,
    leaseTtlMs: ttl,
    allowRetryable: true,
  });

  let ingress: InboundIngressRecord;
  if (claim.claimed === true) {
    ingress = claim.row;
  } else {
    const current = await getIngress(db, job.tenantId, job.recordId);
    if (current && TERMINAL_INGRESS_STATUSES.has(current.status)) {
      return { disposition: 'ack' };
    }
    if (current?.status === 'staging') {
      const expiry = current.lease_expires_at ? new Date(current.lease_expires_at).getTime() : Date.now() + 30_000;
      if (expiry > Date.now()) {
        return { disposition: 'defer', untilIso: new Date(expiry).toISOString(), reason: 'ingress_lease_active' };
      }
      // Crash between claim and transition: atomically reclaim the expired
      // lease and continue staging (old worker is fenced out).
      const reclaim = await reclaimIngress(db, {
        tenant: job.tenantId,
        ingress_id: job.recordId,
        owner,
        leaseTtlMs: ttl,
      });
      if (reclaim.claimed === true) {
        ingress = reclaim.row;
      } else {
        const latest = await getIngress(db, job.tenantId, job.recordId);
        if (latest && TERMINAL_INGRESS_STATUSES.has(latest.status)) {
          return { disposition: 'ack' };
        }
        return { disposition: 'defer', untilIso: new Date(Date.now() + 30_000).toISOString(), reason: 'ingress_reclaim_race' };
      }
    } else if (current?.status === 'retryable_failed') {
      const next = current.next_attempt_at ? new Date(current.next_attempt_at).getTime() : Date.now();
      return { disposition: 'defer', untilIso: new Date(Math.max(Date.now(), next)).toISOString(), reason: 'ingress_not_due' };
    } else {
      return { disposition: 'retry', error: `ingress_unclaimable:${claim.reason}` };
    }
  }

  const token = String(ingress.lease_token);
  const version = Number(ingress.lease_version);

  try {
    const stagedInboxes = await stageIngressSources(db, ingress);
    const written = await transitionIngress(db, {
      tenant: ingress.tenant,
      ingress_id: ingress.ingress_id,
      owner,
      token,
      version,
      status: 'staged',
      result: { stagedInboxCount: stagedInboxes.length },
    });
    if (!written) return { disposition: 'retry', error: 'ingress_fence_superseded' };

    // In shadow mode the durable processor must not run (legacy is
    // authoritative and the inbox row must stay non-terminal for enforce-mode
    // reconciliation), so no process_inbox wake-up is enqueued.
    const enqueueProcessInbox = getInboundDurableMode() !== 'shadow';
    for (const inboxId of stagedInboxes) {
      if (!enqueueProcessInbox) continue;
      try {
        await enqueueInboundEmailDurableJob({
          workType: 'process_inbox',
          tenantId: ingress.tenant,
          recordId: inboxId,
        });
      } catch (error: any) {
        console.warn('[InboundIngressStagingWorker] process_inbox enqueue failed (sweeper will recover)', {
          event: 'inbound_email_ingress_inbox_enqueue_failed',
          tenantId: ingress.tenant,
          inboxId,
          error: error?.message || String(error),
        });
      }
    }
    return { disposition: 'ack' };
  } catch (error: any) {
    const message = error?.message || String(error);
    const retryable = isRetryableStageError(message);
    // Terminal attempt cap: exhausted retries land in a queryable terminal
    // failure state instead of looping forever.
    const exhausted = retryable && ingress.attempt_count >= maxAttempts;
    const status = retryable && !exhausted ? 'retryable_failed' : 'terminal_failed';
    await transitionIngress(db, {
      tenant: ingress.tenant,
      ingress_id: ingress.ingress_id,
      owner,
      token,
      version,
      status,
      nextAttemptAt: retryable && !exhausted ? new Date(Date.now() + boundedBackoffMs(ingress.attempt_count)) : undefined,
      error: message,
      errorDetails: { phase: 'staging', maxAttemptsExhausted: exhausted || undefined },
    });
    return retryable && !exhausted ? { disposition: 'retry', error: message } : { disposition: 'ack', outcome: 'terminal_failed', reason: message };
  }
}

async function stageIngressSources(db: any, ingress: InboundIngressRecord): Promise<string[]> {  const providerType = ingress.provider_type;
  const pointer = ingress.provider_pointer ?? {};

  if (providerType === 'google') {
    return stageGoogleSources(db, ingress);
  }

  const v1Job = buildV1JobFromIngress(ingress);
  let emailData: any;
  if (providerType === 'microsoft') {
    const { fetchMicrosoftMessageForPointer } = await import('./unifiedInboundEmailQueueJobProcessor');
    emailData = await fetchMicrosoftMessageForPointer(v1Job);
  } else if (providerType === 'imap') {
    const { fetchImapMessageForPointer } = await import('./unifiedInboundEmailQueueJobProcessor');
    emailData = await fetchImapMessageForPointer(v1Job);
  } else {
    throw new Error(`unsupported_provider_type:${providerType}`);
  }

  const rawMime = maybeExtractRawMimeFromEmailData(emailData);
  if (!rawMime) {
    throw new Error('provider_fetch_returned_no_raw_mime');
  }

  return [await persistStagedInbox(db, ingress, emailData, rawMime)];
}

async function stageGoogleSources(db: any, ingress: InboundIngressRecord): Promise<string[]> {
  const v1Job = buildV1JobFromIngress(ingress);
  const { fetchGoogleProviderConfig } = await import('./unifiedInboundEmailQueueJobProcessor');
  const { provider, googleConfig, config } = await fetchGoogleProviderConfig(v1Job);

  const adapter = new GmailAdapter(config);
  await adapter.connect();

  const explicitMessageIds = Array.isArray(ingress.provider_pointer?.discoveredMessageIds)
    ? ingress.provider_pointer.discoveredMessageIds.filter((v): v is string => typeof v === 'string')
    : [];
  const startHistoryId = String(
    googleConfig.history_id || Math.max((Number(ingress.provider_pointer?.historyId) || 1) - 1, 1)
  );
  const messageIds = explicitMessageIds.length > 0 ? explicitMessageIds : await adapter.listMessagesSince(startHistoryId);
  if (!messageIds.length) {
    throw new Error('google_history_no_messages');
  }

  const inboxIds: string[] = [];
  for (const messageId of messageIds) {
    const rawMime = await adapter.downloadMessageSource(messageId);
    const emailData: any = {
      id: messageId,
      provider: 'google',
      providerId: ingress.provider_id,
      tenant: ingress.tenant,
      from: { email: '' },
      to: [],
      subject: '',
      body: { text: '' },
      receivedAt: new Date().toISOString(),
    };
    const inboxId = await persistStagedInbox(db, ingress, emailData, rawMime, {
      providerMessageIdOverride: messageId,
    });
    inboxIds.push(inboxId);
  }

  // The provider cursor never advances before every source in this batch is
  // durable: only after all inbox rows are inserted do we move the history
  // cursor to the notification's historyId. If any message failed to stage,
  // the caller marks the ingress retryable and this update is skipped.
  const cursorHistoryId = String(ingress.provider_pointer?.historyId ?? googleConfig.history_id ?? startHistoryId);
  if (cursorHistoryId) {
    const { tenantDb } = await import('@alga-psa/db');
    await tenantDb(db, ingress.tenant).table('google_email_provider_config')
      .where({ email_provider_id: ingress.provider_id })
      .update({
        history_id: cursorHistoryId,
        updated_at: db.fn.now(),
      });
  }
  return inboxIds;
}

async function persistStagedInbox(
  db: any,
  ingress: InboundIngressRecord,
  emailData: any,
  rawMime: Buffer,
  opts: { providerMessageIdOverride?: string } = {}
): Promise<string> {
  const { parseStagedMimeIntoEmailDetails } = await import('./inboundEmailSourceStager');
  const parsed = await parseStagedMimeIntoEmailDetails({
    tenant: ingress.tenant,
    providerId: ingress.provider_id,
    providerType: ingress.provider_type,
    rawMime,
    fallbackProviderMessageId: opts.providerMessageIdOverride ?? emailData?.id ?? null,
    mailbox: typeof ingress.provider_pointer?.mailbox === 'string' ? ingress.provider_pointer.mailbox : null,
    uidValidity: typeof ingress.provider_pointer?.uidValidity === 'string' ? ingress.provider_pointer.uidValidity : null,
    uid: (ingress.provider_pointer?.uid as string | number | null | undefined) ?? null,
  });

  const staged = await stageInboundSourceMime({
    tenant: ingress.tenant,
    providerId: ingress.provider_id,
    providerType: ingress.provider_type,
    normalizedMessageId: parsed.normalizedMessageId,
    rawMime,
  });

  const inboxRow = await upsertInbox(db, {
    tenant: ingress.tenant,
    ingress_id: ingress.ingress_id,
    provider_id: ingress.provider_id,
    provider_type: ingress.provider_type,
    normalized_message_id: parsed.normalizedMessageId,
    provider_message_id: parsed.providerMessageId ?? opts.providerMessageIdOverride ?? emailData?.id ?? null,
    rfc_message_id: parsed.rfcMessageId,
    source_object_key: staged.objectKey,
    source_sha256: staged.sha256,
    source_size_bytes: staged.sizeBytes,
    source_staged_at: new Date(),
    envelope: buildEnvelope(parsed.emailData),
  });

  return inboxRow.inbox_id;
}

function buildEnvelope(emailData: any): Record<string, unknown> {
  return {
    messageId: emailData.id ?? null,
    from: emailData.from ?? null,
    to: emailData.to ?? [],
    cc: emailData.cc ?? [],
    subject: emailData.subject ?? null,
    receivedAt: emailData.receivedAt ?? null,
    threadId: emailData.threadId ?? null,
    inReplyTo: emailData.inReplyTo ?? null,
    references: emailData.references ?? [],
    attachmentCount: Array.isArray(emailData.attachments) ? emailData.attachments.length : 0,
  };
}

function buildV1JobFromIngress(ingress: InboundIngressRecord): any {
  return {
    jobId: `ingress-${ingress.ingress_id}`,
    schemaVersion: 1,
    tenantId: ingress.tenant,
    providerId: ingress.provider_id,
    provider: ingress.provider_type,
    enqueuedAt: new Date().toISOString(),
    attempt: ingress.attempt_count,
    maxAttempts: 5,
    pointer: ingress.provider_pointer ?? {},
  };
}

function isRetryableStageError(message: string): boolean {
  const lower = message.toLowerCase();
  if (lower.includes('message_not_found') || lower.includes('provider_not_found')) return false;
  if (lower.includes('no_messages') || lower.includes('no messages')) return false;
  if (lower.includes('invalid') || lower.includes('unauthorized') || lower.includes('forbidden')) return false;
  return true;
}

/** Deterministic ingress key helper re-exported for producers. */
export { buildIngressKey };

/**
 * Stage a provider notification whose source bytes are already in hand (e.g.
 * the IMAP email-service already fetched raw MIME). Claims the ingress row
 * inline, uploads the staged source, inserts the inbox row, and marks the
 * ingress `staged` before the producer advances any provider cursor. Returns
 * the durable inbox id, or null when the ingress was already terminal/claimed.
 */
export async function stageIngressFromReadySource(params: {
  tenant: string;
  providerId: string;
  providerType: 'microsoft' | 'google' | 'imap';
  ingressKey: string;
  pointer: Record<string, unknown>;
  rawMime: Buffer;
}): Promise<string | null> {
  const db = await (await import('@alga-psa/db/admin')).getAdminConnection();
  const ingress = await upsertIngress(db, {
    tenant: params.tenant,
    provider_id: params.providerId,
    provider_type: params.providerType,
    ingress_key: params.ingressKey,
    provider_pointer: params.pointer,
  });

  if (ingress.status === 'staged' || ingress.status === 'terminal_failed') {
    return null;
  }

  const owner = `ingress-stager-direct-${randomUUID()}`;
  const claim = await claimIngress(db, {
    tenant: params.tenant,
    ingress_id: ingress.ingress_id,
    owner,
    leaseTtlMs: getDurableLeaseTtlMs(),
    allowRetryable: true,
  });
  if (claim.claimed === false) {
    return null;
  }

  const claimed = claim.row;
  const token = String(claimed.lease_token);
  const version = Number(claimed.lease_version);
  try {
    const inboxId = await persistStagedInbox(db, claimed, { id: null, from: { email: '' }, to: [], subject: '', body: { text: '' } }, params.rawMime);
    const written = await transitionIngress(db, {
      tenant: params.tenant,
      ingress_id: claimed.ingress_id,
      owner,
      token,
      version,
      status: 'staged',
      result: { stagedInboxCount: 1 },
    });
    if (!written) return null;
    return inboxId;
  } catch (error: any) {
    const message = error?.message || String(error);
    await transitionIngress(db, {
      tenant: params.tenant,
      ingress_id: claimed.ingress_id,
      owner,
      token,
      version,
      status: 'retryable_failed',
      nextAttemptAt: new Date(Date.now() + 30_000),
      error: message,
      errorDetails: { phase: 'direct_staging' },
    });
    throw error;
  }
}
