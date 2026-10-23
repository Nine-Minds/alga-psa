import type { IEventPublisher, WorkflowActor } from '@alga-psa/types';
import type { Knex } from 'knex';
import { registerAfterCommit } from '@alga-psa/db';
import { publishWorkflowEvent } from '@alga-psa/event-bus/publishers';
import type { BuiltWorkflowPayload, WorkflowCatalogEventType } from '@alga-psa/event-schemas';
import {
  buildModelPublisherTicketAssignedPayload,
  buildModelPublisherTicketCommentAddedPayload,
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

  async publishTicketCreated(data: { tenantId: string; ticketId: string; userId?: string; actor?: WorkflowActor; metadata?: Record<string, any> }): Promise<void> {
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
    actor?: WorkflowActor;
    changes: Record<string, any>;
    metadata?: Record<string, any>;
  }): Promise<void> {
    await this.safePublishEvent('TICKET_UPDATED', data.tenantId, buildModelPublisherTicketUpdatedPayload(data));
  }

  async publishTicketClosed(data: { tenantId: string; ticketId: string; userId?: string; actor?: WorkflowActor; metadata?: Record<string, any> }): Promise<void> {
    await this.safePublishEvent('TICKET_CLOSED', data.tenantId, buildModelPublisherTicketClosedPayload(data));
  }

  async publishCommentCreated(data: {
    tenantId: string;
    ticketId: string;
    commentId: string;
    userId?: string;
    actor?: WorkflowActor;
    metadata?: Record<string, any>;
  }): Promise<void> {
    await this.safePublishEvent('TICKET_COMMENT_ADDED', data.tenantId, buildModelPublisherTicketCommentAddedPayload(data));
  }

  async publishTicketAssigned(data: { tenantId: string; ticketId: string; userId: string; assignedByUserId?: string }): Promise<void> {
    await this.safePublishEvent('TICKET_ASSIGNED', data.tenantId, buildModelPublisherTicketAssignedPayload(data));
  }

  private safePublishEvent<T extends WorkflowCatalogEventType>(
    eventType: T,
    tenantId: string,
    payload: BuiltWorkflowPayload<T>
  ): Promise<void> {
    return this.deliver(eventType, payload, (ctx) =>
      publishWorkflowEvent({ eventType, payload, ctx: { tenantId, ...ctx } })
    );
  }

  private async deliver(
    eventType: string,
    payload: unknown,
    publishWith: (ctx: { actor: WorkflowActor }) => Promise<void>
  ): Promise<void> {
    // The payload was built from an explicit/derived actor (ticketEventActorFields), so a
    // CONTACT actor is carried by actorType + actorContactId. TICKET_ASSIGNED attributes
    // the action to the assigner (falling back to the assignee), as before.
    const fields = payload as
      | { assignedByUserId?: unknown; userId?: unknown; ticketId?: unknown; actorType?: unknown; actorContactId?: unknown }
      | undefined;
    const actorUserId =
      typeof fields?.assignedByUserId === 'string' && fields.assignedByUserId
        ? fields.assignedByUserId
        : (typeof fields?.userId === 'string' ? fields.userId : undefined);
    const actor: WorkflowActor =
      fields?.actorType === 'CONTACT' && typeof fields.actorContactId === 'string'
        ? { actorType: 'CONTACT', actorContactId: fields.actorContactId }
        : actorUserId
          ? { actorType: 'USER', actorUserId }
          : { actorType: 'SYSTEM' };

    const publish = () =>
      publishWith({ actor });

    if (this.trx) {
      registerAfterCommit(this.trx, publish, `${eventType} ticket=${fields?.ticketId ?? 'unknown'}`);
      return;
    }

    try {
      await publish();
    } catch (error) {
      console.error(`Failed to publish ${eventType} event:`, error);
    }
  }
}
