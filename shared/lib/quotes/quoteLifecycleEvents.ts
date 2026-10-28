import type { QuoteStatus } from '@alga-psa/types';
import { registerAfterCommit } from '@alga-psa/db';
import { v5 as uuidv5 } from 'uuid';

const QUOTE_EVENT_NAMESPACE = '725f0a11-0ab1-5c65-a8c0-b8a5362fa91c';

/** Events correspond to real transitions, not repeated writes of the same status. */
export type QuoteLifecycleEventType =
  | 'QUOTE_SENT'
  | 'QUOTE_APPROVED'
  | 'QUOTE_ACCEPTED'
  | 'QUOTE_REJECTED'
  | 'QUOTE_EXPIRED'
  | 'QUOTE_CONVERTED'
  | 'QUOTE_CONVERSION_REVERTED'
  | 'QUOTE_SUPERSEDED'
  | 'QUOTE_CANCELLED';

const eventForStatus: Partial<Record<QuoteStatus, QuoteLifecycleEventType>> = {
  sent: 'QUOTE_SENT',
  approved: 'QUOTE_APPROVED',
  accepted: 'QUOTE_ACCEPTED',
  rejected: 'QUOTE_REJECTED',
  expired: 'QUOTE_EXPIRED',
  converted: 'QUOTE_CONVERTED',
  superseded: 'QUOTE_SUPERSEDED',
  cancelled: 'QUOTE_CANCELLED',
};

/**
 * Classify an already-authorized status transition. The caller is responsible
 * for enforcing the status machine and recording the transition atomically.
 */
export function quoteLifecycleEventFor(
  before: QuoteStatus | null,
  after: QuoteStatus | null,
  details: { system?: boolean } = {},
): QuoteLifecycleEventType | null {
  if (!before || !after || before === after) return null;
  if (before === 'converted' && after === 'accepted') {
    return details.system ? 'QUOTE_CONVERSION_REVERTED' : null;
  }
  return eventForStatus[after] ?? null;
}

/** Workflow event types include the first portal view, which is not a status change. */
export type QuoteWorkflowEventType = QuoteLifecycleEventType | 'QUOTE_VIEWED';

export type QuoteWorkflowEvent = {
  [T in QuoteWorkflowEventType]: {
    eventType: T;
    payload: import('@alga-psa/event-schemas').BuiltWorkflowPayload<T>;
  };
}[QuoteWorkflowEventType];

/** Queue a built event on its owning transaction. Callers must use an after-commit-aware owner. */
export function queueQuoteLifecycleEvent(
  trx: import('knex').Knex.Transaction,
  event: QuoteWorkflowEvent,
  params: {
    tenant: string;
    quoteId: string;
    activityId?: string;
    occurredAt: string;
    actor: import('@alga-psa/types').WorkflowActor;
  },
): void {
  if (!params.tenant || !params.quoteId) throw new Error('Quote event requires tenant and quote IDs');
  if (event.eventType !== 'QUOTE_VIEWED' && !params.activityId) throw new Error('Quote transition event requires an activity ID');
  const idempotencyKey = event.eventType === 'QUOTE_VIEWED'
    ? `quote_viewed:${params.quoteId}`
    : `${event.eventType.toLowerCase()}:${params.quoteId}:${params.activityId}`;
  registerQuoteAfterCommit(trx, event, params, idempotencyKey);
}

function registerQuoteAfterCommit(
  trx: import('knex').Knex.Transaction,
  event: QuoteWorkflowEvent,
  params: { tenant: string; quoteId: string; occurredAt: string; actor: import('@alga-psa/types').WorkflowActor },
  idempotencyKey: string,
): void {
  registerAfterCommit(trx, async () => {
    const { publishWorkflowEvent } = await import('@alga-psa/event-bus/publishers');
    const ctx = { tenantId: params.tenant, occurredAt: params.occurredAt, actor: params.actor };
    const options = { eventId: uuidv5(JSON.stringify([params.tenant, idempotencyKey]), QUOTE_EVENT_NAMESPACE) };
    // LEVERAGE: friction brand-union-dispatch — each branded event needs its own generic publish call.
    switch (event.eventType) {
      case 'QUOTE_SENT': return publishWorkflowEvent({ ...event, ctx, idempotencyKey }, options);
      case 'QUOTE_VIEWED': return publishWorkflowEvent({ ...event, ctx, idempotencyKey }, options);
      case 'QUOTE_APPROVED': return publishWorkflowEvent({ ...event, ctx, idempotencyKey }, options);
      case 'QUOTE_ACCEPTED': return publishWorkflowEvent({ ...event, ctx, idempotencyKey }, options);
      case 'QUOTE_REJECTED': return publishWorkflowEvent({ ...event, ctx, idempotencyKey }, options);
      case 'QUOTE_EXPIRED': return publishWorkflowEvent({ ...event, ctx, idempotencyKey }, options);
      case 'QUOTE_CONVERTED': return publishWorkflowEvent({ ...event, ctx, idempotencyKey }, options);
      case 'QUOTE_CONVERSION_REVERTED': return publishWorkflowEvent({ ...event, ctx, idempotencyKey }, options);
      case 'QUOTE_SUPERSEDED': return publishWorkflowEvent({ ...event, ctx, idempotencyKey }, options);
      case 'QUOTE_CANCELLED': return publishWorkflowEvent({ ...event, ctx, idempotencyKey }, options);
    }
  }, `${event.eventType} quote=${params.quoteId}`);
}
