/**
 * Workflow-specific implementation of IEventPublisher interface
 * This adapter provides event publishing for workflow contexts, publishing
 * events to both the workflow stream and notification channels.
 */

import type { IEventPublisher, WorkflowActor } from '@alga-psa/types';
import { buildWorkflowPayload } from '@alga-psa/event-schemas';
import { registerAfterCommit } from '@alga-psa/db';
import type { Knex } from 'knex';
import type { PublishOptions } from '@alga-psa/event-bus/publishers';
import type { BuiltWorkflowPayload, WorkflowCatalogEventType } from '@alga-psa/event-schemas';
import {
  buildInboundPublisherTicketAssignedPayload,
  buildInboundPublisherTicketCommentAddedPayload,
  buildInboundPublisherTicketClosedPayload,
  buildInboundPublisherTicketCreatedPayload,
  buildInboundPublisherTicketUpdatedPayload,
} from '../../lib/tickets/ticketWorkflowEventPayloads';

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
  send: (options?: PublishOptions) => Promise<void>,
  options?: PublishOptions
): Promise<void> {
  try {
    await send(options);

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
 * Stamps occurredAt (via buildWorkflowPayload) so the payload also validates on the domain
 * schema branch. The payload builders already carry an honest actor: `userId` is only ever
 * a real user id, and actorType states who acted (never the ticket id).
 */
function stampOccurredAt<P extends Record<string, unknown>>(payload: P, tenantId: string) {
  return buildWorkflowPayload(payload, { tenantId });
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

  /** Catalogued events: the payload must come from a registered builder. */
  private async publish<T extends WorkflowCatalogEventType>(
    eventType: T,
    payload: BuiltWorkflowPayload<T>,
    options?: PublishOptions
  ): Promise<void> {
    await this.dispatch(
      eventType,
      payload as Record<string, any>,
      async (opts) => {
        const { publishBuiltWorkflowPayload } = await import('@alga-psa/event-bus/publishers');
        await publishBuiltWorkflowPayload({ eventType, payload }, opts);
      },
      options
    );
  }

  private async dispatch(
    eventType: string,
    payload: Record<string, any>,
    send: (options?: PublishOptions) => Promise<void>,
    options?: PublishOptions
  ): Promise<void> {
    // workflowExecutionId stamps the originating run on the event so workflow
    // trigger matching can refuse to start a run's own definition (self-trigger guard).
    const effectiveOptions: PublishOptions | undefined = this.workflowExecutionId
      ? { ...options, workflow: { ...(options?.workflow ?? {}), executionId: this.workflowExecutionId } }
      : options;
    const publish = () => publishNotificationEvent(eventType, payload, send, effectiveOptions);

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
    await this.publish('TICKET_CREATED', stampOccurredAt(buildInboundPublisherTicketCreatedPayload(data), data.tenantId));
  }

  async publishTicketUpdated(data: {
    tenantId: string;
    ticketId: string;
    userId?: string;
    actor?: WorkflowActor;
    changes: Record<string, any>;
    metadata?: Record<string, any>;
  }): Promise<void> {
    await this.publish('TICKET_UPDATED', stampOccurredAt(buildInboundPublisherTicketUpdatedPayload(data), data.tenantId));
  }

  async publishTicketClosed(data: {
    tenantId: string;
    ticketId: string;
    userId?: string;
    actor?: WorkflowActor;
    metadata?: Record<string, any>;
  }): Promise<void> {
    await this.publish('TICKET_CLOSED', stampOccurredAt(buildInboundPublisherTicketClosedPayload(data), data.tenantId));
  }

  async publishCommentCreated(data: {
    tenantId: string;
    ticketId: string;
    commentId: string;
    userId?: string;
    actor?: WorkflowActor;
    metadata?: Record<string, any>;
  }): Promise<void> {
    // Inbound replies fan out to internal + email channels (like the other publish*
    // methods) so the assigned tech/resources are emailed. The email subscriber excludes
    // the comment author and only emails external contacts for agent-authored comments,
    // so client replies never email the client back. The new-ticket first comment stays
    // in-app only (suppressCommentEmail) to avoid duplicating the TICKET_CREATED email.
    const options = this.suppressCommentEmail
      ? { channel: 'internal-notifications' }
      : undefined;
    await this.publish('TICKET_COMMENT_ADDED', stampOccurredAt(buildInboundPublisherTicketCommentAddedPayload(data), data.tenantId), options);
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
    await this.publish('TICKET_ASSIGNED', buildInboundPublisherTicketAssignedPayload(data));
  }
}
