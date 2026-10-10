import type { IEventPublisher } from '@alga-psa/types';
import type { Knex } from 'knex';
import { registerAfterCommit } from '@alga-psa/db';
import { publishWorkflowEventByName } from '@alga-psa/event-bus/publishers';
import {
  buildModelPublisherTicketAssignedPayload,
  buildModelPublisherTicketClosedPayload,
  buildModelPublisherTicketCreatedPayload,
  buildModelPublisherTicketUpdatedPayload,
} from '../../lib/tickets/ticketWorkflowEventPayloads';

export class TicketModelEventPublisher implements IEventPublisher {
  /**
   * When constructed with the creating transaction, publishes are deferred
   * until that transaction commits (via registerAfterCommit), so subscribers
   * never race the still-open creation transaction. Requires the transaction
   * to be owned by a withTransaction frame.
   */
  constructor(
    private readonly trx?: Knex.Transaction,
    private readonly options: {
      /**
       * Extra TICKET_CREATED payload fields supplied by the creator, e.g. the
       * notification suppression flags. TicketModel owns the base metadata, so
       * the creator cannot pass these through createTicket itself.
       */
      ticketCreatedPayload?: Record<string, unknown>;
    } = {},
  ) {}

  async publishTicketCreated(data: { tenantId: string; ticketId: string; userId?: string; metadata?: Record<string, any> }): Promise<void> {
    await this.safePublishEvent(
      'TICKET_CREATED',
      data.tenantId,
      buildModelPublisherTicketCreatedPayload(data, this.options.ticketCreatedPayload)
    );
  }

  async publishTicketUpdated(data: {
    tenantId: string;
    ticketId: string;
    userId?: string;
    changes: Record<string, any>;
    metadata?: Record<string, any>;
  }): Promise<void> {
    await this.safePublishEvent('TICKET_UPDATED', data.tenantId, buildModelPublisherTicketUpdatedPayload(data));
  }

  async publishTicketClosed(data: { tenantId: string; ticketId: string; userId?: string; metadata?: Record<string, any> }): Promise<void> {
    await this.safePublishEvent('TICKET_CLOSED', data.tenantId, buildModelPublisherTicketClosedPayload(data));
  }

  async publishCommentCreated(data: {
    tenantId: string;
    ticketId: string;
    commentId: string;
    userId?: string;
    metadata?: Record<string, any>;
  }): Promise<void> {
    await this.safePublishEvent('TICKET_COMMENT_ADDED', data.tenantId, {
      ticketId: data.ticketId,
      commentId: data.commentId,
      userId: data.userId,
      ...data.metadata,
    });
  }

  async publishTicketAssigned(data: { tenantId: string; ticketId: string; userId: string; assignedByUserId?: string }): Promise<void> {
    await this.safePublishEvent('TICKET_ASSIGNED', data.tenantId, buildModelPublisherTicketAssignedPayload(data));
  }

  private async safePublishEvent(eventType: string, tenantId: string, payload: any): Promise<void> {
    const actorUserId =
      typeof payload?.assignedByUserId === 'string' && payload.assignedByUserId
        ? payload.assignedByUserId
        : (typeof payload?.userId === 'string' ? payload.userId : undefined);

    const publish = () =>
      publishWorkflowEventByName({
        eventType: eventType,
        payload,
        ctx: {
          tenantId,
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
