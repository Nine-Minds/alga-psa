import type { IEventPublisher } from '@alga-psa/types';
import { getEventBus } from '@alga-psa/event-bus';

// Email event channel constant - inlined to avoid circular dependency with notifications
// Must match the value in @alga-psa/notifications/emailChannel
const EMAIL_EVENT_CHANNEL = 'emailservice::v7';
function getEmailEventChannel(): string {
  return EMAIL_EVENT_CHANNEL;
}

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
    await this.safePublishEvent('COMMENT_CREATED', {
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
      // Publish to email channel
      await getEventBus().publish(
        {
          eventType,
          payload,
        },
        { channel: getEmailEventChannel() }
      );

      // Also publish to internal notifications channel
      await getEventBus().publish(
        {
          eventType,
          payload,
        },
        { channel: 'internal-notifications' }
      );
    } catch (error) {
      console.error(`Failed to publish ${eventType} event:`, error);
    }
  }
}
