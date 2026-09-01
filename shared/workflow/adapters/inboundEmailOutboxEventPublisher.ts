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
import type { IEventPublisher } from '@alga-psa/types';
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

  private async enqueue(params: {
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
      payload: params.payload,
      publish_options: params.publishOptions ?? null,
    });
  }

  async publishTicketCreated(data: {
    tenantId: string;
    ticketId: string;
    userId?: string;
    metadata?: Record<string, any>;
  }): Promise<void> {
    await this.enqueue({
      eventKey: 'ticket-created',
      eventType: 'TICKET_CREATED',
      payload: {
        tenantId: data.tenantId,
        ticketId: data.ticketId,
        userId: data.userId || data.ticketId,
        ...(data.metadata ?? {}),
      },
    });
  }

  async publishTicketUpdated(data: {
    tenantId: string;
    ticketId: string;
    userId?: string;
    changes: Record<string, any>;
    metadata?: Record<string, any>;
  }): Promise<void> {
    await this.enqueue({
      eventKey: 'ticket-updated',
      eventType: 'TICKET_UPDATED',
      payload: {
        tenantId: data.tenantId,
        ticketId: data.ticketId,
        userId: data.userId || data.ticketId,
        changes: data.changes,
        ...(data.metadata ?? {}),
      },
    });
  }

  async publishTicketClosed(data: {
    tenantId: string;
    ticketId: string;
    userId?: string;
    metadata?: Record<string, any>;
  }): Promise<void> {
    await this.enqueue({
      eventKey: 'ticket-closed',
      eventType: 'TICKET_CLOSED',
      payload: {
        tenantId: data.tenantId,
        ticketId: data.ticketId,
        userId: data.userId || data.ticketId,
        ...(data.metadata ?? {}),
      },
    });
  }

  async publishCommentCreated(data: {
    tenantId: string;
    ticketId: string;
    commentId: string;
    userId?: string;
    metadata?: Record<string, any>;
  }): Promise<void> {
    const isInitial = this.suppressCommentEmailValue === true;
    await this.enqueue({
      eventKey: isInitial ? 'initial-comment-created' : 'reply-comment-created',
      eventType: 'TICKET_COMMENT_ADDED',
      payload: {
        tenantId: data.tenantId,
        ticketId: data.ticketId,
        userId: data.userId || data.ticketId,
        comment: {
          id: data.commentId,
          content: data.metadata?.content ?? '',
          author: data.metadata?.author ?? 'System',
          isInternal: data.metadata?.isInternal ?? false,
        },
      },
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
      payload: {
        tenantId: data.tenantId,
        ticketId: data.ticketId,
        userId: data.userId,
        assignedByUserId: data.assignedByUserId,
      },
    });
  }
}
