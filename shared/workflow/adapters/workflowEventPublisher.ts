/**
 * Workflow-specific implementation of IEventPublisher interface
 * This adapter provides event publishing for workflow contexts, publishing
 * events to both the workflow stream and notification channels.
 */

import type { IEventPublisher } from '@alga-psa/types';
import { v4 as uuidv4 } from 'uuid';

/**
 * Helper function to publish events to notification channels
 * This ensures workflow-created tickets trigger the same notifications as server-created tickets
 */
async function publishToNotificationChannels(
  eventType: string,
  tenant: string,
  payload: Record<string, any>
): Promise<void> {
  try {
    const { RedisStreamClient } = await import('../streams/redisStreamClient');
    const client = new RedisStreamClient();
    await client.initialize();

    const event = {
      id: uuidv4(),
      eventType,
      timestamp: new Date().toISOString(),
      payload
    };

    const eventJson = JSON.stringify(event);

    // Publish to email notifications channel
    const emailStream = `events:${eventType}:email-notifications`;
    await client.publishToStream(emailStream, {
      event: eventJson,
      channel: 'email-notifications'
    });

    // Publish to internal notifications channel
    const internalStream = `events:${eventType}:internal-notifications`;
    await client.publishToStream(internalStream, {
      event: eventJson,
      channel: 'internal-notifications'
    });

    console.log(`[WorkflowEventPublisher] Published ${eventType} to notification channels`);
  } catch (error) {
    console.error(`[WorkflowEventPublisher] Failed to publish ${eventType} to notification channels:`, error);
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

    await publishToNotificationChannels('TICKET_CREATED', data.tenantId, payload);
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

    await publishToNotificationChannels('TICKET_UPDATED', data.tenantId, payload);
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

    await publishToNotificationChannels('TICKET_CLOSED', data.tenantId, payload);
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

    await publishToNotificationChannels('TICKET_COMMENT_ADDED', data.tenantId, payload);
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

    await publishToNotificationChannels('TICKET_ASSIGNED', data.tenantId, payload);
  }
}
