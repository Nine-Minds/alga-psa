/**
 * Transactional outbox event publisher for the durable inbound email pipeline.
 *
 * Implements `IEventPublisher` but only inserts durable outbox rows through the
 * supplied transaction — it never writes Redis. The core transaction owns both
 * the ticket/comment writes and the outbox rows, so a crash before commit rolls
 * back everything and a crash after commit redelivers the same terminal result
 * without creating new outbox rows (`(tenant, inbox_id, event_key)` is unique).
 *
 * Each outbox row's `outbox_id` is reused as the caller-supplied event ID and as
 * the payload idempotency key on every publish retry.
 */

import type { Knex } from 'knex';
import { randomUUID } from 'node:crypto';
import type { IEventPublisher, WorkflowActor } from '@alga-psa/types';
import type { BuiltWorkflowPayload, WorkflowCatalogEventType } from '@alga-psa/event-schemas';
import {
  buildInboundPublisherTicketAssignedPayload,
  buildInboundPublisherTicketCommentAddedPayload,
  buildInboundPublisherTicketClosedPayload,
  buildInboundPublisherTicketCreatedPayload,
  buildInboundPublisherTicketUpdatedPayload,
  buildTicketStatusChangedOutboxPayload,
  withOutboxOccurredAt,
} from '../../lib/tickets/ticketWorkflowEventPayloads';
import { insertOutboxRow } from '../../services/email/inboundEmailDurableStore';

export interface InboundEmailOutboxEventPublisherContext {
  trx: Knex.Transaction;
  tenantId: string;
  inboxId: string;
  /**
   * When true, `publishCommentCreated` is recorded as `initial-comment-created`
   * (the first comment on a new inbound-email ticket, kept in-app only).
   * Otherwise it is recorded as `reply-comment-created`.
   */
  suppressCommentEmail?: boolean;
}

export class InboundEmailOutboxEventPublisher implements IEventPublisher {
  /** Marker so helpers know outbox insert failures must propagate, not swallow. */
  public readonly __inboundOutboxPublisher = true as const;

  private suppressCommentEmailValue: boolean;

  constructor(private readonly ctx: InboundEmailOutboxEventPublisherContext) {
    this.suppressCommentEmailValue = ctx.suppressCommentEmail ?? false;
  }

  /**
   * Per-call override for the initial-vs-reply comment distinction. The first
   * comment on a new inbound-email ticket is recorded as `initial-comment-created`
   * (in-app only); a reply is `reply-comment-created`.
   */
  setSuppressCommentEmail(value: boolean): void {
    this.suppressCommentEmailValue = value;
  }

  get suppressCommentEmail(): boolean {
    return this.suppressCommentEmailValue;
  }

  /**
   * Catalogued events: the payload must come from a registered builder
   * (`BuiltWorkflowPayload<T>`). The dispatcher re-validates the stored row
   * with `reviveStoredWorkflowPayload` before replaying it.
   */
  private async enqueue<T extends WorkflowCatalogEventType>(params: {
    eventKey: string;
    eventType: T;
    payload: BuiltWorkflowPayload<T>;
    publishOptions?: Record<string, unknown> | null;
  }): Promise<void> {
    await this.insertRow({ ...params, payload: params.payload as Record<string, unknown> });
  }

  private async insertRow(params: {
    eventKey: string;
    eventType: string;
    payload: Record<string, unknown>;
    publishOptions?: Record<string, unknown> | null;
  }): Promise<void> {
    const outboxId = randomUUID();
    await insertOutboxRow(this.ctx.trx, {
      tenant: this.ctx.tenantId,
      inbox_id: this.ctx.inboxId,
      outbox_id: outboxId,
      event_key: params.eventKey,
      event_type: params.eventType,
      // Workflow triggers validate payloads against schemas that require
      // `occurredAt`. Stamp it when the event is recorded (not when the
      // dispatcher publishes) so a retried publish keeps the original time.
      // Every outbox payload carries `tenantId` (the replay uses the raw event bus, no envelope).
      payload: withOutboxOccurredAt({ tenantId: this.ctx.tenantId, ...params.payload }, new Date().toISOString()),
      publish_options: params.publishOptions ?? null,
    });
  }

  async publishTicketCreated(data: {
    tenantId: string;
    ticketId: string;
    userId?: string;
    actor?: WorkflowActor;
    metadata?: Record<string, any>;
  }): Promise<void> {
    await this.enqueue({
      eventKey: 'ticket-created',
      eventType: 'TICKET_CREATED',
      payload: buildInboundPublisherTicketCreatedPayload(data),
    });
  }

  /** `payload` comes from `buildContactCreatedPayload` (shared/workflow/streams/domainEventBuilders). */
  async publishContactCreated(payload: Record<string, unknown> & BuiltWorkflowPayload<'CONTACT_CREATED'>): Promise<void> {
    const contactId = String(payload.contactId ?? 'unknown');
    await this.enqueue({ eventKey: `contact_created:${contactId}`, eventType: 'CONTACT_CREATED', payload });
  }

  async publishTicketUpdated(data: {
    tenantId: string;
    ticketId: string;
    userId?: string;
    actor?: WorkflowActor;
    changes: Record<string, any>;
    metadata?: Record<string, any>;
  }): Promise<void> {
    await this.enqueue({
      eventKey: 'ticket-updated',
      eventType: 'TICKET_UPDATED',
      payload: buildInboundPublisherTicketUpdatedPayload(data),
    });
  }

  async publishTicketStatusChanged(data: {
    tenantId: string;
    ticketId: string;
    userId?: string;
    previousStatusId: string;
    newStatusId: string;
    changedAt: string;
  }): Promise<void> {
    await this.enqueue({
      eventKey: 'ticket-status-changed',
      eventType: 'TICKET_STATUS_CHANGED',
      payload: buildTicketStatusChangedOutboxPayload(data),
    });
  }

  async publishTicketClosed(data: {
    tenantId: string;
    ticketId: string;
    userId?: string;
    actor?: WorkflowActor;
    metadata?: Record<string, any>;
  }): Promise<void> {
    await this.enqueue({
      eventKey: 'ticket-closed',
      eventType: 'TICKET_CLOSED',
      payload: buildInboundPublisherTicketClosedPayload(data),
    });
  }

  async publishCommentCreated(data: {
    tenantId: string;
    ticketId: string;
    commentId: string;
    userId?: string;
    actor?: WorkflowActor;
    metadata?: Record<string, any>;
  }): Promise<void> {
    const isInitial = this.suppressCommentEmailValue === true;
    await this.enqueue({
      eventKey: isInitial ? 'initial-comment-created' : 'reply-comment-created',
      eventType: 'TICKET_COMMENT_ADDED',
      payload: buildInboundPublisherTicketCommentAddedPayload(data),
      publishOptions: isInitial ? { channel: 'internal-notifications' } : null,
    });
  }

  async publishTicketAssigned(data: {
    tenantId: string;
    ticketId: string;
    userId: string;
    assignedByUserId?: string;
  }): Promise<void> {
    await this.enqueue({
      eventKey: 'ticket-assigned',
      eventType: 'TICKET_ASSIGNED',
      payload: buildInboundPublisherTicketAssignedPayload(data),
    });
  }
}
