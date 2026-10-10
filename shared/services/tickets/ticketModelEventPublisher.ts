import type { IEventPublisher, WorkflowActor } from '@alga-psa/types';
import { resolveTicketEventActor, ticketEventActorFields } from '@alga-psa/event-schemas';
import type { Knex } from 'knex';
import { registerAfterCommit } from '@alga-psa/db';
import { publishWorkflowEvent } from '@alga-psa/event-bus/publishers';

/** The explicit actor if given, else derived from `userId` (never a substitute id). */
function actorOf(data: { userId?: string; actor?: WorkflowActor }): WorkflowActor {
  return data.actor ?? resolveTicketEventActor({ userId: data.userId });
}

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
    await this.safePublishEvent('TICKET_CREATED', {
      tenantId: data.tenantId,
      ticketId: data.ticketId,
      ...ticketEventActorFields(actorOf(data)),
      ...data.metadata,
      ...this.options.ticketCreatedPayload,
    });
  }

  async publishTicketUpdated(data: {
    tenantId: string;
    ticketId: string;
    userId?: string;
    actor?: WorkflowActor;
    changes: Record<string, any>;
    metadata?: Record<string, any>;
  }): Promise<void> {
    await this.safePublishEvent('TICKET_UPDATED', {
      tenantId: data.tenantId,
      ticketId: data.ticketId,
      ...ticketEventActorFields(actorOf(data)),
      changes: data.changes,
      ...data.metadata,
    });
  }

  async publishTicketClosed(data: { tenantId: string; ticketId: string; userId?: string; actor?: WorkflowActor; metadata?: Record<string, any> }): Promise<void> {
    await this.safePublishEvent('TICKET_CLOSED', {
      tenantId: data.tenantId,
      ticketId: data.ticketId,
      ...ticketEventActorFields(actorOf(data)),
      ...data.metadata,
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
    await this.safePublishEvent('TICKET_COMMENT_ADDED', {
      tenantId: data.tenantId,
      ticketId: data.ticketId,
      commentId: data.commentId,
      ...ticketEventActorFields(actorOf(data)),
      ...data.metadata,
    });
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
    // The payload was built from an explicit/derived actor (ticketEventActorFields), so a
    // CONTACT actor is carried by actorType + actorContactId. TICKET_ASSIGNED attributes
    // the action to the assigner (falling back to the assignee), as before.
    const actorUserId =
      typeof payload?.assignedByUserId === 'string' && payload.assignedByUserId
        ? payload.assignedByUserId
        : (typeof payload?.userId === 'string' ? payload.userId : undefined);
    const actor: WorkflowActor =
      payload?.actorType === 'CONTACT' && typeof payload?.actorContactId === 'string'
        ? { actorType: 'CONTACT', actorContactId: payload.actorContactId }
        : actorUserId
          ? { actorType: 'USER', actorUserId }
          : { actorType: 'SYSTEM' };

    const publish = () =>
      publishWorkflowEvent({
        eventType: eventType as any,
        payload,
        ctx: {
          tenantId: String(payload?.tenantId ?? ''),
          actor
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
