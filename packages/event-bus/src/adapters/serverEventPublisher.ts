/**
 * Server-side implementation of IEventPublisher interface
 * This adapter bridges the shared TicketModel with the server's event publishing system
 */

import type { IEventPublisher } from '@alga-psa/types';
import { registerAfterCommit } from '@alga-psa/db';
import { publishWorkflowEventByName } from '../publishers';
import {
  buildServerPublisherTicketAssignedPayload,
  buildServerPublisherTicketClosedPayload,
  buildServerPublisherTicketCreatedPayload,
  buildServerPublisherTicketUpdatedPayload,
} from './serverEventPublisherPayloads';

export class ServerEventPublisher implements IEventPublisher {
  constructor(private readonly trx?: Parameters<typeof registerAfterCommit>[0]) {}

  async publishTicketCreated(data: {
    tenantId: string;
    ticketId: string;
    userId?: string;
    metadata?: Record<string, any>;
  }): Promise<void> {
    await this.safePublishWorkflowEvent('TICKET_CREATED', data.tenantId, data.userId, buildServerPublisherTicketCreatedPayload(data, new Date().toISOString()));
  }

  async publishTicketUpdated(data: {
    tenantId: string;
    ticketId: string;
    userId?: string;
    changes: Record<string, any>;
    metadata?: Record<string, any>;
  }): Promise<void> {
    await this.safePublishWorkflowEvent('TICKET_UPDATED', data.tenantId, data.userId, buildServerPublisherTicketUpdatedPayload(data));
  }

  async publishTicketClosed(data: {
    tenantId: string;
    ticketId: string;
    userId?: string;
    metadata?: Record<string, any>;
  }): Promise<void> {
    await this.safePublishWorkflowEvent('TICKET_CLOSED', data.tenantId, data.userId, buildServerPublisherTicketClosedPayload(data, new Date().toISOString()));
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
    await this.safePublishWorkflowEvent('TICKET_ASSIGNED', data.tenantId, data.assignedByUserId ?? data.userId, buildServerPublisherTicketAssignedPayload(data, new Date().toISOString()));
  }

  private async safePublishWorkflowEvent(
    eventType: string,
    tenantId: string,
    actorUserId: string | undefined,
    payload: Record<string, unknown>
  ): Promise<void> {
    const publish = async () => {
      try {
        await publishWorkflowEventByName({
          eventType: eventType,
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
