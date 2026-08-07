/**
 * Fenced core orchestrator for the durable inbound email pipeline.
 *
 * The worker performs expensive source work (object read, digest verification,
 * MIME parsing) OUTSIDE any Postgres transaction. A single short tenant-colocated
 * transaction then:
 *
 *   1. locks the inbox row FOR UPDATE and verifies the fencing token/version;
 *   2. re-reads effect rows and returns the stored outcome when already terminal;
 *   3. creates the ticket / initial-or-reply comment through the shared helpers
 *      using the SAME transaction and injected outbox publishers;
 *   4. inserts `inbound_email_effects` rows (second uniqueness guard);
 *   5. inserts `inbound_email_artifacts` manifest rows;
 *   6. makes the inbox terminal with a fenced predicate.
 *
 * ACK is derived only from the resulting durable disposition — never from a
 * mere inbox-row existence check.
 */

import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { tenantDb, withAdminTransaction } from '@alga-psa/db';
import type {
  InboundEmailInboxRecord,
  UnifiedInboundEmailQueueJobV2,
} from '../../interfaces/inbound-email.interfaces';
import {
  claimInbox,
  getInbox,
  getEffectsForInbox,
  getInboxLeaseExpiry,
  insertArtifacts,
  insertEffect,
  lockInboxForUpdate,
  reclaimInbox,
  releaseInboxClaim,
  transitionInbox,
  type InboundArtifactInsert,
} from './inboundEmailDurableStore';
import {
  parseStagedMimeIntoEmailDetails,
  readStagedSourceMime,
} from './inboundEmailSourceStager';
import { processInboundEmailInApp } from './processInboundEmailInApp';
import { InboundEmailOutboxEventPublisher } from '../../workflow/adapters/inboundEmailOutboxEventPublisher';
import { buildArtifactKey } from './inboundEmailIdentity';
import { extractEmbeddedImageAttachments } from './inboundEmailArtifactHelpers';

export type InboundInboxDisposition =
  | { disposition: 'ack'; outcome: string; ticketId?: string | null; commentId?: string | null; reason?: string }
  | { disposition: 'retry'; error: string }
  | { disposition: 'defer'; untilIso: string; reason?: string };

export interface ProcessInboundInboxParams {
  tenantId: string;
  inboxId: string;
  owner: string;
  leaseTtlMs: number;
  /** In shadow mode no core entities are created; used for source-stage coverage validation. */
  mode?: 'shadow' | 'enforce';
  /** Called immediately after the Postgres row is claimed so the consumer heartbeat can renew it. */
  onClaim?: (lease: { inboxId: string; token: string; version: number; owner: string }) => void;
}

const TERMINAL_STATUSES = new Set(['succeeded', 'skipped', 'terminal_failed']);

export async function processInboundInbox(
  params: ProcessInboundInboxParams
): Promise<InboundInboxDisposition> {
  const db = await (await import('@alga-psa/db/admin')).getAdminConnection();

  // --- Claim / reconcile the Postgres inbox row before any source work. -----
  const claimResult = await claimInbox(db, {
    tenant: params.tenantId,
    inbox_id: params.inboxId,
    owner: params.owner,
    leaseTtlMs: params.leaseTtlMs,
    allowRetryable: true,
  });

  let inbox: InboundEmailInboxRecord;
  if (claimResult.claimed) {
    inbox = claimResult.row;
  } else {
    const current = await getInbox(db, params.tenantId, params.inboxId);
    if (current && TERMINAL_STATUSES.has(current.status)) {
      return storedOutcomeDisposition(current);
    }
    if (current?.status === 'processing') {
      const expiry = await getInboxLeaseExpiry(db, params.tenantId, params.inboxId);
      const expiryMs = expiry ? expiry.getTime() : Number.NaN;
      if (Number.isFinite(expiryMs) && expiryMs > Date.now() && expiry) {
        // A live worker owns the claim: defer, never classify as duplicate.
        return { disposition: 'defer', untilIso: expiry.toISOString(), reason: 'valid_postgres_lease' };
      }
      // Expired lease: atomically reclaim it and continue processing.
      const reclaim = await reclaimInbox(db, {
        tenant: params.tenantId,
        inbox_id: params.inboxId,
        owner: params.owner,
        leaseTtlMs: params.leaseTtlMs,
      });
      if (reclaim.claimed === false) {
        const latest = await getInbox(db, params.tenantId, params.inboxId);
        if (latest && TERMINAL_STATUSES.has(latest.status)) {
          return storedOutcomeDisposition(latest);
        }
        if (latest?.status === 'processing') {
          const latestExpiry = await getInboxLeaseExpiry(db, params.tenantId, params.inboxId);
          const untilIso = latestExpiry ? latestExpiry.toISOString() : new Date(Date.now() + 30_000).toISOString();
          return { disposition: 'defer', untilIso, reason: 'reclaim_race_lost' };
        }
        return { disposition: 'retry', error: `inbox_reclaim_failed:${reclaim.reason}` };
      }
      inbox = reclaim.row;
    } else if (current?.status === 'retryable_failed') {
      const next = current.next_attempt_at ? new Date(current.next_attempt_at).getTime() : Date.now();
      return {
        disposition: 'defer',
        untilIso: new Date(Math.max(Date.now(), next)).toISOString(),
        reason: 'retryable_failed_not_due',
      };
    } else {
      // No row / unknown state: never ack success; surface for recovery/DLQ.
      return { disposition: 'retry', error: 'inbox_row_unclaimable' };
    }
  }

  params.onClaim?.({
    inboxId: params.inboxId,
    token: String(inbox.lease_token),
    version: Number(inbox.lease_version),
    owner: params.owner,
  });

  if (params.mode === 'shadow') {
    // Shadow mode: the durable processor never creates core entities and never
    // terminal-writes the inbox row. Release the claim back to `received` so
    // the row stays non-terminal and reconciliation-eligible for enforce-mode
    // processing, then ACK the wake-up. Legacy processing remains authoritative
    // (producers fall through to the V1 enqueue in shadow mode).
    const released = await releaseInboxClaim(db, {
      tenant: params.tenantId,
      inbox_id: params.inboxId,
      owner: params.owner,
      token: String(inbox.lease_token),
      version: Number(inbox.lease_version),
    });
    if (!released) {
      return { disposition: 'retry', error: 'shadow_release_fence_superseded' };
    }
    console.log('[InboundEmailCoreProcessor] shadow mode released inbox claim', {
      event: 'inbound_email_shadow_release',
      tenantId: params.tenantId,
      inboxId: params.inboxId,
    });
    return { disposition: 'ack', outcome: 'shadow' };
  }

  // --- Prepare (no Postgres transaction). ----------------------------------
  if (!inbox.source_object_key || !inbox.source_sha256) {
    await markRetryable(db, inbox, params, 'source_missing');
    return { disposition: 'retry', error: 'inbox_source_missing' };
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
    // Digest mismatch or unparseable source is a terminal provenance error; a
    // transient object-read failure is retryable.
    const isRetryable = /object (not found|unavailable)|ECONN|timed out|timeout/i.test(message) && !message.includes('digest mismatch');
    if (isRetryable) {
      await markRetryable(db, inbox, params, message);
      return { disposition: 'retry', error: message };
    }
    await markTerminalFailed(db, inbox, params, message);
    return { disposition: 'ack', outcome: 'terminal_failed', reason: message };
  }

  const leaseToken = String(inbox.lease_token);
  const leaseVersion = Number(inbox.lease_version);

  // --- Commit: one short tenant-colocated transaction. ---------------------
  const commitResult = await withAdminTransaction(async (trx: Knex.Transaction) => {
    const locked = await lockInboxForUpdate(trx, {
      tenant: params.tenantId,
      inbox_id: params.inboxId,
      token: leaseToken,
      version: leaseVersion,
    });
    if (!locked) {
      throw new Error('inbox_fence_superseded');
    }

    const effects = await getEffectsForInbox(trx, params.tenantId, params.inboxId);
    if (effects.length > 0) {
      // Replay of an already-committed message: return the stored outcome.
      return { terminalReplay: true as const, inbox: locked };
    }

    const result = await runCommitPhase({
      tenantId: params.tenantId,
      inboxId: params.inboxId,
      owner: params.owner,
      mode: params.mode,
      trx,
      inbox: locked,
      emailData: parsed.emailData,
    });
    return { terminalReplay: false as const, ...result };
  });

  if (commitResult.terminalReplay === true) {
    return storedOutcomeDisposition(commitResult.inbox);
  }
  if (commitResult.kind === 'skipped') {
    return { disposition: 'ack', outcome: 'skipped', reason: commitResult.reason };
  }
  if (commitResult.kind === 'retryable') {
    return { disposition: 'retry', error: commitResult.error ?? 'retryable_failure' };
  }
  return {
    disposition: 'ack',
    outcome: commitResult.kind,
    ticketId: commitResult.ticketId ?? null,
    commentId: commitResult.commentId ?? null,
  };
}

interface CommitResult {
  kind: 'created' | 'replied' | 'reconciled' | 'skipped' | 'retryable';
  ticketId?: string;
  commentId?: string;
  reason?: string;
  error?: string;
}

async function runCommitPhase(params: {
  tenantId: string;
  inboxId: string;
  owner: string;
  mode?: 'shadow' | 'enforce';
  trx: Knex.Transaction;
  inbox: InboundEmailInboxRecord;
  emailData: Parameters<typeof processInboundEmailInApp>[0]['emailData'];
}): Promise<CommitResult> {
  const { trx, inbox, emailData } = params;
  const tenantId = params.tenantId;
  const providerId = inbox.provider_id;

  if (params.mode === 'shadow') {
    // Shadow mode is handled before the commit phase (release the claim, never
    // terminal-write). Reaching here is a bug that would otherwise create a
    // terminal row without entities, permanently losing the message.
    throw new Error('shadow_mode_must_not_reach_commit_phase');
  }

  const ticketPublisher = new InboundEmailOutboxEventPublisher({
    trx,
    tenantId,
    inboxId: params.inboxId,
    suppressCommentEmail: false,
  });
  const commentPublisher = new InboundEmailOutboxEventPublisher({
    trx,
    tenantId,
    inboxId: params.inboxId,
    suppressCommentEmail: true,
  });

  const result = await processInboundEmailInApp(
    { tenantId, providerId, emailData },
    {
      collectDiagnostics: true,
      durableExecution: {
        mode: 'enforce',
        trx,
        inboxId: params.inboxId,
        eventPublishers: { ticket: ticketPublisher, comment: commentPublisher },
      },
    }
  );

  switch (result.outcome) {
    case 'created': {
      await insertEffect(trx, {
        tenant: tenantId,
        provider_id: providerId,
        normalized_message_id: inbox.normalized_message_id,
        effect_type: 'ticket',
        inbox_id: params.inboxId,
        entity_id: result.ticketId,
        ticket_id: result.ticketId,
      });
      await insertEffect(trx, {
        tenant: tenantId,
        provider_id: providerId,
        normalized_message_id: inbox.normalized_message_id,
        effect_type: 'comment',
        inbox_id: params.inboxId,
        entity_id: result.commentId,
        ticket_id: result.ticketId,
      });
      await insertArtifactManifest(trx, params.inboxId, emailData);
      const written = await transitionInbox(trx, {
        tenant: tenantId,
        inbox_id: params.inboxId,
        token: String(inbox.lease_token),
        version: Number(inbox.lease_version),
      owner: params.owner,
        status: 'succeeded',
        outcome_kind: 'created',
        ticket_id: result.ticketId,
        comment_id: result.commentId,
      });
      if (!written) throw new Error('inbox_terminal_write_fence_lost');
      return { kind: 'created', ticketId: result.ticketId, commentId: result.commentId };
    }
    case 'replied': {
      await insertEffect(trx, {
        tenant: tenantId,
        provider_id: providerId,
        normalized_message_id: inbox.normalized_message_id,
        effect_type: 'comment',
        inbox_id: params.inboxId,
        entity_id: result.commentId,
        ticket_id: result.ticketId,
      });
      await insertArtifactManifest(trx, params.inboxId, emailData);
      const written = await transitionInbox(trx, {
        tenant: tenantId,
        inbox_id: params.inboxId,
        token: String(inbox.lease_token),
        version: Number(inbox.lease_version),
      owner: params.owner,
        status: 'succeeded',
        outcome_kind: 'replied',
        ticket_id: result.ticketId,
        comment_id: result.commentId,
      });
      if (!written) throw new Error('inbox_terminal_write_fence_lost');
      return { kind: 'replied', ticketId: result.ticketId, commentId: result.commentId };
    }
    case 'skipped': {
      const written = await transitionInbox(trx, {
        tenant: tenantId,
        inbox_id: params.inboxId,
        token: String(inbox.lease_token),
        version: Number(inbox.lease_version),
      owner: params.owner,
        status: 'skipped',
        outcome_kind: 'skipped',
        outcome_reason: result.reason,
      });
      if (!written) throw new Error('inbox_terminal_write_fence_lost');
      return { kind: 'skipped', reason: result.reason };
    }
    case 'deduped': {
      // Reconciliation-only: link exactly one unambiguous existing entity.
      return await reconcileDeduped({
        tenantId: params.tenantId,
        inboxId: params.inboxId,
        owner: params.owner,
        trx,
        inbox,
        emailData,
        result,
      });
    }
    default: {
      const written = await transitionInbox(trx, {
        tenant: tenantId,
        inbox_id: params.inboxId,
        token: String(inbox.lease_token),
        version: Number(inbox.lease_version),
      owner: params.owner,
        status: 'terminal_failed',
        outcome_reason: `unexpected_outcome:${(result as any).outcome}`,
        error: 'unexpected_inbound_outcome',
      });
      if (!written) throw new Error('inbox_terminal_write_fence_lost');
      return { kind: 'skipped', reason: 'unexpected_outcome' };
    }
  }
}

async function reconcileDeduped(params: {
  tenantId: string;
  inboxId: string;
  owner: string;
  trx: Knex.Transaction;
  inbox: InboundEmailInboxRecord;
  emailData: Parameters<typeof processInboundEmailInApp>[0]['emailData'];
  result: any;
}): Promise<CommitResult> {
  const { trx, inbox, result } = params;
  const tenantId = params.tenantId;
  const providerId = inbox.provider_id;
  const ticketId: string | undefined = result?.ticketId;

  if (!ticketId) {
    await transitionInbox(trx, {
      tenant: tenantId,
      inbox_id: params.inboxId,
      token: String(inbox.lease_token),
      version: Number(inbox.lease_version),
      owner: params.owner,
      status: 'terminal_failed',
      outcome_reason: 'reconciliation_no_ticket',
      error: 'reconciliation_no_ticket',
    });
    return { kind: 'skipped', reason: 'reconciliation_no_ticket' };
  }

  // Resolve an unambiguous existing comment for this message on the ticket.
  let commentId: string | null = result?.commentId ?? null;
  if (!commentId) {
    const scoped = tenantDbFor(trx, tenantId);
    const matches = await scoped.table('comments')
      .where({ ticket_id: ticketId, tenant: tenantId })
      .andWhere(function (this: any) {
        this.whereRaw("metadata->'email'->>'messageId' = ?", [params.emailData.id])
          .orWhereRaw("metadata->>'messageId' = ?", [params.emailData.id]);
      })
      .select('comment_id');
    if (matches.length === 1) {
      commentId = String(matches[0].comment_id);
    } else if (matches.length > 1) {
      await transitionInbox(trx, {
        tenant: tenantId,
        inbox_id: params.inboxId,
        token: String(inbox.lease_token),
        version: Number(inbox.lease_version),
      owner: params.owner,
        status: 'terminal_failed',
        outcome_reason: 'reconciliation_ambiguous_comment',
        error: 'reconciliation_ambiguous_comment',
      });
      return { kind: 'skipped', reason: 'reconciliation_ambiguous_comment' };
    }
  }

  if (!commentId) {
    // Never guess a missing effect.
    await transitionInbox(trx, {
      tenant: tenantId,
      inbox_id: params.inboxId,
      token: String(inbox.lease_token),
      version: Number(inbox.lease_version),
      owner: params.owner,
      status: 'terminal_failed',
      outcome_reason: 'reconciliation_missing_comment',
      error: 'reconciliation_missing_comment',
    });
    return { kind: 'skipped', reason: 'reconciliation_missing_comment' };
  }

  await insertEffect(trx, {
    tenant: tenantId,
    provider_id: providerId,
    normalized_message_id: inbox.normalized_message_id,
    effect_type: 'ticket',
    inbox_id: params.inboxId,
    entity_id: ticketId,
    ticket_id: ticketId,
    reconciled: true,
  });
  await insertEffect(trx, {
    tenant: tenantId,
    provider_id: providerId,
    normalized_message_id: inbox.normalized_message_id,
    effect_type: 'comment',
    inbox_id: params.inboxId,
    entity_id: commentId,
    ticket_id: ticketId,
    reconciled: true,
  });
  const written = await transitionInbox(trx, {
    tenant: tenantId,
    inbox_id: params.inboxId,
    token: String(inbox.lease_token),
    version: Number(inbox.lease_version),
      owner: params.owner,
    status: 'succeeded',
    outcome_kind: 'reconciled',
    ticket_id: ticketId,
    comment_id: commentId,
  });
  if (!written) throw new Error('inbox_terminal_write_fence_lost');
  return { kind: 'reconciled', ticketId, commentId };
}

function tenantDbFor(trx: Knex.Transaction, tenantId: string) {
  return tenantDb(trx, tenantId);
}

function storedOutcomeDisposition(inbox: InboundEmailInboxRecord): InboundInboxDisposition {
  if (inbox.status === 'succeeded') {
    return {
      disposition: 'ack',
      outcome: inbox.outcome_kind ?? 'reconciled',
      ticketId: inbox.ticket_id,
      commentId: inbox.comment_id,
      reason: 'terminal_replay',
    };
  }
  if (inbox.status === 'skipped') {
    return { disposition: 'ack', outcome: 'skipped', reason: inbox.outcome_reason ?? undefined };
  }
  return {
    disposition: 'ack',
    outcome: 'terminal_failed',
    reason: inbox.outcome_reason ?? inbox.last_error ?? undefined,
  };
}

async function markRetryable(
  db: any,
  inbox: InboundEmailInboxRecord,
  params: ProcessInboundInboxParams,
  error: string
): Promise<void> {
  const backoffMs = boundedBackoffMs(inbox.attempt_count);
  await transitionInbox(db, {
    tenant: params.tenantId,
    inbox_id: params.inboxId,
    token: String(inbox.lease_token),
    version: Number(inbox.lease_version),
      owner: params.owner,
    status: 'retryable_failed',
    nextAttemptAt: new Date(Date.now() + backoffMs),
    error,
    errorDetails: { phase: 'prepare' },
  });
}

async function markTerminalFailed(
  db: any,
  inbox: InboundEmailInboxRecord,
  params: ProcessInboundInboxParams,
  error: string
): Promise<void> {
  await transitionInbox(db, {
    tenant: params.tenantId,
    inbox_id: params.inboxId,
    token: String(inbox.lease_token),
    version: Number(inbox.lease_version),
      owner: params.owner,
    status: 'terminal_failed',
    error,
    errorDetails: { phase: 'prepare' },
  });
}

function boundedBackoffMs(attemptCount: number): number {
  const base = 2 ** Math.min(attemptCount, 6) * 1000;
  const jitter = Math.floor(Math.random() * 1000);
  return Math.min(base + jitter, 5 * 60 * 1000);
}

async function insertArtifactManifest(
  trx: Knex.Transaction,
  inboxId: string,
  emailData: Parameters<typeof processInboundEmailInApp>[0]['emailData']
): Promise<void> {
  const rows: InboundArtifactInsert[] = [];
  const baseAttachments = Array.isArray(emailData.attachments) ? emailData.attachments : [];

  for (const attachment of baseAttachments) {
    const stableId = String(attachment.id || `att-${baseAttachments.indexOf(attachment)}`);
    rows.push({
      tenant: emailData.tenant,
      inbox_id: inboxId,
      artifact_key: buildArtifactKey({ artifactType: 'attachment', stableId }),
      artifact_type: 'attachment',
      source_attachment_id: stableId,
    });
  }

  if (emailData.body?.html) {
    try {
      const extraction = extractEmbeddedImageAttachments({
        emailId: emailData.id,
        html: emailData.body.html,
        attachments: baseAttachments as any[],
      });
      for (const embedded of extraction.attachments) {
        rows.push({
          tenant: emailData.tenant,
          inbox_id: inboxId,
          artifact_key: buildArtifactKey({ artifactType: 'embedded_image', stableId: embedded.id }),
          artifact_type: 'embedded_image',
          source_attachment_id: embedded.id,
        });
      }
    } catch {
      // Embedded extraction is best effort for the manifest; attachments still stage.
    }
  }

  rows.push({
    tenant: emailData.tenant,
    inbox_id: inboxId,
    artifact_key: buildArtifactKey({ artifactType: 'original_email', stableId: 'source' }),
    artifact_type: 'original_email',
    source_attachment_id: 'source',
  });

  await insertArtifacts(trx, emailData.tenant, rows);
}

/** Convenience used by the consumer wiring: a fresh owner id per process. */
export function newInboundProcessorOwner(): string {
  return `inbox-processor-${randomUUID()}`;
}

export async function renewInboundInboxLease(params: {
  tenantId: string;
  inboxId: string;
  owner: string;
  token: string;
  version: number;
  leaseTtlMs: number;
}): Promise<boolean> {
  const { renewInbox } = await import('./inboundEmailDurableStore');
  const db = await (await import('@alga-psa/db/admin')).getAdminConnection();
  return renewInbox(db, {
    tenant: params.tenantId,
    inbox_id: params.inboxId,
    owner: params.owner,
    token: params.token,
    version: params.version,
    leaseTtlMs: params.leaseTtlMs,
  });
}

export type { UnifiedInboundEmailQueueJobV2 };
