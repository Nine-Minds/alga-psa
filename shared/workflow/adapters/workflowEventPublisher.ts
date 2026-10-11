/**
 * Workflow-specific implementation of IEventPublisher interface
 * This adapter provides event publishing for workflow contexts, publishing
 * events to both the workflow stream and notification channels.
 */

import type { IEventPublisher, WorkflowActor } from '@alga-psa/types';
import {
  buildWorkflowPayload,
  resolveTicketEventActor,
  ticketEventActorFields,
} from '@alga-psa/event-schemas';
import { registerAfterCommit } from '@alga-psa/db';
import type { Knex } from 'knex';
import type { PublishOptions } from '@alga-psa/event-bus/publishers';

// LEVERAGE: pattern ticket-event-publisher — ticket-event publishing is wired per call site (this adapter, TicketModelEventPublisher, publishTicketEvent in createTicketWithSideEffects); one ticket-event publisher layer would unify them

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

/**
 * Base ticket/comment payload with an honest actor. `userId` is only ever a real user id;
 * when nobody acted it is omitted and actorType states who did (never the ticket id).
 * Stamping through buildWorkflowPayload adds occurredAt so the payload also validates
 * on the domain schema branch.
 */
function ticketEventPayload(
  data: { tenantId: string; ticketId: string; userId?: string; actor?: WorkflowActor },
  fields: Record<string, unknown>
): Record<string, any> {
  const actor = data.actor ?? resolveTicketEventActor({ userId: data.userId });
  return buildWorkflowPayload(
    {
      tenantId: data.tenantId,
      ticketId: data.ticketId,
      ...ticketEventActorFields(actor),
      ...fields,
    },
    { tenantId: data.tenantId }
  );
}

export class WorkflowEventPublisher implements IEventPublisher {
  private readonly suppressCommentEmail: boolean;
  private readonly trx?: Knex.Transaction;
  private readonly workflowExecutionId?: string;

  // suppressCommentEmail keeps comment events on the in-app channel only. Used for the
  // first comment on a new inbound-email ticket, which the TICKET_CREATED email already covers.
  constructor(options?: { suppressCommentEmail?: boolean; transaction?: Knex.Transaction; workflowExecutionId?: string }) {
    this.suppressCommentEmail = options?.suppressCommentEmail ?? false;
    this.trx = options?.transaction;
    this.workflowExecutionId = options?.workflowExecutionId;
  }

  private async publish(
    eventType: string,
    payload: Record<string, any>,
    options?: PublishOptions
  ): Promise<void> {
    // workflowExecutionId stamps the originating run on the event so workflow
    // trigger matching can refuse to start a run's own definition (self-trigger guard).
    const effectiveOptions: PublishOptions | undefined = this.workflowExecutionId
      ? { ...options, workflow: { ...(options?.workflow ?? {}), executionId: this.workflowExecutionId } }
      : options;
    const publish = () => publishNotificationEvent(eventType, payload, effectiveOptions);

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
    actor?: WorkflowActor;
    metadata?: Record<string, any>;
  }): Promise<void> {
    const payload = ticketEventPayload(data, { ...data.metadata });

    await this.publish('TICKET_CREATED', payload);
  }

  async publishTicketUpdated(data: {
    tenantId: string;
    ticketId: string;
    userId?: string;
    actor?: WorkflowActor;
    changes: Record<string, any>;
    metadata?: Record<string, any>;
  }): Promise<void> {
    const payload = ticketEventPayload(data, { changes: data.changes, ...data.metadata });

    await this.publish('TICKET_UPDATED', payload);
  }

  async publishTicketClosed(data: {
    tenantId: string;
    ticketId: string;
    userId?: string;
    actor?: WorkflowActor;
    metadata?: Record<string, any>;
  }): Promise<void> {
    const payload = ticketEventPayload(data, { ...data.metadata });

    await this.publish('TICKET_CLOSED', payload);
  }

  async publishCommentCreated(data: {
    tenantId: string;
    ticketId: string;
    commentId: string;
    userId?: string;
    actor?: WorkflowActor;
    metadata?: Record<string, any>;
  }): Promise<void> {
    const payload = ticketEventPayload(data, {
      commentId: data.commentId,
      comment: {
        id: data.commentId,
        content: data.metadata?.content || '',
        author: data.metadata?.author || 'System',
        isInternal: data.metadata?.isInternal || false
      }
    });

    // Inbound replies fan out to internal + email channels (like the other publish*
    // methods) so the assigned tech/resources are emailed. The email subscriber excludes
    // the comment author and only emails external contacts for agent-authored comments,
    // so client replies never email the client back. The new-ticket first comment stays
    // in-app only (suppressCommentEmail) to avoid duplicating the TICKET_CREATED email.
    const options = this.suppressCommentEmail
      ? { channel: 'internal-notifications' }
      : undefined;
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
