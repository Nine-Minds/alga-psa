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

import { createTenantKnex, runWithTenant, withTransaction } from '@alga-psa/db';
import { Knex } from 'knex';
import { findCrossedThresholds } from '@alga-psa/sla';
import { calculateElapsedBusinessMinutes } from '@alga-psa/sla/services/businessHoursCalculator';
import type { IBusinessHoursScheduleWithEntries } from '@alga-psa/sla/types';
import { publishWorkflowEvent } from '@alga-psa/event-bus/publishers';
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
  // Target minutes from the SLA policy target
  response_time_minutes: number | null;
  resolution_time_minutes: number | null;
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
  const tickets = await trx('tickets as t')
    .leftJoin('sla_policy_targets as spt', function() {
      this.on('t.sla_policy_id', 'spt.sla_policy_id')
          .andOn('t.tenant', 'spt.tenant')
          .andOn('t.priority_id', 'spt.priority_id');
    })
    .where('t.tenant', tenant)
    .whereNotNull('t.sla_policy_id')
    .whereNull('t.sla_resolution_at') // Not yet resolved
    .whereNull('t.sla_paused_at') // Not currently paused
    .select(
      't.ticket_id',
      't.ticket_number',
      't.sla_policy_id',
      't.sla_started_at',
      't.sla_response_due_at',
      't.sla_response_at',
      't.sla_response_met',
      't.sla_resolution_due_at',
      't.sla_resolution_at',
      't.sla_resolution_met',
      't.sla_paused_at',
      't.sla_total_pause_minutes',
      't.attributes',
      'spt.response_time_minutes',
      'spt.resolution_time_minutes'
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

  // Fetch business hours schedule for elapsed time calculation
  const schedule = await getBusinessHoursSchedule(trx, tenant, ticket.sla_policy_id);

  // Check response SLA if not yet responded
  if (ticket.sla_response_due_at && !ticket.sla_response_at) {
    const elapsedPercent = calculateElapsedPercentBusinessHours(
      ticket.sla_started_at,
      ticket.response_time_minutes,
      ticket.sla_total_pause_minutes,
      now,
      schedule
    );

    const { highestThreshold } = await findCrossedThresholds(
      trx,
      tenant,
      ticket.ticket_id,
      elapsedPercent,
      'response',
      ticket.sla_last_response_threshold_notified || 0
    );

    if (highestThreshold > (ticket.sla_last_response_threshold_notified || 0)) {
      updatedResponseThreshold = highestThreshold;
      needsUpdate = true;

      await publishWorkflowEvent({
        eventType: 'TICKET_SLA_THRESHOLD_REACHED',
        payload: {
          ticketId: ticket.ticket_id,
          phase: 'response',
          thresholdPercent: highestThreshold,
        },
        ctx: {
          tenantId: tenant,
          occurredAt: new Date().toISOString(),
          actor: { actorType: 'SYSTEM' as const },
        },
      });

      logger.info(`Published response SLA threshold event for ticket ${ticket.ticket_number}`, {
        ticketId: ticket.ticket_id,
        threshold: highestThreshold,
        elapsedPercent,
      });
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
    const elapsedPercent = calculateElapsedPercentBusinessHours(
      ticket.sla_started_at,
      ticket.resolution_time_minutes,
      ticket.sla_total_pause_minutes,
      now,
      schedule
    );

    const { highestThreshold: resHighest } = await findCrossedThresholds(
      trx,
      tenant,
      ticket.ticket_id,
      elapsedPercent,
      'resolution',
      ticket.sla_last_resolution_threshold_notified || 0
    );

    if (resHighest > (ticket.sla_last_resolution_threshold_notified || 0)) {
      updatedResolutionThreshold = resHighest;
      needsUpdate = true;

      await publishWorkflowEvent({
        eventType: 'TICKET_SLA_THRESHOLD_REACHED',
        payload: {
          ticketId: ticket.ticket_id,
          phase: 'resolution',
          thresholdPercent: resHighest,
        },
        ctx: {
          tenantId: tenant,
          occurredAt: new Date().toISOString(),
          actor: { actorType: 'SYSTEM' as const },
        },
      });

      logger.info(`Published resolution SLA threshold event for ticket ${ticket.ticket_number}`, {
        ticketId: ticket.ticket_id,
        threshold: resHighest,
        elapsedPercent,
      });
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
 * Fetch the business hours schedule for a ticket's SLA policy.
 */
async function getBusinessHoursSchedule(
  trx: Knex.Transaction,
  tenant: string,
  policyId: string
): Promise<IBusinessHoursScheduleWithEntries | null> {
  const policy = await trx('sla_policies')
    .where({ tenant, sla_policy_id: policyId })
    .select('business_hours_schedule_id', 'is_24x7')
    .first();

  if (!policy || !policy.business_hours_schedule_id) {
    return null;
  }

  const schedule = await trx('business_hours_schedules')
    .where({ tenant, schedule_id: policy.business_hours_schedule_id })
    .first();

  if (!schedule) {
    return null;
  }

  const entries = await trx('business_hours_entries')
    .where({ tenant, schedule_id: schedule.schedule_id })
    .orderBy('day_of_week');

  const holidays = await trx('holidays')
    .where({ tenant, schedule_id: schedule.schedule_id });

  return {
    ...schedule,
    entries,
    holidays,
  };
}

/**
 * Calculate the elapsed percentage of SLA time using business hours.
 *
 * Uses the business hours calculator to count only minutes within
 * the configured schedule, minus pause time.
 */
function calculateElapsedPercentBusinessHours(
  startedAt: Date,
  targetMinutes: number | null,
  pauseMinutes: number,
  currentTime: Date,
  schedule: IBusinessHoursScheduleWithEntries | null
): number {
  if (!targetMinutes || targetMinutes <= 0) {
    return 100;
  }

  // If no schedule available, fall back to wall-clock calculation
  if (!schedule) {
    const startMs = new Date(startedAt).getTime();
    const elapsedMs = currentTime.getTime() - startMs;
    const totalAllowedMs = targetMinutes * 60000;
    if (totalAllowedMs <= 0) return 100;
    return Math.min(200, Math.max(0, (elapsedMs / totalAllowedMs) * 100));
  }

  const { businessMinutes } = calculateElapsedBusinessMinutes(
    schedule,
    new Date(startedAt),
    currentTime
  );

  const effectiveElapsed = Math.max(0, businessMinutes - pauseMinutes);
  return Math.min(200, Math.max(0, (effectiveElapsed / targetMinutes) * 100));
}
