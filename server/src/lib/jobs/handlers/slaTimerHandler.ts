/**
 * SLA Timer Job Handler
 *
 * This job runs periodically to:
 * 1. Check all tickets with active SLA tracking for threshold crossings
 * 2. Send notifications when thresholds are crossed
 * 3. Update breach status when SLA deadlines are exceeded
 *
 * The job runs per-tenant and processes all tickets with:
 * - An active SLA policy assigned
 * - Not yet resolved (sla_resolution_at is null)
 * - Not currently paused (sla_paused_at is null)
 */

import { createTenantKnex, withTransaction } from '@alga-psa/db';
import { runWithTenant } from '@alga-psa/db';
import { Knex } from 'knex';
import { checkAndSendThresholdNotifications } from '@alga-psa/sla';
import logger from '@alga-psa/core/logger';

export interface SlaTimerJobData extends Record<string, unknown> {
  tenantId: string;
}

/**
 * Main handler for the SLA timer job.
 *
 * This job is designed to be lightweight and efficient:
 * - Runs frequently (every 5 minutes recommended)
 * - Only processes tickets that need attention
 * - Tracks which thresholds have already been notified
 */
export async function slaTimerHandler(data: SlaTimerJobData): Promise<void> {
  const { tenantId } = data;

  logger.info(`Running SLA timer job for tenant ${tenantId}`);

  try {
    await runWithTenant(tenantId, async () => {
      const { knex } = await createTenantKnex();

      await withTransaction(knex, async (trx: Knex.Transaction) => {
        // Get all tickets that need SLA checking
        const ticketsToCheck = await getTicketsNeedingSlaCheck(trx, tenantId);

        logger.info(`Found ${ticketsToCheck.length} tickets to check for SLA thresholds`, {
          tenantId,
          ticketCount: ticketsToCheck.length
        });

        for (const ticket of ticketsToCheck) {
          try {
            await processTicketSla(trx, tenantId, ticket);
          } catch (ticketError) {
            logger.error(`Error processing SLA for ticket ${ticket.ticket_id}`, {
              tenantId,
              ticketId: ticket.ticket_id,
              error: ticketError instanceof Error ? ticketError.message : 'Unknown error'
            });
            // Continue processing other tickets
          }
        }
      });
    });

    logger.info(`SLA timer job completed for tenant ${tenantId}`);
  } catch (error) {
    logger.error(`SLA timer job failed for tenant ${tenantId}`, {
      tenantId,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    throw error;
  }
}

interface TicketSlaData {
  ticket_id: string;
  ticket_number: string;
  sla_policy_id: string;
  sla_started_at: Date;
  sla_response_due_at: Date | null;
  sla_response_at: Date | null;
  sla_response_met: boolean | null;
  sla_resolution_due_at: Date | null;
  sla_resolution_at: Date | null;
  sla_resolution_met: boolean | null;
  sla_paused_at: Date | null;
  sla_total_pause_minutes: number;
  // Metadata field to track last notified threshold
  // This is stored in the ticket's attributes JSONB field
  sla_last_response_threshold_notified?: number;
  sla_last_resolution_threshold_notified?: number;
}

/**
 * Get all tickets that need SLA checking.
 *
 * A ticket needs checking if:
 * - It has an SLA policy assigned
 * - It's not resolved (sla_resolution_at is null)
 * - It's not currently paused (sla_paused_at is null)
 */
async function getTicketsNeedingSlaCheck(
  trx: Knex.Transaction,
  tenant: string
): Promise<TicketSlaData[]> {
  const tickets = await trx('tickets')
    .where({ tenant })
    .whereNotNull('sla_policy_id')
    .whereNull('sla_resolution_at') // Not yet resolved
    .whereNull('sla_paused_at') // Not currently paused
    .select(
      'ticket_id',
      'ticket_number',
      'sla_policy_id',
      'sla_started_at',
      'sla_response_due_at',
      'sla_response_at',
      'sla_response_met',
      'sla_resolution_due_at',
      'sla_resolution_at',
      'sla_resolution_met',
      'sla_paused_at',
      'sla_total_pause_minutes',
      'attributes'
    );

  // Extract the last notified thresholds from attributes
  return tickets.map((ticket) => ({
    ...ticket,
    sla_last_response_threshold_notified:
      ticket.attributes?.sla_last_response_threshold_notified || 0,
    sla_last_resolution_threshold_notified:
      ticket.attributes?.sla_last_resolution_threshold_notified || 0
  }));
}

/**
 * Process SLA for a single ticket.
 *
 * Checks both response and resolution SLAs and sends notifications
 * for any newly crossed thresholds.
 */
async function processTicketSla(
  trx: Knex.Transaction,
  tenant: string,
  ticket: TicketSlaData
): Promise<void> {
  const now = new Date();
  let updatedResponseThreshold = ticket.sla_last_response_threshold_notified || 0;
  let updatedResolutionThreshold = ticket.sla_last_resolution_threshold_notified || 0;
  let needsUpdate = false;

  // Check response SLA if not yet responded
  if (ticket.sla_response_due_at && !ticket.sla_response_at) {
    const elapsedPercent = calculateElapsedPercent(
      ticket.sla_started_at,
      ticket.sla_response_due_at,
      ticket.sla_total_pause_minutes,
      now
    );

    const { notifiedThreshold, result } = await checkAndSendThresholdNotifications(
      trx,
      tenant,
      ticket.ticket_id,
      elapsedPercent,
      'response',
      ticket.sla_last_response_threshold_notified || 0
    );

    if (notifiedThreshold > (ticket.sla_last_response_threshold_notified || 0)) {
      updatedResponseThreshold = notifiedThreshold;
      needsUpdate = true;

      if (result) {
        logger.info(`Sent response SLA notification for ticket ${ticket.ticket_number}`, {
          ticketId: ticket.ticket_id,
          threshold: notifiedThreshold,
          elapsedPercent,
          recipientCount: result.recipientCount
        });
      }
    }

    // Check if response SLA is breached (100%+) and not already marked
    if (elapsedPercent >= 100 && ticket.sla_response_met === null) {
      await trx('tickets')
        .where({ tenant, ticket_id: ticket.ticket_id })
        .update({
          sla_response_met: false,
          sla_response_at: now // Mark as "responded" with breach
        });

      logger.info(`Response SLA breached for ticket ${ticket.ticket_number}`, {
        ticketId: ticket.ticket_id,
        elapsedPercent
      });
    }
  }

  // Check resolution SLA
  if (ticket.sla_resolution_due_at) {
    const elapsedPercent = calculateElapsedPercent(
      ticket.sla_started_at,
      ticket.sla_resolution_due_at,
      ticket.sla_total_pause_minutes,
      now
    );

    const { notifiedThreshold, result } = await checkAndSendThresholdNotifications(
      trx,
      tenant,
      ticket.ticket_id,
      elapsedPercent,
      'resolution',
      ticket.sla_last_resolution_threshold_notified || 0
    );

    if (notifiedThreshold > (ticket.sla_last_resolution_threshold_notified || 0)) {
      updatedResolutionThreshold = notifiedThreshold;
      needsUpdate = true;

      if (result) {
        logger.info(`Sent resolution SLA notification for ticket ${ticket.ticket_number}`, {
          ticketId: ticket.ticket_id,
          threshold: notifiedThreshold,
          elapsedPercent,
          recipientCount: result.recipientCount
        });
      }
    }

    // Check if resolution SLA is breached (100%+) and not already marked
    if (elapsedPercent >= 100 && ticket.sla_resolution_met === null) {
      await trx('tickets')
        .where({ tenant, ticket_id: ticket.ticket_id })
        .update({ sla_resolution_met: false });

      logger.info(`Resolution SLA breached for ticket ${ticket.ticket_number}`, {
        ticketId: ticket.ticket_id,
        elapsedPercent
      });
    }
  }

  // Update the last notified thresholds in attributes
  if (needsUpdate) {
    const currentAttributes = await trx('tickets')
      .where({ tenant, ticket_id: ticket.ticket_id })
      .select('attributes')
      .first()
      .then((t) => t?.attributes || {});

    await trx('tickets')
      .where({ tenant, ticket_id: ticket.ticket_id })
      .update({
        attributes: JSON.stringify({
          ...currentAttributes,
          sla_last_response_threshold_notified: updatedResponseThreshold,
          sla_last_resolution_threshold_notified: updatedResolutionThreshold
        })
      });
  }
}

/**
 * Calculate the elapsed percentage of SLA time.
 *
 * Takes into account pause time to give accurate elapsed percentage.
 */
function calculateElapsedPercent(
  startedAt: Date,
  dueAt: Date,
  pauseMinutes: number,
  currentTime: Date
): number {
  const startMs = new Date(startedAt).getTime();
  const dueMs = new Date(dueAt).getTime();
  const currentMs = currentTime.getTime();
  const pauseMs = pauseMinutes * 60000;

  // Total time allowed (adjusted for pause)
  const totalAllowedMs = dueMs - startMs + pauseMs;

  // Elapsed time
  const elapsedMs = currentMs - startMs;

  if (totalAllowedMs <= 0) {
    return 100; // Avoid division by zero
  }

  return Math.min(200, Math.max(0, (elapsedMs / totalAllowedMs) * 100));
}
