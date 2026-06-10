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
} from '@alga-psa/event-schemas';
import {
  createTenantKnex,
  runWithTenant,
  withTransaction,
  withTenantTransactionRetryReadOnly
} from '@alga-psa/db';
import {
  startSlaForTicket,
  recordFirstResponse,
  recordResolution,
  handlePriorityChange,
  handlePolicyChange,
  dispatchSlaBackendActions,
  type SlaBackendAction
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

  // subscriberId disambiguates per-(event, handler) processed tracking from
  // other subscribers on the same default-channel streams (survey/webhook
  // handlers share function names like handleTicketClosedEvent).
  await getEventBus().subscribe('TICKET_CREATED', handleTicketCreatedEvent, { subscriberId: 'sla' });
  await getEventBus().subscribe('TICKET_UPDATED', handleTicketUpdatedEvent, { subscriberId: 'sla' });
  await getEventBus().subscribe('TICKET_CLOSED', handleTicketClosedEvent, { subscriberId: 'sla' });
  await getEventBus().subscribe('TICKET_COMMENT_ADDED', handleTicketCommentAddedEvent, { subscriberId: 'sla' });
  await getEventBus().subscribe('TICKET_RESPONSE_STATE_CHANGED', handleResponseStateChangedEvent, { subscriberId: 'sla' });

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

      // The main creation paths publish TICKET_CREATED after their
      // transaction commits, so the row is normally visible immediately.
      // Some paths still publish in-transaction; retry the read briefly
      // (outside any transaction, so no locks are held while waiting).
      let ticket: { client_id: string; board_id: string; priority_id: string; entered_at: string | Date | null } | undefined;
      for (let attempt = 0; attempt < 5; attempt++) {
        if (attempt > 0) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        ticket = await knex('tickets')
          .where({ tenant: tenantId, ticket_id: ticketId })
          .select('client_id', 'board_id', 'priority_id', 'entered_at')
          .first();
        if (ticket) {
          break;
        }
      }

      if (!ticket) {
        // Throw so the bus redelivers (bounded by maxDeliveries, then
        // dead-letter) instead of acking and silently never starting SLA.
        // Genuinely deleted tickets end up in the dead-letter stream.
        throw new Error(`Ticket not found for TICKET_CREATED: ${ticketId}`);
      }
      const createdTicket = ticket;

      const result = await withTransaction(knex, async (trx: Knex.Transaction) => {
        const startResult = await startSlaForTicket(
          trx,
          tenantId,
          ticketId,
          createdTicket.client_id,
          createdTicket.board_id,
          createdTicket.priority_id,
          createdTicket.entered_at ? new Date(createdTicket.entered_at) : new Date()
        );

        if (startResult.success && startResult.sla_policy_id) {
          logger.info('[SlaSubscriber] Started SLA tracking for ticket', {
            tenantId,
            ticketId,
            policyId: startResult.sla_policy_id,
            responseDueAt: startResult.sla_response_due_at?.toISOString(),
            resolutionDueAt: startResult.sla_resolution_due_at?.toISOString()
          });
        } else if (!startResult.success) {
          logger.error('[SlaSubscriber] Failed to start SLA tracking', {
            tenantId,
            ticketId,
            error: startResult.error
          });
        }
        // If no policy assigned, that's normal - just log at debug level
        return startResult;
      });

      await dispatchSlaBackendActions(result?.backendActions);
    });
  } catch (error) {
    logger.error('[SlaSubscriber] Failed to handle TICKET_CREATED event', {
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    throw error;
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

      const backendActions = await withTransaction(knex, async (trx: Knex.Transaction) => {
        const collected: SlaBackendAction[] = [];

        // Handle priority change
        if (changes.priority_id) {
          const priorityChange = changes.priority_id as { old?: string; new?: string };
          if (priorityChange.new) {
            logger.info('[SlaSubscriber] Priority changed, recalculating SLA deadlines', {
              tenantId,
              ticketId,
              newPriorityId: priorityChange.new
            });

            const priorityResult = await handlePriorityChange(
              trx,
              tenantId,
              ticketId,
              priorityChange.new,
              userId
            );
            collected.push(...priorityResult.backendActions);
          }
        }

        // Handle status change (for pause/resume)
        if (changes.status_id) {
          const statusChange = changes.status_id as { old?: string; new?: string };
          if (statusChange.new) {
            logger.info('[SlaSubscriber] Status changed, checking SLA pause state', {
              tenantId,
              ticketId,
              fromStatus: statusChange.old,
              toStatus: statusChange.new
            });

            const result = await handleStatusChange(
              trx,
              tenantId,
              ticketId,
              statusChange.old || null,
              statusChange.new,
              userId
            );
            collected.push(...(result.backendActions ?? []));

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

        // Handle SLA policy change
        if (changes.sla_policy_id) {
          const policyChange = changes.sla_policy_id as { old?: string | null; new?: string | null };
          if (policyChange.new !== undefined) {
            logger.info('[SlaSubscriber] SLA policy changed, restarting SLA tracking', {
              tenantId,
              ticketId,
              fromPolicyId: policyChange.old,
              toPolicyId: policyChange.new
            });

            const policyResult = await handlePolicyChange(
              trx,
              tenantId,
              ticketId,
              policyChange.new ?? null,
              userId
            );
            collected.push(...policyResult.backendActions);
          }
        }

        return collected;
      });

      await dispatchSlaBackendActions(backendActions);
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
  const validated = EventSchemas.TICKET_CLOSED.parse(event) as TicketClosedEvent;
  const { tenantId, ticketId, userId } = validated.payload;

  logger.info('[SlaSubscriber] Handling TICKET_CLOSED', { tenantId, ticketId });

  try {
    const result = await withTenantTransactionRetryReadOnly(tenantId, async (trx: Knex.Transaction) => {
      // Get the closed_at time from the ticket
      const ticket = await trx('tickets')
        .where({ tenant: tenantId, ticket_id: ticketId })
        .select('closed_at')
        .first();

      const closedAt = ticket?.closed_at ? new Date(ticket.closed_at) : new Date();

      const resolutionResult = await recordResolution(
        trx,
        tenantId,
        ticketId,
        closedAt,
        userId
      );

      if (resolutionResult.success && resolutionResult.met !== null) {
        logger.info('[SlaSubscriber] Recorded ticket resolution', {
          tenantId,
          ticketId,
          met: resolutionResult.met,
          resolvedAt: resolutionResult.recorded_at.toISOString()
        });
        return resolutionResult;
      }

      if (resolutionResult.success && resolutionResult.met === null) {
        logger.info('[SlaSubscriber] TICKET_CLOSED handled but no SLA tracked', {
          tenantId,
          ticketId
        });
        return resolutionResult;
      }

      logger.error('[SlaSubscriber] recordResolution returned failure', {
        tenantId,
        ticketId,
        error: resolutionResult.error
      });
      throw new Error(resolutionResult.error || 'recordResolution failed');
    });

    await runWithTenant(tenantId, () => dispatchSlaBackendActions(result.backendActions));
  } catch (error) {
    logger.error('[SlaSubscriber] Failed to handle TICKET_CLOSED event', {
      tenantId,
      ticketId,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    throw error;
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

      const result = await withTransaction(knex, async (trx: Knex.Transaction) => {
        const responseResult = await recordFirstResponse(
          trx,
          tenantId,
          ticketId,
          new Date(),
          userId
        );

        if (responseResult.success && responseResult.met !== null) {
          logger.info('[SlaSubscriber] Recorded first response', {
            tenantId,
            ticketId,
            met: responseResult.met,
            respondedAt: responseResult.recorded_at.toISOString()
          });
        }

        return responseResult;
      });

      await dispatchSlaBackendActions(result.backendActions);
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
    const validated = EventSchemas.TICKET_RESPONSE_STATE_CHANGED.parse(event);
    const payload = validated.payload as {
      tenantId: string;
      ticketId: string;
      userId?: string | null;
      previousState?: string | null;
      newState?: string | null;
      // v2 schema fields
      previousResponseState?: string | null;
      newResponseState?: string | null;
    };

    const tenantId = payload.tenantId;
    const ticketId = payload.ticketId;
    const userId = payload.userId ?? null;
    // Support both legacy (previousState/newState) and v2 (previousResponseState/newResponseState) formats
    const previousState = payload.previousState ?? payload.previousResponseState ?? null;
    const newState = payload.newState ?? payload.newResponseState ?? null;

    if (!previousState && !newState) {
      return;
    }

    logger.info('[SlaSubscriber] Handling TICKET_RESPONSE_STATE_CHANGED', {
      tenantId,
      ticketId,
      fromState: previousState,
      toState: newState
    });

    await runWithTenant(tenantId, async () => {
      const { knex } = await createTenantKnex();

      // Check if response state tracking is enabled for this tenant
      const tenantSettingsRow = await knex('tenant_settings')
        .select('ticket_display_settings')
        .where({ tenant: tenantId })
        .first();
      const responseStateEnabled = (tenantSettingsRow?.ticket_display_settings as any)?.responseStateTrackingEnabled ?? true;
      if (!responseStateEnabled) {
        logger.debug('[SlaSubscriber] Response state tracking disabled, skipping', { tenantId, ticketId });
        return;
      }

      const result = await withTransaction(knex, async (trx: Knex.Transaction) => {
        const changeResult = await handleResponseStateChange(
          trx,
          tenantId,
          ticketId,
          previousState,
          newState,
          userId ?? undefined
        );

        if (changeResult.was_paused !== changeResult.is_now_paused) {
          logger.info('[SlaSubscriber] SLA pause state changed due to response state', {
            tenantId,
            ticketId,
            wasPaused: changeResult.was_paused,
            isNowPaused: changeResult.is_now_paused
          });
        }

        return changeResult;
      });

      await dispatchSlaBackendActions(result.backendActions);
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
