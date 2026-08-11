/**
 * Consumer-side delivery gate for durable inbound outbox events.
 *
 * The inbound outbox is at-least-once: a crash between Redis accepting a
 * publish and Postgres recording `published` can redeliver the same event id,
 * and the recovery sweeper can re-publish a published outbox event to re-drive
 * incomplete consumer deliveries. Every publish retry reuses the durable
 * `outbox_id` as the caller-supplied event id, so consumers dedupe on
 * `event.id`.
 *
 * Postgres is the correctness authority: the `inbound_email_event_deliveries`
 * ledger is a recoverable RESERVATION, never a terminal claim. A consumer
 * effect is produced at most once in the success path and at least once in the
 * bounded duplicate window:
 *
 *   - Transactional consumers (DB writes, e.g. internal notifications) reserve,
 *     produce the effect, and mark `delivered` in ONE Postgres transaction.
 *     True exactly-once; a crash before commit rolls everything back.
 *
 *   - Non-transactional consumers (email send, webhook POST, any external I/O)
 *     use `withInboundOutboxDelivery`: fenced reservation (committed
 *     `delivering` + token + lease) -> effect -> fenced `delivered` mark.
 *     A crash between reservation and completion leaves an expired reclaimable
 *     reservation, so redelivery retries the effect. This path is AT-LEAST-ONCE
 *     with a bounded duplicate window: exactly-once external delivery is
 *     impossible, and this code does not pretend otherwise. The attempt cap
 *     (getDurableMaxAttempts()) dead-letters a poisoned effect instead of
 *     looping.
 *
 * Recovery: the gate reclaims expired reservations whenever the event arrives
 * again (event-bus redelivery of an un-acked message, or the recovery sweeper
 * re-publishing the outbox event with `force`), so a crash never requires luck
 * to recover. See inboundEmailRecovery.ts and the `force` re-publish path in
 * @alga-psa/event-bus.
 *
 * Events that do not originate from the inbound outbox (no matching
 * `inbound_email_outbox` row) always pass through untouched. If the ledger is
 * temporarily unavailable the gate fails open (deliver) so a transient DB error
 * can never suppress a legitimate notification; a *successful* reservation,
 * however, is never silently abandoned — recovery comes from lease expiry, not
 * from fail-open.
 */

import { randomUUID } from 'node:crypto';
import { getInboundDurableMode } from './inboundEmailDurableStore';
import {
  reserveInboundOutboxEventDelivery,
  completeInboundOutboxEventDelivery,
  failInboundOutboxEventDelivery,
  recordInboundOutboxEventDeliveryFailure,
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

/**
 * Consumer delivery lease TTL. Long enough to cover a slow effect without
 * mid-effect reclaim, and comfortably above the event-bus pending-claim
 * timeout; the recovery sweeper (minute cadence) reclaims expired reservations.
 */
export function getInboundOutboxDeliveryLeaseTtlMs(): number {
  const raw = Number(process.env.UNIFIED_INBOUND_EMAIL_DELIVERY_LEASE_TTL_MS);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 120_000;
}

/** Convenience used by consumers: a fresh owner id per delivery attempt. */
export function newInboundDeliveryOwner(): string {
  return `inbound-delivery-${randomUUID()}`;
}

export interface InboundOutboxEventReservation {
  decision: 'deliver' | 'skip';
  /** Fencing values when `decision === 'deliver'` AND the ledger reserved. */
  token?: string;
  version?: number;
  /** Set when the ledger could not reserve but fails open to deliver. */
  failOpen?: boolean;
  reason?: string;
}

/**
 * Reserve a delivery for one consumer. Fails open to `{ decision: 'deliver',
 * failOpen: true }` for non-outbox events, durable mode `off`, or a ledger
 * outage — a transient DB error must never suppress a notification.
 *
 * The one case that MUST NOT fail open is a ledger error on the transactional
 * path (`failOpenOnLedgerError: false`): there the caller runs its effect in
 * the SAME Postgres transaction as the reservation, so a fail-open reserve
 * would let the effect commit with no durable ledger row and no retry. On that
 * path a reserve/ledger error rejects so the outer `withTransaction` rolls back
 * and the queue/outbox retries. Non-transactional consumers keep the default
 * fail-open (their effects are external I/O and the ledger bounds, never
 * gates, delivery).
 */
export async function reserveInboundOutboxEventForConsumer(params: {
  event: InboundOutboxEventLike;
  consumer: string;
  db: DurableDb;
  owner: string;
  leaseTtlMs?: number;
  failOpenOnLedgerError?: boolean;
}): Promise<InboundOutboxEventReservation> {
  if (getInboundDurableMode() === 'off') return { decision: 'deliver', failOpen: true };
  if (!INBOUND_OUTBOX_EVENT_TYPES.has(params.event.eventType)) return { decision: 'deliver', failOpen: true };
  const tenant = params.event.payload?.tenantId;
  const eventId = params.event.id;
  if (typeof tenant !== 'string' || !tenant || !eventId) return { decision: 'deliver', failOpen: true };

  try {
    const isOutbox = await isInboundOutboxEvent(params.db, { tenant, eventId });
    if (!isOutbox) return { decision: 'deliver', failOpen: true };
    const claim = await reserveInboundOutboxEventDelivery(params.db, {
      tenant,
      outbox_id: eventId,
      consumer: params.consumer,
      owner: params.owner,
      leaseTtlMs: params.leaseTtlMs ?? getInboundOutboxDeliveryLeaseTtlMs(),
    });
    if (claim.claimed === false) {
      return { decision: 'skip', reason: claim.reason };
    }
    return {
      decision: 'deliver',
      token: String(claim.row.lease_token),
      version: Number(claim.row.lease_version),
    };
  } catch (error) {
    if (params.failOpenOnLedgerError === false) {
      // Transactional path: a ledger error must never become a fail-open
      // "deliver anyway". Rethrow so the caller's transaction rolls back and
      // the event is retried (failure record or bus redelivery).
      throw error;
    }
    // Fails open: a ledger outage must never drop a notification.
    console.warn('[InboundEmailConsumerDedupe] delivery ledger unavailable; delivering normally', {
      event: 'inbound_email_outbox_delivery_gate_unavailable',
      tenantId: tenant,
      eventId,
      eventType: params.event.eventType,
      consumer: params.consumer,
      error: error instanceof Error ? error.message : String(error),
    });
    return { decision: 'deliver', failOpen: true };
  }
}

/**
 * Mark a delivery `delivered` with a fencing predicate. Returns false when the
 * fence is stale (superseded claim) — a stale worker can never write
 * completion.
 */
export async function completeInboundOutboxEventForConsumer(params: {
  event: InboundOutboxEventLike;
  consumer: string;
  db: DurableDb;
  owner: string;
  token: string;
  version: number;
}): Promise<boolean> {
  const tenant = params.event.payload?.tenantId;
  if (typeof tenant !== 'string' || !tenant || !params.event.id) return false;
  return completeInboundOutboxEventDelivery(params.db, {
    tenant,
    outbox_id: params.event.id,
    consumer: params.consumer,
    owner: params.owner,
    token: params.token,
    version: params.version,
  });
}

/**
 * Record a fenced failure for a `delivering` reservation (non-transactional
 * protocol). Retryable backoff or dead-letter per the attempt cap.
 */
export async function failInboundOutboxEventForConsumer(params: {
  event: InboundOutboxEventLike;
  consumer: string;
  db: DurableDb;
  owner: string;
  token: string;
  version: number;
  error: string;
}): Promise<'retryable' | 'terminal' | 'noop'> {
  const tenant = params.event.payload?.tenantId;
  if (typeof tenant !== 'string' || !tenant || !params.event.id) return 'noop';
  return failInboundOutboxEventDelivery(params.db, {
    tenant,
    outbox_id: params.event.id,
    consumer: params.consumer,
    owner: params.owner,
    token: params.token,
    version: params.version,
    error: params.error,
  });
}

/**
 * Record a failure without a fencing predicate. Used by the transactional
 * (internal-notification) protocol after its reservation was rolled back with
 * the effect. Bounded by the attempt cap so a poisoned effect dead-letters.
 */
export async function recordInboundOutboxDeliveryFailure(params: {
  event: InboundOutboxEventLike;
  consumer: string;
  db: DurableDb;
  error: string;
}): Promise<'retryable' | 'terminal' | 'noop'> {
  const tenant = params.event.payload?.tenantId;
  if (typeof tenant !== 'string' || !tenant || !params.event.id) return 'noop';
  return recordInboundOutboxEventDeliveryFailure(params.db, {
    tenant,
    outbox_id: params.event.id,
    consumer: params.consumer,
    error: params.error,
  });
}

export interface InboundOutboxDeliveryOutcome<T = unknown> {
  status: 'delivered' | 'skipped' | 'failed';
  result?: T;
}

/**
 * Non-transactional (external-effect) delivery protocol.
 *
 * fenced reservation -> effect -> fenced completion. At-least-once with a
 * bounded duplicate window: a crash between reservation and completion leaves
 * an expired reclaimable reservation, so redelivery retries the effect; if the
 * effect actually ran before the crash, the retry duplicates it within the
 * window. Exactly-once external delivery is impossible — the ledger only bounds
 * the window. A throwing effect is recorded as `retryable_failed` (or
 * dead-lettered at the attempt cap) and re-driven by the recovery sweeper.
 *
 * The event-bus handler for this consumer is expected to swallow the returned
 * outcome and let the ledger be the retry authority. The one case that MUST
 * propagate is a failure to record the failure itself: `withInboundOutboxDelivery`
 * rethrows when `failInboundOutboxEventForConsumer` errors, so the subscriber
 * invocation errors out to the event bus and the message is redelivered rather
 * than ACKed with neither a delivered mark nor a failure record.
 */
export async function withInboundOutboxDelivery<T>(params: {
  event: InboundOutboxEventLike;
  consumer: string;
  db: DurableDb;
  owner: string;
  leaseTtlMs?: number;
  effect: () => Promise<T>;
}): Promise<InboundOutboxDeliveryOutcome<T>> {
  const reservation = await reserveInboundOutboxEventForConsumer({
    event: params.event,
    consumer: params.consumer,
    db: params.db,
    owner: params.owner,
    leaseTtlMs: params.leaseTtlMs,
  });
  if (reservation.decision === 'skip') {
    console.log('[InboundEmailConsumerDedupe] skipping already-delivered inbound outbox event', {
      event: 'inbound_email_outbox_delivery_skipped',
      tenantId: params.event.payload?.tenantId,
      eventId: params.event.id,
      eventType: params.event.eventType,
      consumer: params.consumer,
      reason: reservation.reason,
    });
    return { status: 'skipped' };
  }
  const token = reservation.token;
  const version = reservation.version;
  if (!token || version === undefined) {
    // Fail-open path (non-outbox event or ledger outage): no reservation to
    // complete or fail; just run the effect.
    const result = await params.effect();
    return { status: 'delivered', result };
  }

  try {
    const result = await params.effect();
    await completeInboundOutboxEventForConsumer({
      event: params.event,
      consumer: params.consumer,
      db: params.db,
      owner: params.owner,
      token,
      version,
    });
    return { status: 'delivered', result };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.warn('[InboundEmailConsumerDedupe] delivery effect failed; recording retryable/terminal failure', {
      event: 'inbound_email_outbox_delivery_failed',
      tenantId: params.event.payload?.tenantId,
      eventId: params.event.id,
      eventType: params.event.eventType,
      consumer: params.consumer,
      error: errorMessage,
    });
    // If recording the failure itself fails, rethrow so the subscriber
    // invocation errors out to the event bus and the message is redelivered.
    // The reservation is still committed (`delivering` with a live lease), so
    // redelivery may skip while it is in progress — the recovery sweeper then
    // reclaims it after lease expiry. Either way the event is never ACKed
    // with neither a delivered mark nor a failure record.
    await failInboundOutboxEventForConsumer({
      event: params.event,
      consumer: params.consumer,
      db: params.db,
      owner: params.owner,
      token,
      version,
      error: errorMessage,
    });
    // The ledger (backoff + sweeper re-publish) is the retry authority; the
    // event-bus need not redeliver the same failed effect immediately.
    return { status: 'failed' };
  }
}
