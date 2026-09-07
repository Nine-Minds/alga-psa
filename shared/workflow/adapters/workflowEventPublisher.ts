/**
 * Workflow-specific implementation of IEventPublisher interface
 * This adapter provides event publishing for workflow contexts, publishing
 * events to both the workflow stream and notification channels.
 */

import type { IEventPublisher } from '@alga-psa/types';
import { randomUUID } from 'node:crypto';
import { getWorkflowConversationRetainer, type WorkflowConversationEventRetainer } from '../runtime/registries/workflowConversationRegistry';
import { registerAfterCommit, tenantDb } from '@alga-psa/db';
import type { Knex } from 'knex';
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
  readonly transactionalCommentEvents = true as const;
  private readonly workflowRunId?: string;
  private readonly ticketAction?: 'create' | 'update';
  private readonly retainConversationEvent?: WorkflowConversationEventRetainer;
  private readonly suppressCommentEmail: boolean;
  private readonly trx?: Knex.Transaction;

  // suppressCommentEmail keeps comment events on the in-app channel only. Used for the
  // first comment on a new inbound-email ticket, which the TICKET_CREATED email already covers.
  constructor(options?: { suppressCommentEmail?: boolean; transaction?: Knex.Transaction; workflowRunId?: string; ticketAction?: 'create' | 'update'; retainConversationEvent?: WorkflowConversationEventRetainer }) {
    this.workflowRunId = options?.workflowRunId;
    this.ticketAction = options?.ticketAction;
    this.retainConversationEvent = options?.retainConversationEvent;
    this.suppressCommentEmail = options?.suppressCommentEmail ?? false;
    this.trx = options?.transaction;
  }

  private async publish(
    eventType: string,
    payload: Record<string, any>,
    options?: PublishOptions
  ): Promise<void> {
    const publish = () => publishNotificationEvent(eventType, payload, options);

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

    await this.publish('TICKET_CREATED', payload);
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

    await this.publish('TICKET_UPDATED', payload);
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

    await this.publish('TICKET_CLOSED', payload);
  }

  async publishCommentCreated(data: {
    tenantId: string;
    ticketId: string;
    commentId: string;
    userId?: string;
    metadata?: Record<string, any>;
  }): Promise<void> {
    if (!this.trx?.isTransaction) throw new Error('Comment publication requires its owning transaction');
    const payload = {
      tenantId: data.tenantId,
      ticketId: data.ticketId,
      commentId: data.commentId,
      userId: data.userId || data.ticketId, // fallback for schema validation
      comment: {
        id: data.commentId,
        content: data.metadata?.content || '',
        author: data.metadata?.author || 'System',
        authorType: data.metadata?.author_type,
        isInternal: data.metadata?.isInternal || false
      }
    };

    // Inbound replies fan out to internal + email channels (like the other publish*
    // methods) so the assigned tech/resources are emailed. The email subscriber excludes
    // the comment author and only emails external contacts for agent-authored comments,
    // so client replies never email the client back. The new-ticket first comment stays
    // in-app only (suppressCommentEmail) to avoid duplicating the TICKET_CREATED email.
    const options = this.suppressCommentEmail
      ? { channel: 'internal-notifications' }
      : undefined;
    const retain = this.retainConversationEvent ?? getWorkflowConversationRetainer();
    if (retain) {
      const retained = await retain(this.trx, { tenant: data.tenantId, ticketId: data.ticketId, commentId: data.commentId,
        eventId: randomUUID(), payload, workflowRunId: this.workflowRunId, actorUserId: data.userId, ticketAction: this.ticketAction,
        ...(this.suppressCommentEmail ? { channel: 'internal-notifications' as const } : {}) }, async (event, eventId) => {
        const { publishEvent } = await import('@alga-psa/event-bus/publishers');
        await publishEvent({ eventType: event.eventType, payload: event.payload } as any,
          { eventId, strict: true, ...(event.channel ? { channel: event.channel } : {}) });
      });
      if (retained) return;
    } else {
      const owner = tenantDb(this.trx, data.tenantId);
      const tenant = await owner.table('tenants').first('product_code');
      if (tenant?.product_code === 'co_managed' || await owner.table('co_management_relationships').first('relationship_id'))
        throw new Error('Co-managed workflow conversation retention is not configured');
    }
    await this.publish('TICKET_COMMENT_ADDED', payload, options);
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

    await this.publish('TICKET_ASSIGNED', payload);
  }
}
