/**
 * Transactional outbox dispatcher for the durable inbound email pipeline.
 *
 * 1. Claims one due outbox row with token/version fencing (no DB transaction
 *    held while talking to Redis).
 * 2. Publishes through @alga-psa/event-bus with `outbox_id` as the caller-
 *    supplied event id and strict error propagation.
 * 3. Marks the row `published` with the fencing predicate, or records a
 *    retryable failure / backoff.
 *
 * The outbox remains at-least-once: a crash after Redis accepts a publish but
 * before Postgres records `published` can redeliver the same id. Touched
 * notification consumers dedupe that stable event id.
 */

import type { InboundEmailQueueDisposition, UnifiedInboundEmailQueueJobV2 } from '../../interfaces/inbound-email.interfaces';
import type { InboundV2JobContext } from './unifiedInboundEmailQueueJobProcessorV2';
import {
  claimOutboxRow,
  getDurableLeaseTtlMs,
  getDurableMaxAttempts,
  getOutboxRow,
  reclaimOutboxRow,
  transitionOutboxRow,
  type InboundOutboxRecord,
} from './inboundEmailDurableStore';

function publishOptionsFor(row: InboundOutboxRecord): Record<string, unknown> | null {
  return row.publish_options ?? null;
}

export async function processInboundOutboxJob(
  job: UnifiedInboundEmailQueueJobV2,
  ctx: InboundV2JobContext
): Promise<InboundEmailQueueDisposition> {
  const db = await (await import('@alga-psa/db/admin')).getAdminConnection();
  const owner = `outbox-dispatcher-${job.jobId}`;
  const ttl = getDurableLeaseTtlMs();

  const claim = await claimOutboxRow(db, {
    tenant: job.tenantId,
    outbox_id: job.recordId,
    owner,
    leaseTtlMs: ttl,
  });

  let row: InboundOutboxRecord;
  if (claim.claimed === true) {
    row = claim.row;
  } else {
    const current = await getOutboxRow(db, job.tenantId, job.recordId);
    if (current && (current.status === 'published' || current.status === 'terminal_failed')) {
      return { disposition: 'ack' };
    }
    if (current?.status === 'publishing') {
      // Crash between claim and the `published` transition: atomically reclaim
      // the expired lease and continue publishing (old worker fenced out). An
      // unexpired lease is deferred, never re-published.
      const expiry = current.lease_expires_at ? new Date(current.lease_expires_at).getTime() : Date.now() + 30_000;
      if (expiry > Date.now()) {
        return { disposition: 'defer', untilIso: new Date(expiry).toISOString(), reason: 'outbox_lease_active' };
      }
      const reclaim = await reclaimOutboxRow(db, {
        tenant: job.tenantId,
        outbox_id: job.recordId,
        owner,
        leaseTtlMs: ttl,
      });
      if (reclaim.claimed === true) {
        row = reclaim.row;
      } else {
        const latest = await getOutboxRow(db, job.tenantId, job.recordId);
        if (latest && (latest.status === 'published' || latest.status === 'terminal_failed')) {
          return { disposition: 'ack' };
        }
        return { disposition: 'defer', untilIso: new Date(Date.now() + 30_000).toISOString(), reason: 'outbox_reclaim_race' };
      }
    } else if (current?.status === 'retryable_failed') {
      const next = current.next_attempt_at ? new Date(current.next_attempt_at).getTime() : Date.now();
      return { disposition: 'defer', untilIso: new Date(Math.max(Date.now(), next)).toISOString(), reason: 'outbox_not_due' };
    } else {
      return { disposition: 'retry', error: `outbox_unclaimable:${claim.reason}` };
    }
  }
  const token = String(row.lease_token);
  const version = Number(row.lease_version);

  let published = false;
  let publishError: string | null = null;
  try {
    const { publishEvent } = await import('@alga-psa/event-bus/publishers');
    const publishOptions = publishOptionsFor(row);
    const options: Record<string, unknown> = {
      eventId: row.outbox_id,
      strict: true,
    };
    if (publishOptions?.channel) options.channel = String(publishOptions.channel);
    await publishEvent(
      { eventType: row.event_type as any, payload: row.payload as any },
      options as any
    );
    published = true;
  } catch (error: any) {
    publishError = error?.message || String(error);
  }

  if (published) {
    const written = await transitionOutboxRow(db, {
      tenant: row.tenant,
      outbox_id: row.outbox_id,
      owner,
      token,
      version,
      status: 'published',
    });
    if (!written) {
      // The publish landed but our fence was superseded; never re-publish the
      // same id as success — treat as retryable so a later worker reconciles.
      return { disposition: 'retry', error: 'outbox_fence_superseded_after_publish' };
    }
    console.log('[InboundEmailOutboxDispatcher] published', {
      event: 'inbound_email_outbox_published',
      tenantId: row.tenant,
      inboxId: row.inbox_id,
      outboxId: row.outbox_id,
      eventKey: row.event_key,
      eventType: row.event_type,
    });
    return { disposition: 'ack' };
  }

  const backoffMs = boundedBackoffMs(row.attempt_count);
  const maxAttempts = getDurableMaxAttempts();
  // Terminal attempt cap: exhausted publication retries dead-letter into a
  // queryable terminal-failure state instead of looping forever.
  const terminal = row.attempt_count >= maxAttempts;
  const written = await transitionOutboxRow(db, {
    tenant: row.tenant,
    outbox_id: row.outbox_id,
    owner,
    token,
    version,
    status: terminal ? 'terminal_failed' : 'retryable_failed',
    nextAttemptAt: terminal ? undefined : new Date(Date.now() + backoffMs),
    error: publishError ?? 'unknown_publish_error',
  });
  if (!written) return { disposition: 'retry', error: 'outbox_fence_superseded' };
  if (terminal) return { disposition: 'ack', outcome: 'terminal_failed', reason: 'max_attempts_exhausted' };
  return { disposition: 'retry', error: publishError ?? 'unknown_publish_error' };
}

function boundedBackoffMs(attemptCount: number): number {
  const base = 2 ** Math.min(attemptCount, 6) * 1000;
  const jitter = Math.floor(Math.random() * 1000);
  return Math.min(base + jitter, 5 * 60 * 1000);
}
