/**
 * Consumer-side dedupe for durable inbound outbox events.
 *
 * The inbound outbox is at-least-once: a crash between Redis accepting a
 * publish and Postgres recording `published` can redeliver the same event id.
 * Every publish retry reuses the durable `outbox_id` as the caller-supplied
 * event id, so consumers can dedupe on `event.id`.
 *
 * `dedupeInboundOutboxEventForConsumer` is the shared first-in-repo
 * consumption-point guard. It answers `deliver`/`skip` for a single consumer
 * using a DB-enforced ledger (`inbound_email_event_deliveries`), never an
 * in-memory set. The primary key `(tenant, outbox_id, consumer)` makes the
 * effect idempotent across concurrent or re-delivered events.
 *
 * Events that do not originate from the inbound outbox (no matching
 * `inbound_email_outbox` row) always pass through untouched. If the ledger is
 * temporarily unavailable the gate fails open (deliver) so a transient DB
 * error can never suppress a legitimate notification; the outbox row's own
 * uniqueness plus the Redis event-bus handler tracking remain the normal-path
 * guards.
 */

import { getInboundDurableMode } from './inboundEmailDurableStore';
import {
  claimInboundOutboxEventDelivery,
  isInboundOutboxEvent,
  type DurableDb,
} from './inboundEmailDurableStore';

/**
 * Event types the inbound outbox publisher can emit. The gate only consults the
 * DB ledger for these, so unrelated event-bus traffic pays no extra query.
 */
export const INBOUND_OUTBOX_EVENT_TYPES = new Set([
  'TICKET_CREATED',
  'TICKET_ASSIGNED',
  'TICKET_UPDATED',
  'TICKET_CLOSED',
  'TICKET_COMMENT_ADDED',
]);

export type OutboxDeliveryDecision = 'deliver' | 'skip';

export interface InboundOutboxEventLike {
  id: string;
  eventType: string;
  payload?: Record<string, unknown>;
}

export async function dedupeInboundOutboxEventForConsumer(params: {
  event: InboundOutboxEventLike;
  consumer: string;
  db: DurableDb;
}): Promise<OutboxDeliveryDecision> {
  if (getInboundDurableMode() === 'off') return 'deliver';
  if (!INBOUND_OUTBOX_EVENT_TYPES.has(params.event.eventType)) return 'deliver';
  const tenant = params.event.payload?.tenantId;
  const eventId = params.event.id;
  if (typeof tenant !== 'string' || !tenant || !eventId) return 'deliver';

  try {
    const isOutbox = await isInboundOutboxEvent(params.db, { tenant, eventId });
    if (!isOutbox) return 'deliver';
    const { claimed } = await claimInboundOutboxEventDelivery(params.db, {
      tenant,
      outbox_id: eventId,
      consumer: params.consumer,
    });
    return claimed ? 'deliver' : 'skip';
  } catch (error) {
    // Fails open: a ledger outage must never drop a notification. The outbox's
    // `(tenant, inbox_id, event_key)` uniqueness and the Redis event-bus
    // per-handler tracking already prevent the common double-effect; this
    // ledger is the durable cross-restart guard.
    console.warn('[InboundEmailConsumerDedupe] delivery ledger unavailable; delivering normally', {
      event: 'inbound_email_outbox_delivery_gate_unavailable',
      tenantId: tenant,
      eventId,
      eventType: params.event.eventType,
      consumer: params.consumer,
      error: error instanceof Error ? error.message : String(error),
    });
    return 'deliver';
  }
}
