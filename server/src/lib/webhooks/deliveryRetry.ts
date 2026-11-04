import { z } from 'zod';

import { WebhookDeliveryQueue, type WebhookDeliveryPayload } from './WebhookDeliveryQueue';
import { WEBHOOK_EVENT_NAMES } from './eventRegistry';
import { webhookModel, type WebhookDeliveryRecord } from './webhookModel';

/** Derived from the single event registry; do not list events here. */
export const SUPPORTED_WEBHOOK_EVENTS = WEBHOOK_EVENT_NAMES;

export const deliveryEnvelopeSchema = z.object({
  event_id: z.string().guid(),
  event_type: z.enum(SUPPORTED_WEBHOOK_EVENTS),
  occurred_at: z.string().datetime(),
  tenant_id: z.string().guid(),
  data: z.unknown().optional(),
});

export const RETRY_FAILED_DEFAULT_LIMIT = 500;
export const RETRY_FAILED_MAX_LIMIT = 1000;

export type EnqueueDeliveryRetryResult =
  | { queued: true; eventId: string }
  | { queued: false; reason: 'invalid_payload' };

export interface RetryFailedDeliveriesOptions {
  since?: Date;
  limit?: number;
}

export interface RetryFailedDeliveriesResult {
  queued: number;
  skipped: number;
  totalCandidates: number;
  truncated: boolean;
}

/**
 * Single enqueue path shared by the per-delivery retry (UI action + REST) and
 * the bulk retry. A retry is always a fresh attempt 1 handed to the delivery
 * queue, so rate limiting, backoff and auto-disable keep owning the attempt.
 */
export async function enqueueDeliveryRetry(
  delivery: WebhookDeliveryRecord,
  tenantId: string,
): Promise<EnqueueDeliveryRetryResult> {
  const parsedEnvelope = deliveryEnvelopeSchema.safeParse(delivery.requestBody);
  if (!parsedEnvelope.success) {
    return { queued: false, reason: 'invalid_payload' };
  }

  await WebhookDeliveryQueue.getInstance().enqueue({
    webhookId: delivery.webhookId,
    eventId: parsedEnvelope.data.event_id,
    eventType: parsedEnvelope.data.event_type,
    occurredAt: parsedEnvelope.data.occurred_at,
    tenantId,
    payload: parsedEnvelope.data.data as WebhookDeliveryPayload,
    attempt: 1,
    deliverAt: Date.now(),
  });

  return { queued: true, eventId: parsedEnvelope.data.event_id };
}

export function clampRetryFailedLimit(limit?: number): number {
  if (!Number.isFinite(limit)) {
    return RETRY_FAILED_DEFAULT_LIMIT;
  }

  return Math.min(Math.max(1, Math.trunc(limit as number)), RETRY_FAILED_MAX_LIMIT);
}

/**
 * Re-queues the failed/abandoned deliveries of one webhook. Deliveries of an
 * event that failed several times collapse to a single enqueue; rows that are
 * not enqueued (duplicate event or unusable stored envelope) count as skipped.
 */
export async function retryFailedDeliveriesForWebhook(
  tenantId: string,
  webhookId: string,
  options: RetryFailedDeliveriesOptions = {},
): Promise<RetryFailedDeliveriesResult> {
  const limit = clampRetryFailedLimit(options.limit);
  const candidates = await webhookModel.listRetryableDeliveries(tenantId, webhookId, {
    since: options.since,
    limit,
  });

  const seenEventIds = new Set<string>();
  let queued = 0;
  let skipped = 0;

  for (const delivery of candidates.data) {
    if (seenEventIds.has(delivery.eventId)) {
      skipped += 1;
      continue;
    }

    const result = await enqueueDeliveryRetry(delivery, tenantId);
    if (result.queued) {
      seenEventIds.add(delivery.eventId);
      queued += 1;
    } else {
      skipped += 1;
    }
  }

  return {
    queued,
    skipped,
    totalCandidates: candidates.totalCandidates,
    truncated: candidates.totalCandidates > limit,
  };
}
