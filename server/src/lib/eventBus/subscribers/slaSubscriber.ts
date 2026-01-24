/**
 * SLA Event Subscriber
 *
 * Listens to ticket-related events and updates SLA tracking accordingly:
 * - TICKET_CREATED: Start SLA tracking for new tickets
 * - TICKET_UPDATED: Handle status/priority changes that affect SLA
 * - TICKET_CLOSED: Record resolution time and SLA met status
 * - TICKET_COMMENT_ADDED: Record first response time (for non-internal comments)
 * - TICKET_RESPONSE_STATE_CHANGED: Handle pause/resume for awaiting_client
 */

import logger from '@alga-psa/core/logger';
import { getEventBus } from '../index';
import {
  EventSchemas,
  type TicketCreatedEvent,
  type TicketUpdatedEvent,
  type TicketClosedEvent,
  type TicketCommentAddedEvent
} from '../events';
import { createTenantKnex, runWithTenant, withTransaction } from '@alga-psa/db';
import {
  startSlaForTicket,
  recordFirstResponse,
  recordResolution,
  handlePriorityChange
} from '@alga-psa/sla';
import {
  handleStatusChange,
  handleResponseStateChange
} from '@alga-psa/sla';
import type { Knex } from 'knex';

let isRegistered = false;

export async function registerSlaSubscriber(): Promise<void> {
  if (isRegistered) {
    return;
  }

  await getEventBus().subscribe('TICKET_CREATED', handleTicketCreatedEvent);
  await getEventBus().subscribe('TICKET_UPDATED', handleTicketUpdatedEvent);
  await getEventBus().subscribe('TICKET_CLOSED', handleTicketClosedEvent);
  await getEventBus().subscribe('TICKET_COMMENT_ADDED', handleTicketCommentAddedEvent);
  await getEventBus().subscribe('TICKET_RESPONSE_STATE_CHANGED', handleResponseStateChangedEvent);

  isRegistered = true;
  logger.info('[SlaSubscriber] Registered SLA event handlers');
}

export async function unregisterSlaSubscriber(): Promise<void> {
  if (!isRegistered) {
    return;
  }

  await getEventBus().unsubscribe('TICKET_CREATED', handleTicketCreatedEvent);
  await getEventBus().unsubscribe('TICKET_UPDATED', handleTicketUpdatedEvent);
  await getEventBus().unsubscribe('TICKET_CLOSED', handleTicketClosedEvent);
  await getEventBus().unsubscribe('TICKET_COMMENT_ADDED', handleTicketCommentAddedEvent);
  await getEventBus().unsubscribe('TICKET_RESPONSE_STATE_CHANGED', handleResponseStateChangedEvent);

  isRegistered = false;
  logger.info('[SlaSubscriber] Unregistered SLA event handlers');
}

/**
 * Handle ticket created event - start SLA tracking
 */
async function handleTicketCreatedEvent(event: unknown): Promise<void> {
  try {
    const validated = EventSchemas.TICKET_CREATED.parse(event) as TicketCreatedEvent;
    const { tenantId, ticketId, userId } = validated.payload;

    logger.info('[SlaSubscriber] Handling TICKET_CREATED', { tenantId, ticketId });

    await runWithTenant(tenantId, async () => {
      const { knex } = await createTenantKnex();

      await withTransaction(knex, async (trx: Knex.Transaction) => {
        // Get ticket details needed for SLA
        const ticket = await trx('tickets')
          .where({ tenant: tenantId, ticket_id: ticketId })
          .select('client_id', 'board_id', 'priority_id', 'entered_at')
          .first();

        if (!ticket) {
          logger.warn('[SlaSubscriber] Ticket not found for TICKET_CREATED', { tenantId, ticketId });
          return;
        }

        const result = await startSlaForTicket(
          trx,
          tenantId,
          ticketId,
          ticket.client_id,
          ticket.board_id,
          ticket.priority_id,
          ticket.entered_at ? new Date(ticket.entered_at) : new Date()
        );

        if (result.success && result.sla_policy_id) {
          logger.info('[SlaSubscriber] Started SLA tracking for ticket', {
            tenantId,
            ticketId,
            policyId: result.sla_policy_id,
            responseDueAt: result.sla_response_due_at?.toISOString(),
            resolutionDueAt: result.sla_resolution_due_at?.toISOString()
          });
        } else if (!result.success) {
          logger.error('[SlaSubscriber] Failed to start SLA tracking', {
            tenantId,
            ticketId,
            error: result.error
          });
        }
        // If no policy assigned, that's normal - just log at debug level
      });
    });
  } catch (error) {
    logger.error('[SlaSubscriber] Failed to handle TICKET_CREATED event', {
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

/**
 * Handle ticket updated event - check for status/priority changes
 */
async function handleTicketUpdatedEvent(event: unknown): Promise<void> {
  try {
    const validated = EventSchemas.TICKET_UPDATED.parse(event) as TicketUpdatedEvent;
    const { tenantId, ticketId, userId, changes } = validated.payload;

    if (!changes) {
      return;
    }

    logger.debug('[SlaSubscriber] Handling TICKET_UPDATED', { tenantId, ticketId, changes });

    await runWithTenant(tenantId, async () => {
      const { knex } = await createTenantKnex();

      await withTransaction(knex, async (trx: Knex.Transaction) => {
        // Handle priority change
        if (changes.priority_id) {
          const newPriorityId = changes.priority_id as { to?: string };
          if (newPriorityId.to) {
            logger.info('[SlaSubscriber] Priority changed, recalculating SLA deadlines', {
              tenantId,
              ticketId,
              newPriorityId: newPriorityId.to
            });

            await handlePriorityChange(
              trx,
              tenantId,
              ticketId,
              newPriorityId.to,
              userId
            );
          }
        }

        // Handle status change (for pause/resume)
        if (changes.status_id) {
          const statusChange = changes.status_id as { from?: string; to?: string };
          if (statusChange.to) {
            logger.info('[SlaSubscriber] Status changed, checking SLA pause state', {
              tenantId,
              ticketId,
              fromStatus: statusChange.from,
              toStatus: statusChange.to
            });

            const result = await handleStatusChange(
              trx,
              tenantId,
              ticketId,
              statusChange.from || null,
              statusChange.to,
              userId
            );

            if (result.was_paused !== result.is_now_paused) {
              logger.info('[SlaSubscriber] SLA pause state changed', {
                tenantId,
                ticketId,
                wasPaused: result.was_paused,
                isNowPaused: result.is_now_paused
              });
            }
          }
        }
      });
    });
  } catch (error) {
    logger.error('[SlaSubscriber] Failed to handle TICKET_UPDATED event', {
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

/**
 * Handle ticket closed event - record resolution
 */
async function handleTicketClosedEvent(event: unknown): Promise<void> {
  try {
    const validated = EventSchemas.TICKET_CLOSED.parse(event) as TicketClosedEvent;
    const { tenantId, ticketId, userId } = validated.payload;

    logger.info('[SlaSubscriber] Handling TICKET_CLOSED', { tenantId, ticketId });

    await runWithTenant(tenantId, async () => {
      const { knex } = await createTenantKnex();

      await withTransaction(knex, async (trx: Knex.Transaction) => {
        // Get the closed_at time from the ticket
        const ticket = await trx('tickets')
          .where({ tenant: tenantId, ticket_id: ticketId })
          .select('closed_at')
          .first();

        const closedAt = ticket?.closed_at ? new Date(ticket.closed_at) : new Date();

        const result = await recordResolution(
          trx,
          tenantId,
          ticketId,
          closedAt,
          userId
        );

        if (result.success && result.met !== null) {
          logger.info('[SlaSubscriber] Recorded ticket resolution', {
            tenantId,
            ticketId,
            met: result.met,
            resolvedAt: result.recorded_at.toISOString()
          });
        }
      });
    });
  } catch (error) {
    logger.error('[SlaSubscriber] Failed to handle TICKET_CLOSED event', {
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

/**
 * Handle ticket comment added event - record first response for public comments
 */
async function handleTicketCommentAddedEvent(event: unknown): Promise<void> {
  try {
    const validated = EventSchemas.TICKET_COMMENT_ADDED.parse(event) as TicketCommentAddedEvent;
    const { tenantId, ticketId, userId, comment } = validated.payload;

    // Only track non-internal comments as responses
    if (!comment || comment.isInternal) {
      return;
    }

    // Only track comments from internal users as "responses"
    if (comment.authorType !== 'internal') {
      return;
    }

    logger.info('[SlaSubscriber] Handling TICKET_COMMENT_ADDED for SLA response', {
      tenantId,
      ticketId,
      commentId: comment.id
    });

    await runWithTenant(tenantId, async () => {
      const { knex } = await createTenantKnex();

      await withTransaction(knex, async (trx: Knex.Transaction) => {
        const result = await recordFirstResponse(
          trx,
          tenantId,
          ticketId,
          new Date(),
          userId
        );

        if (result.success && result.met !== null) {
          logger.info('[SlaSubscriber] Recorded first response', {
            tenantId,
            ticketId,
            met: result.met,
            respondedAt: result.recorded_at.toISOString()
          });
        }
      });
    });
  } catch (error) {
    logger.error('[SlaSubscriber] Failed to handle TICKET_COMMENT_ADDED event', {
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

/**
 * Handle response state changed event - pause/resume for awaiting_client
 */
async function handleResponseStateChangedEvent(event: unknown): Promise<void> {
  try {
    // The TICKET_RESPONSE_STATE_CHANGED event uses the same schema as TICKET_UPDATED
    const validated = EventSchemas.TICKET_UPDATED.parse(event) as TicketUpdatedEvent;
    const { tenantId, ticketId, userId, changes } = validated.payload;

    if (!changes?.response_state) {
      return;
    }

    const responseStateChange = changes.response_state as { from?: string | null; to?: string | null };

    logger.info('[SlaSubscriber] Handling TICKET_RESPONSE_STATE_CHANGED', {
      tenantId,
      ticketId,
      fromState: responseStateChange.from,
      toState: responseStateChange.to
    });

    await runWithTenant(tenantId, async () => {
      const { knex } = await createTenantKnex();

      await withTransaction(knex, async (trx: Knex.Transaction) => {
        const result = await handleResponseStateChange(
          trx,
          tenantId,
          ticketId,
          responseStateChange.from || null,
          responseStateChange.to || null,
          userId
        );

        if (result.was_paused !== result.is_now_paused) {
          logger.info('[SlaSubscriber] SLA pause state changed due to response state', {
            tenantId,
            ticketId,
            wasPaused: result.was_paused,
            isNowPaused: result.is_now_paused
          });
        }
      });
    });
  } catch (error) {
    logger.error('[SlaSubscriber] Failed to handle TICKET_RESPONSE_STATE_CHANGED event', {
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

// Export test hooks for unit testing
export const __testHooks = {
  handleTicketCreatedEvent,
  handleTicketUpdatedEvent,
  handleTicketClosedEvent,
  handleTicketCommentAddedEvent,
  handleResponseStateChangedEvent
};
