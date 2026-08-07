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

  if (claim.claimed === false) {
    if (claim.reason === 'terminal') {
      return { disposition: 'ack' };
    }
    if (claim.reason === 'already_claimed') {
      return { disposition: 'defer', untilIso: new Date(Date.now() + 30_000).toISOString(), reason: 'outbox_lease_active' };
    }
    return { disposition: 'retry', error: `outbox_unclaimable:${claim.reason}` };
  }

  const row = claim.row;
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
  const written = await transitionOutboxRow(db, {
    tenant: row.tenant,
    outbox_id: row.outbox_id,
    owner,
    token,
    version,
    status: 'retryable_failed',
    nextAttemptAt: new Date(Date.now() + backoffMs),
    error: publishError ?? 'unknown_publish_error',
  });
  if (!written) return { disposition: 'retry', error: 'outbox_fence_superseded' };
  return { disposition: 'retry', error: publishError ?? 'unknown_publish_error' };
}

function boundedBackoffMs(attemptCount: number): number {
  const base = 2 ** Math.min(attemptCount, 6) * 1000;
  const jitter = Math.floor(Math.random() * 1000);
  return Math.min(base + jitter, 5 * 60 * 1000);
}
