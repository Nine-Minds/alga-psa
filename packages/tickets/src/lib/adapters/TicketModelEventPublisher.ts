import type { IEventPublisher } from '@alga-psa/types';
import type { Knex } from 'knex';
import { registerAfterCommit } from '@alga-psa/db';
import { retainNativeConversationEvent } from '../nativeConversationEvents';
import { publishWorkflowEvent } from '@alga-psa/event-bus/publishers';

export class TicketModelEventPublisher implements IEventPublisher {
  readonly transactionalCommentEvents = true as const;
  /**
   * When constructed with the creating transaction, publishes are deferred
   * until that transaction commits (via registerAfterCommit), so subscribers
   * never race the still-open creation transaction. Requires the transaction
   * to be owned by a withTransaction frame.
   */
  constructor(private readonly trx?: Knex.Transaction) {}

  async publishTicketCreated(data: { tenantId: string; ticketId: string; userId?: string; metadata?: Record<string, any> }): Promise<void> {
    await this.safePublishEvent('TICKET_CREATED', {
      tenantId: data.tenantId,
      ticketId: data.ticketId,
      userId: data.userId,
      ...data.metadata,
    });
  }

  async publishTicketUpdated(data: {
    tenantId: string;
    ticketId: string;
    userId?: string;
    changes: Record<string, any>;
    metadata?: Record<string, any>;
  }): Promise<void> {
    await this.safePublishEvent('TICKET_UPDATED', {
      tenantId: data.tenantId,
      ticketId: data.ticketId,
      userId: data.userId,
      changes: data.changes,
      ...data.metadata,
    });
  }

  async publishTicketClosed(data: { tenantId: string; ticketId: string; userId?: string; metadata?: Record<string, any> }): Promise<void> {
    await this.safePublishEvent('TICKET_CLOSED', {
      tenantId: data.tenantId,
      ticketId: data.ticketId,
      userId: data.userId,
      ...data.metadata,
    });
  }

  async publishCommentCreated(data: {
    tenantId: string;
    ticketId: string;
    commentId: string;
    userId?: string;
    metadata?: Record<string, any>;
  }): Promise<void> {
    if (!this.trx?.isTransaction) throw new Error('Comment publication requires its owning transaction');
    await retainNativeConversationEvent(this.trx, { tenant: data.tenantId, ticketId: data.ticketId, commentId: data.commentId }, {
      kind: 'event', eventType: 'TICKET_COMMENT_ADDED', payload: {
        tenantId: data.tenantId, ticketId: data.ticketId, commentId: data.commentId, userId: data.userId,
        comment: { id: data.commentId, content: data.metadata?.content ?? '', author: data.metadata?.author ?? 'System',
          authorType: data.metadata?.author_type, isInternal: data.metadata?.isInternal ?? false },
      },
    }, { legacyPublish: () => publishWorkflowEvent({
      eventType: 'TICKET_COMMENT_ADDED',
      payload: { tenantId: data.tenantId, ticketId: data.ticketId, commentId: data.commentId, userId: data.userId, ...data.metadata },
      ctx: { tenantId: data.tenantId, actor: data.userId ? { actorType: 'USER', actorUserId: data.userId } : { actorType: 'SYSTEM' } },
    } as any) });
  }

  async publishTicketAssigned(data: { tenantId: string; ticketId: string; userId: string; assignedByUserId?: string }): Promise<void> {
    await this.safePublishEvent('TICKET_ASSIGNED', {
      tenantId: data.tenantId,
      ticketId: data.ticketId,
      userId: data.userId,
      assignedByUserId: data.assignedByUserId,
    });
  }

  private async safePublishEvent(eventType: string, payload: any): Promise<void> {
    const actorUserId =
      typeof payload?.assignedByUserId === 'string' && payload.assignedByUserId
        ? payload.assignedByUserId
        : (typeof payload?.userId === 'string' ? payload.userId : undefined);

    const publish = () =>
      publishWorkflowEvent({
        eventType: eventType as any,
        payload,
        ctx: {
          tenantId: String(payload?.tenantId ?? ''),
          actor: actorUserId ? { actorType: 'USER', actorUserId } : { actorType: 'SYSTEM' }
        }
      });

    if (this.trx) {
      registerAfterCommit(this.trx, publish, `${eventType} ticket=${payload?.ticketId ?? 'unknown'}`);
      return;
    }

    try {
      await publish();
    } catch (error) {
      console.error(`Failed to publish ${eventType} event:`, error);
    }
  }
}
