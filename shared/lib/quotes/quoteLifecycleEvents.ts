import {
  CorePayloadSchemas,
  buildWorkflowPayload,
} from '@alga-psa/event-schemas';
import { QUOTE_ALLOWED_STATUS_TRANSITIONS } from './quoteStatusTransitions';
import type {
  IQuote,
  IQuoteActivity,
  QuoteStatus,
  WorkflowActor,
} from '@alga-psa/types';
import { registerAfterCommit, tenantDb, withTransaction } from '@alga-psa/db';
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
  details: { system?: boolean } = {}
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
    actor: QuoteActor;
  }
): void {
  if (!params.tenant || !params.quoteId)
    throw new Error('Quote event requires tenant and quote IDs');
  if (event.eventType !== 'QUOTE_VIEWED' && !params.activityId)
    throw new Error('Quote transition event requires an activity ID');
  const idempotencyKey =
    event.eventType === 'QUOTE_VIEWED'
      ? `quote_viewed:${params.quoteId}`
      : `${event.eventType.toLowerCase()}:${params.quoteId}:${params.activityId}`;
  registerQuoteAfterCommit(trx, event, params, idempotencyKey);
}

function registerQuoteAfterCommit(
  trx: import('knex').Knex.Transaction,
  event: QuoteWorkflowEvent,
  params: {
    tenant: string;
    quoteId: string;
    occurredAt: string;
    actor: QuoteActor;
  },
  idempotencyKey: string
): void {
  registerAfterCommit(
    trx,
    async () => {
      const { publishWorkflowEvent } =
        await import('@alga-psa/event-bus/publishers');
      const ctx = {
        tenantId: params.tenant,
        occurredAt: params.occurredAt,
        actor: params.actor,
      };
      const options = {
        eventId: uuidv5(
          JSON.stringify([params.tenant, idempotencyKey]),
          QUOTE_EVENT_NAMESPACE
        ),
      };
      // LEVERAGE: friction brand-union-dispatch — each branded event needs its own generic publish call.
      switch (event.eventType) {
        case 'QUOTE_SENT':
          return publishWorkflowEvent(
            { ...event, ctx, idempotencyKey },
            options
          );
        case 'QUOTE_VIEWED':
          return publishWorkflowEvent(
            { ...event, ctx, idempotencyKey },
            options
          );
        case 'QUOTE_APPROVED':
          return publishWorkflowEvent(
            { ...event, ctx, idempotencyKey },
            options
          );
        case 'QUOTE_ACCEPTED':
          return publishWorkflowEvent(
            { ...event, ctx, idempotencyKey },
            options
          );
        case 'QUOTE_REJECTED':
          return publishWorkflowEvent(
            { ...event, ctx, idempotencyKey },
            options
          );
        case 'QUOTE_EXPIRED':
          return publishWorkflowEvent(
            { ...event, ctx, idempotencyKey },
            options
          );
        case 'QUOTE_CONVERTED':
          return publishWorkflowEvent(
            { ...event, ctx, idempotencyKey },
            options
          );
        case 'QUOTE_CONVERSION_REVERTED':
          return publishWorkflowEvent(
            { ...event, ctx, idempotencyKey },
            options
          );
        case 'QUOTE_SUPERSEDED':
          return publishWorkflowEvent(
            { ...event, ctx, idempotencyKey },
            options
          );
        case 'QUOTE_CANCELLED':
          return publishWorkflowEvent(
            { ...event, ctx, idempotencyKey },
            options
          );
      }
    },
    `${event.eventType} quote=${params.quoteId}`
  );
}

/** A quote is never acted on by a co-managed collaborator, so its events carry only the three local actor kinds. */
export type QuoteActor = Exclude<WorkflowActor, { actorType: 'COLLABORATOR' }>;

/** Metadata that cannot be inferred from a persisted quote (portal actor, revisions, reversals). */
export interface QuoteLifecycleOptions {
  actor?: QuoteActor;
  acceptedOnBehalf?: boolean;
  activity?: Pick<IQuoteActivity, 'activity_type' | 'metadata'>;
  system?: boolean;
  details?: {
    releasedInvoiceId?: string;
    supersededByQuoteId?: string;
    nextVersion?: number;
    salesOrderId?: string;
  };
  workflowRunId?: string;
  workflowLineage?: string[];
}

export function assertQuoteLifecycleTransition(
  before: IQuote,
  to: QuoteStatus,
  options: QuoteLifecycleOptions = {}
): void {
  if (before.is_template)
    throw new Error('Quote templates do not participate in status transitions');
  if (before.status === to) return;
  if (
    options.system &&
    before.status === 'converted' &&
    to === 'accepted' &&
    options.details?.releasedInvoiceId
  )
    return;
  if (
    options.system &&
    to === 'superseded' &&
    options.details?.supersededByQuoteId &&
    ['sent', 'rejected', 'expired', 'cancelled', 'accepted'].includes(
      before.status ?? ''
    )
  )
    return;
  if (
    !before.status ||
    !QUOTE_ALLOWED_STATUS_TRANSITIONS[before.status].includes(to)
  ) {
    throw new Error(
      `Invalid quote status transition from ${before.status} to ${to}`
    );
  }
}

function iso(value: string | Date | undefined | null): string {
  return value instanceof Date
    ? value.toISOString()
    : value || new Date().toISOString();
}

/** Capture the committed transition's payload inside the transaction, after financial recalculation. */
export async function recordQuoteLifecycleTransition(
  trx: import('knex').Knex.Transaction,
  tenant: string,
  before: IQuote,
  after: IQuote,
  activity: IQuoteActivity,
  options: QuoteLifecycleOptions = {},
  explicitEvent?: 'QUOTE_VIEWED'
): Promise<void> {
  const eventType =
    explicitEvent ??
    quoteLifecycleEventFor(
      before.status ?? null,
      after.status ?? null,
      options
    );
  if (!eventType || after.is_template) return;
  const db = tenantDb(trx, tenant);
  const actor =
    options.actor ??
    (activity.performed_by
      ? { actorType: 'USER' as const, actorUserId: activity.performed_by }
      : { actorType: 'SYSTEM' as const });
  const occurredAt = iso(activity.created_at);
  const base = {
    quoteId: after.quote_id,
    quoteNumber: after.quote_number ?? null,
    version: Number(after.version),
    clientId: after.client_id ?? null,
    ...(after.contact_id ? { contactId: after.contact_id } : {}),
    ...(after.opportunity_id ? { opportunityId: after.opportunity_id } : {}),
    previousStatus: before.status!,
    newStatus: after.status!,
    currencyCode: after.currency_code,
    totalAmount: Number(after.total_amount),
    performedByType: actor.actorType,
    ...(actor.actorType === 'USER' ? { performedById: actor.actorUserId } : {}),
    ...(actor.actorType === 'CONTACT'
      ? { performedById: actor.actorContactId }
      : {}),
    ...(options.workflowRunId ? { workflowRunId: options.workflowRunId } : {}),
    ...(options.workflowLineage
      ? { workflowLineage: options.workflowLineage }
      : {}),
  };
  const builders =
    await import('../../workflow/streams/domainEventBuilders/quoteEventBuilders');
  let event: QuoteWorkflowEvent;
  switch (eventType) {
    case 'QUOTE_SENT':
      event = {
        eventType,
        payload: builders.buildQuoteSentPayload({
          ...base,
          sentAt: iso(after.sent_at ?? occurredAt),
        }),
      };
      break;
    case 'QUOTE_VIEWED':
      event = {
        eventType,
        payload: builders.buildQuoteViewedPayload({
          ...base,
          viewedAt: iso(after.viewed_at ?? occurredAt),
        }),
      };
      break;
    case 'QUOTE_APPROVED':
      event = {
        eventType,
        payload: builders.buildQuoteApprovedPayload({
          ...base,
          approvedAt: occurredAt,
        }),
      };
      break;
    case 'QUOTE_ACCEPTED': {
      const items = await db
        .table('quote_items')
        .where({
          quote_id: after.quote_id,
          is_optional: true,
          is_selected: true,
        })
        .select('quote_item_id');
      let acceptedByName = after.accepted_by_name ?? null;
      if (!acceptedByName && actor.actorType === 'CONTACT') {
        const contact = await db
          .table('contacts')
          .where({ contact_name_id: actor.actorContactId })
          .first('full_name');
        acceptedByName = contact?.full_name ?? null;
      } else if (!acceptedByName && actor.actorType === 'USER') {
        const user = await db
          .table('users')
          .where({ user_id: actor.actorUserId })
          .first('first_name', 'last_name');
        acceptedByName = user
          ? [user.first_name, user.last_name].filter(Boolean).join(' ')
          : null;
      }
      event = {
        eventType,
        payload: builders.buildQuoteAcceptedPayload({
          ...base,
          acceptedAt: iso(after.accepted_at ?? occurredAt),
          acceptedByName,
          acceptedOnBehalf:
            options.acceptedOnBehalf ?? actor.actorType === 'USER',
          selectedOptionalItemIds: items.map((item) =>
            String(item.quote_item_id)
          ),
        }),
      };
      break;
    }
    case 'QUOTE_REJECTED':
      event = {
        eventType,
        payload: builders.buildQuoteRejectedPayload({
          ...base,
          rejectedAt: iso(after.rejected_at ?? occurredAt),
          rejectionReason: after.rejection_reason ?? null,
        }),
      };
      break;
    case 'QUOTE_EXPIRED':
      event = {
        eventType,
        payload: builders.buildQuoteExpiredPayload({
          ...base,
          expiredAt: iso(after.expired_at ?? occurredAt),
        }),
      };
      break;
    case 'QUOTE_CONVERTED': {
      const conversionTargets: ('contract' | 'invoice' | 'sales_order')[] = [];
      if (after.converted_contract_id) conversionTargets.push('contract');
      if (after.converted_invoice_id) conversionTargets.push('invoice');
      if (options.details?.salesOrderId) conversionTargets.push('sales_order');
      event = {
        eventType,
        payload: builders.buildQuoteConvertedPayload({
          ...base,
          convertedAt: iso(after.converted_at ?? occurredAt),
          conversionTargets,
          ...(after.converted_contract_id
            ? { contractId: after.converted_contract_id }
            : {}),
          ...(after.converted_invoice_id
            ? { invoiceId: after.converted_invoice_id }
            : {}),
          ...(options.details?.salesOrderId
            ? { salesOrderId: options.details.salesOrderId }
            : {}),
        }),
      };
      break;
    }
    case 'QUOTE_CONVERSION_REVERTED': {
      if (!options.details?.releasedInvoiceId)
        throw new Error(
          'Quote conversion reversion requires the released invoice ID'
        );
      event = {
        eventType,
        payload: builders.buildQuoteConversionRevertedPayload({
          ...base,
          conversionRevertedAt: occurredAt,
          releasedInvoiceId: options.details.releasedInvoiceId,
        }),
      };
      break;
    }
    case 'QUOTE_SUPERSEDED': {
      if (!options.details?.supersededByQuoteId || !options.details.nextVersion)
        throw new Error('Quote supersession requires the next revision');
      event = {
        eventType,
        payload: builders.buildQuoteSupersededPayload({
          ...base,
          supersededAt: occurredAt,
          supersededByQuoteId: options.details.supersededByQuoteId,
          nextVersion: options.details.nextVersion,
        }),
      };
      break;
    }
    case 'QUOTE_CANCELLED':
      event = {
        eventType,
        payload: builders.buildQuoteCancelledPayload({
          ...base,
          cancelledAt: iso(after.cancelled_at ?? occurredAt),
        }),
      };
      break;
  }
  // Validate before commit: schema failures must roll back the transition, not silently lose its event.
  CorePayloadSchemas[eventType].parse(
    buildWorkflowPayload(event.payload as Record<string, unknown>, {
      tenantId: tenant,
      occurredAt,
      actor,
    })
  );
  queueQuoteLifecycleEvent(trx, event, {
    tenant,
    quoteId: after.quote_id,
    activityId: activity.activity_id,
    occurredAt,
    actor,
  });
}

/** Direct status writers share locking, validation, activity creation and event capture. */
export async function transitionQuoteStatus(
  conn: import('knex').Knex | import('knex').Knex.Transaction,
  tenant: string,
  quoteId: string,
  to: QuoteStatus,
  options: QuoteLifecycleOptions & { reason: string; patch?: Partial<IQuote> }
): Promise<IQuote> {
  if (!options.reason.trim())
    throw new Error('Quote transition requires a reason');
  return withTransaction(conn, async (trx) => {
    const db = tenantDb(trx, tenant);
    const before = await db
      .table<IQuote>('quotes')
      .where({ quote_id: quoteId })
      .forUpdate()
      .first();
    if (!before)
      throw new Error(`Quote ${quoteId} not found in tenant ${tenant}`);
    assertQuoteLifecycleTransition(before, to, options);
    const now = new Date().toISOString();
    const [after] = await db
      .table<IQuote>('quotes')
      .where({ quote_id: quoteId })
      .update({ ...options.patch, status: to, updated_at: now })
      .returning('*');
    if (before.status === to) return after;
    const [activity] = await db
      .table<IQuoteActivity>('quote_activities')
      .insert({
        tenant,
        quote_id: quoteId,
        activity_type: options.activity?.activity_type ?? 'status_changed',
        description: options.reason,
        performed_by:
          options.actor?.actorType === 'USER'
            ? options.actor.actorUserId
            : null,
        metadata: {
          previous_status: before.status,
          next_status: to,
          ...options.details,
          ...options.activity?.metadata,
        },
      })
      .returning('*');
    await recordQuoteLifecycleTransition(
      trx,
      tenant,
      before,
      after,
      activity,
      options
    );
    return after;
  });
}
