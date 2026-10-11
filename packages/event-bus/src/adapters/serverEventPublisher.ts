/**
 * Server-side implementation of IEventPublisher interface
 * This adapter bridges the shared TicketModel with the server's event publishing system
 */

import type { IEventPublisher, WorkflowActor } from '@alga-psa/types';
import { resolveTicketEventActor } from '@alga-psa/event-schemas';
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
    await this.safePublishWorkflowEvent('TICKET_CREATED', data.tenantId, actorOf(data), buildServerPublisherTicketCreatedPayload(data, new Date().toISOString()));
  }

  async publishTicketUpdated(data: {
    tenantId: string;
    ticketId: string;
    userId?: string;
    actor?: WorkflowActor;
    changes: Record<string, any>;
    metadata?: Record<string, any>;
  }): Promise<void> {
    await this.safePublishWorkflowEvent('TICKET_UPDATED', data.tenantId, actorOf(data), buildServerPublisherTicketUpdatedPayload(data));
  }

  async publishTicketClosed(data: {
    tenantId: string;
    ticketId: string;
    userId?: string;
    actor?: WorkflowActor;
    metadata?: Record<string, any>;
  }): Promise<void> {
    await this.safePublishWorkflowEvent('TICKET_CLOSED', data.tenantId, actorOf(data), buildServerPublisherTicketClosedPayload(data, new Date().toISOString()));
  }

  async publishCommentCreated(data: {
    tenantId: string;
    ticketId: string;
    commentId: string;
    userId?: string;
    actor?: WorkflowActor;
    metadata?: Record<string, any>;
  }): Promise<void> {
    await this.safePublishWorkflowEvent('TICKET_COMMENT_ADDED', data.tenantId, actorOf(data), buildServerPublisherTicketCommentAddedPayload({ ...data, actor: actorOf(data) }));
  }

  async publishTicketAssigned(data: {
    tenantId: string;
    ticketId: string;
    userId: string;
    assignedByUserId?: string;
  }): Promise<void> {
    await this.safePublishWorkflowEvent('TICKET_ASSIGNED', data.tenantId, { actorType: 'USER', actorUserId: data.assignedByUserId ?? data.userId }, buildServerPublisherTicketAssignedPayload(data, new Date().toISOString()));
  }

  private async safePublishWorkflowEvent<T extends WorkflowCatalogEventType>(
    eventType: T,
    tenantId: string,
    actor: WorkflowActor,
    payload: BuiltWorkflowPayload<T> & { ticketId?: unknown }
  ): Promise<void> {
    await this.runAfterCommit(eventType, payload.ticketId, async () => {
      await publishWorkflowEvent({ eventType, payload, ctx: { tenantId, actor } });
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
