/**
 * Workflow-specific implementation of IEventPublisher interface
 * This adapter provides event publishing for workflow contexts, publishing
 * events to both the workflow stream and notification channels.
 */

import type { IEventPublisher } from '@alga-psa/types';
import type { PublishOptions } from '@alga-psa/event-bus/publishers';

/**
 * Publish workflow-originated ticket events through the shared event bus.
 *
 * Inbound email ticket creation runs from shared workflow code, not the Next.js
 * ticket action path. Publishing through @alga-psa/event-bus keeps the stream
 * names and fanout channels aligned with the app subscribers (emailservice::v7
 * and internal-notifications). Do not write raw Redis stream names here; they
 * can drift from the configured subscriber channels.
 */
async function publishNotificationEvent(
  eventType: string,
  payload: Record<string, any>,
  options?: PublishOptions
): Promise<void> {
  try {
    const { publishEvent } = await import('@alga-psa/event-bus/publishers');
    await publishEvent({ eventType: eventType as any, payload } as any, options);

    console.log(`[WorkflowEventPublisher] Published ${eventType} through event bus`, {
      tenantId: payload.tenantId,
      ticketId: payload.ticketId,
      channel: options?.channel,
    });
  } catch (error) {
    console.error(`[WorkflowEventPublisher] Failed to publish ${eventType} through event bus:`, error);
    // Don't throw - notification failure shouldn't break ticket operations
  }
}

export class WorkflowEventPublisher implements IEventPublisher {
  async publishTicketCreated(data: {
    tenantId: string;
    ticketId: string;
    userId?: string;
    metadata?: Record<string, any>;
  }): Promise<void> {
    const payload = {
      tenantId: data.tenantId,
      ticketId: data.ticketId,
      userId: data.userId || data.ticketId, // fallback for schema validation
      ...data.metadata
    };

    await publishNotificationEvent('TICKET_CREATED', payload);
  }

  async publishTicketUpdated(data: {
    tenantId: string;
    ticketId: string;
    userId?: string;
    changes: Record<string, any>;
    metadata?: Record<string, any>;
  }): Promise<void> {
    const payload = {
      tenantId: data.tenantId,
      ticketId: data.ticketId,
      userId: data.userId || data.ticketId, // fallback for schema validation
      changes: data.changes,
      ...data.metadata
    };

    await publishNotificationEvent('TICKET_UPDATED', payload);
  }

  async publishTicketClosed(data: {
    tenantId: string;
    ticketId: string;
    userId?: string;
    metadata?: Record<string, any>;
  }): Promise<void> {
    const payload = {
      tenantId: data.tenantId,
      ticketId: data.ticketId,
      userId: data.userId || data.ticketId, // fallback for schema validation
      ...data.metadata
    };

    await publishNotificationEvent('TICKET_CLOSED', payload);
  }

  async publishCommentCreated(data: {
    tenantId: string;
    ticketId: string;
    commentId: string;
    userId?: string;
    metadata?: Record<string, any>;
  }): Promise<void> {
    const payload = {
      tenantId: data.tenantId,
      ticketId: data.ticketId,
      userId: data.userId || data.ticketId, // fallback for schema validation
      comment: {
        id: data.commentId,
        content: data.metadata?.content || '',
        author: data.metadata?.author || 'System',
        isInternal: data.metadata?.isInternal || false
      }
    };

    await publishNotificationEvent('TICKET_COMMENT_ADDED', payload, { channel: 'internal-notifications' });
  }

  /**
   * Publish ticket assigned event - used when a ticket is assigned to an agent
   */
  async publishTicketAssigned(data: {
    tenantId: string;
    ticketId: string;
    userId: string;
    assignedByUserId?: string;
  }): Promise<void> {
    const payload = {
      tenantId: data.tenantId,
      ticketId: data.ticketId,
      userId: data.userId,
      assignedByUserId: data.assignedByUserId
    };

    await publishNotificationEvent('TICKET_ASSIGNED', payload);
  }
}
