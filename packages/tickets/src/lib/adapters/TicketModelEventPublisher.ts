import type { IEventPublisher } from '@alga-psa/types';
import { publishWorkflowEvent } from '@alga-psa/event-bus/publishers';

export class TicketModelEventPublisher implements IEventPublisher {
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
    await this.safePublishEvent('TICKET_COMMENT_ADDED', {
      tenantId: data.tenantId,
      ticketId: data.ticketId,
      commentId: data.commentId,
      userId: data.userId,
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
    try {
      const actorUserId =
        typeof payload?.assignedByUserId === 'string' && payload.assignedByUserId
          ? payload.assignedByUserId
          : (typeof payload?.userId === 'string' ? payload.userId : undefined);

      await publishWorkflowEvent({
        eventType: eventType as any,
        payload,
        ctx: {
          tenantId: String(payload?.tenantId ?? ''),
          actor: actorUserId ? { actorType: 'USER', actorUserId } : { actorType: 'SYSTEM' }
        }
      });
    } catch (error) {
      console.error(`Failed to publish ${eventType} event:`, error);
    }
  }
}
