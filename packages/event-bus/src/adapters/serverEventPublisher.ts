/**
 * Server-side implementation of IEventPublisher interface
 * This adapter bridges the shared TicketModel with the server's event publishing system
 */

import type { IEventPublisher, WorkflowActor } from '@alga-psa/types';
import { resolveTicketEventActor, ticketEventActorFields } from '../workflow/workflowEventPublishHelpers';
import { registerAfterCommit } from '@alga-psa/db';
import { publishWorkflowEvent } from '../publishers';

/** The explicit actor if given, else derived from `userId` (never a substitute id). */
function actorOf(data: { userId?: string; actor?: WorkflowActor }): WorkflowActor {
  return data.actor ?? resolveTicketEventActor({ userId: data.userId });
}

export class ServerEventPublisher implements IEventPublisher {
  constructor(private readonly trx?: Parameters<typeof registerAfterCommit>[0]) {}

  async publishTicketCreated(data: {
    tenantId: string;
    ticketId: string;
    userId?: string;
    actor?: WorkflowActor;
    metadata?: Record<string, any>;
  }): Promise<void> {
    await this.safePublishWorkflowEvent('TICKET_CREATED', data.tenantId, actorOf(data), {
      ticketId: data.ticketId,
      createdByUserId: data.userId,
      createdAt: new Date().toISOString(),
      ...data.metadata
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
    await this.safePublishWorkflowEvent('TICKET_UPDATED', data.tenantId, actorOf(data), {
      ticketId: data.ticketId,
      updatedByUserId: data.userId,
      updatedFields: Object.keys(data.changes ?? {}),
      changes: data.changes,
      ...data.metadata
    });
  }

  async publishTicketClosed(data: {
    tenantId: string;
    ticketId: string;
    userId?: string;
    actor?: WorkflowActor;
    metadata?: Record<string, any>;
  }): Promise<void> {
    await this.safePublishWorkflowEvent('TICKET_CLOSED', data.tenantId, actorOf(data), {
      ticketId: data.ticketId,
      closedByUserId: data.userId,
      closedAt: new Date().toISOString(),
      ...data.metadata
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
    // Legacy comment payloads are modeled as TICKET_COMMENT_ADDED in the event bus schema.
    await this.safePublishWorkflowEvent('TICKET_COMMENT_ADDED', data.tenantId, actorOf(data), {
      ticketId: data.ticketId,
      commentId: data.commentId,
      comment: { id: data.commentId },
      ...ticketEventActorFields(actorOf(data)),
      ...data.metadata
    });
  }

  async publishTicketAssigned(data: {
    tenantId: string;
    ticketId: string;
    userId: string;
    assignedByUserId?: string;
  }): Promise<void> {
    await this.safePublishWorkflowEvent('TICKET_ASSIGNED', data.tenantId, { actorType: 'USER', actorUserId: data.assignedByUserId ?? data.userId }, {
      ticketId: data.ticketId,
      // The recipient must ride in payload.userId — that is the single field the
      // internal-notification subscriber reads for the assignee (handleTicketAssigned
      // destructures event.payload.userId). Emitting only assignedToUserId (the v2
      // workflow field) loses the recipient through union validation, so the
      // notification is either created for the wrong user or stamped the subtype
      // default. Every other TICKET_ASSIGNED publisher carries userId; this one
      // must too.
      userId: data.userId,
      assignedToUserId: data.userId,
      assignedByUserId: data.assignedByUserId,
      assignedAt: new Date().toISOString(),
    });
  }

  private async safePublishWorkflowEvent(
    eventType: string,
    tenantId: string,
    actor: WorkflowActor,
    payload: Record<string, unknown>
  ): Promise<void> {
    const publish = async () => {
      try {
        await publishWorkflowEvent({
          eventType: eventType as any,
          payload,
          ctx: {
            tenantId,
            actor
          }
        });
      } catch (error) {
        console.error(`Failed to publish ${eventType} event:`, error);
        // Don't throw - event publishing failure shouldn't break ticket operations
      }
    };

    if (this.trx) {
      registerAfterCommit(
        this.trx,
        publish,
        `${eventType} ticket=${String(payload.ticketId ?? 'unknown')}`
      );
      return;
    }

    await publish();
  }
}
