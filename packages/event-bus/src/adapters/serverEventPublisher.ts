/**
 * Server-side implementation of IEventPublisher interface
 * This adapter bridges the shared TicketModel with the server's event publishing system
 */

import type { IEventPublisher } from '@alga-psa/types';
import { publishWorkflowEvent } from '../publishers';

export class ServerEventPublisher implements IEventPublisher {
  async publishTicketCreated(data: {
    tenantId: string;
    ticketId: string;
    userId?: string;
    metadata?: Record<string, any>;
  }): Promise<void> {
    await this.safePublishWorkflowEvent('TICKET_CREATED', data.tenantId, data.userId, {
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
    changes: Record<string, any>;
    metadata?: Record<string, any>;
  }): Promise<void> {
    await this.safePublishWorkflowEvent('TICKET_UPDATED', data.tenantId, data.userId, {
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
    metadata?: Record<string, any>;
  }): Promise<void> {
    await this.safePublishWorkflowEvent('TICKET_CLOSED', data.tenantId, data.userId, {
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
    metadata?: Record<string, any>;
  }): Promise<void> {
    // Legacy comment payloads are modeled as TICKET_COMMENT_ADDED in the event bus schema.
    await this.safePublishWorkflowEvent('TICKET_COMMENT_ADDED', data.tenantId, data.userId, {
      ticketId: data.ticketId,
      comment: { id: data.commentId },
      userId: data.userId,
      ...data.metadata
    });
  }

  async publishTicketAssigned(data: {
    tenantId: string;
    ticketId: string;
    userId: string;
    assignedByUserId?: string;
  }): Promise<void> {
    await this.safePublishWorkflowEvent('TICKET_ASSIGNED', data.tenantId, data.assignedByUserId ?? data.userId, {
      ticketId: data.ticketId,
      assignedToUserId: data.userId,
      assignedByUserId: data.assignedByUserId,
      assignedAt: new Date().toISOString(),
    });
  }

  private async safePublishWorkflowEvent(
    eventType: string,
    tenantId: string,
    actorUserId: string | undefined,
    payload: Record<string, unknown>
  ): Promise<void> {
    try {
      await publishWorkflowEvent({
        eventType: eventType as any,
        payload,
        ctx: {
          tenantId,
          actor: actorUserId ? { actorType: 'USER', actorUserId } : { actorType: 'SYSTEM' }
        }
      });
    } catch (error) {
      console.error(`Failed to publish ${eventType} event:`, error);
      // Don't throw - event publishing failure shouldn't break ticket operations
    }
  }
}
