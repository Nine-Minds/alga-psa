/**
 * Server-side implementation of IEventPublisher interface
 * This adapter bridges the shared TicketModel with the server's event publishing system
 */

import type { IEventPublisher } from '@alga-psa/types';
import { registerAfterCommit } from '@alga-psa/db';
import type { BuiltWorkflowPayload, WorkflowCatalogEventType } from '@alga-psa/event-schemas';
import { publishWorkflowEvent } from '../publishers';
import {
  buildServerPublisherTicketAssignedPayload,
  buildServerPublisherTicketCommentAddedPayload,
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
    await this.safePublishWorkflowEvent('TICKET_COMMENT_ADDED', data.tenantId, data.userId, buildServerPublisherTicketCommentAddedPayload(data));
  }

  async publishTicketAssigned(data: {
    tenantId: string;
    ticketId: string;
    userId: string;
    assignedByUserId?: string;
  }): Promise<void> {
    await this.safePublishWorkflowEvent('TICKET_ASSIGNED', data.tenantId, data.assignedByUserId ?? data.userId, buildServerPublisherTicketAssignedPayload(data, new Date().toISOString()));
  }

  private ctxFor(tenantId: string, actorUserId: string | undefined) {
    return {
      tenantId,
      actor: actorUserId
        ? ({ actorType: 'USER', actorUserId } as const)
        : ({ actorType: 'SYSTEM' } as const),
    };
  }

  private async safePublishWorkflowEvent<T extends WorkflowCatalogEventType>(
    eventType: T,
    tenantId: string,
    actorUserId: string | undefined,
    payload: BuiltWorkflowPayload<T> & { ticketId?: unknown }
  ): Promise<void> {
    await this.runAfterCommit(eventType, payload.ticketId, async () => {
      await publishWorkflowEvent({ eventType, payload, ctx: this.ctxFor(tenantId, actorUserId) });
    });
  }

  private async runAfterCommit(eventType: string, ticketId: unknown, doPublish: () => Promise<void>): Promise<void> {
    const publish = async () => {
      try {
        await doPublish();
      } catch (error) {
        console.error(`Failed to publish ${eventType} event:`, error);
        // Don't throw - event publishing failure shouldn't break ticket operations
      }
    };

    if (this.trx) {
      registerAfterCommit(this.trx, publish, `${eventType} ticket=${String(ticketId ?? 'unknown')}`);
      return;
    }

    await publish();
  }
}
