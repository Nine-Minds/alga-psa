/**
 * Workflow-specific implementation of IEventPublisher interface
 * This adapter provides event publishing for workflow contexts
 * For now this is a no-op implementation, but can be enhanced to integrate
 * with workflow action registry or external event systems
 */

import { IEventPublisher } from '../../models/ticketModel.js';

export class WorkflowEventPublisher implements IEventPublisher {
  async publishTicketCreated(data: {
    tenantId: string;
    ticketId: string;
    userId?: string;
    metadata?: Record<string, any>;
  }): Promise<void> {
    // TODO: Integrate with workflow action registry for event publishing
    // For now, log the event for debugging purposes
    console.log('[WorkflowEventPublisher] Ticket created:', {
      eventType: 'TICKET_CREATED',
      tenantId: data.tenantId,
      ticketId: data.ticketId,
      userId: data.userId,
      metadata: data.metadata
    });
  }

  async publishTicketUpdated(data: {
    tenantId: string;
    ticketId: string;
    userId?: string;
    changes: Record<string, any>;
    metadata?: Record<string, any>;
  }): Promise<void> {
    console.log('[WorkflowEventPublisher] Ticket updated:', {
      eventType: 'TICKET_UPDATED',
      tenantId: data.tenantId,
      ticketId: data.ticketId,
      userId: data.userId,
      changes: data.changes,
      metadata: data.metadata
    });
  }

  async publishTicketClosed(data: {
    tenantId: string;
    ticketId: string;
    userId?: string;
    metadata?: Record<string, any>;
  }): Promise<void> {
    console.log('[WorkflowEventPublisher] Ticket closed:', {
      eventType: 'TICKET_CLOSED',
      tenantId: data.tenantId,
      ticketId: data.ticketId,
      userId: data.userId,
      metadata: data.metadata
    });
  }

  async publishCommentCreated(data: {
    tenantId: string;
    ticketId: string;
    commentId: string;
    userId?: string;
    metadata?: Record<string, any>;
  }): Promise<void> {
    console.log('[WorkflowEventPublisher] Comment created:', {
      eventType: 'COMMENT_CREATED',
      tenantId: data.tenantId,
      ticketId: data.ticketId,
      commentId: data.commentId,
      userId: data.userId,
      metadata: data.metadata
    });
  }
}
