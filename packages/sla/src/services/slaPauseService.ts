/**
 * SLA Pause Service
 *
 * Handles pausing and resuming SLA timers based on:
 * - Ticket status changes (status-based pause)
 * - Response state changes (awaiting client pause)
 *
 * When SLA is paused:
 * - sla_paused_at is set to the pause timestamp
 * - The pause reason is logged to the audit log
 *
 * When SLA is resumed:
 * - sla_paused_at is cleared
 * - sla_total_pause_minutes is incremented by the pause duration
 * - The resume event is logged to the audit log
 *
 * This service is called by:
 * - Ticket update actions (status changes)
 * - Comment creation actions (response state changes)
 * - Event subscribers
 */

import { Knex } from 'knex';
import { SlaPauseReason } from '../types';

/**
 * Result of a pause/resume operation
 */
export interface PauseResult {
  success: boolean;
  was_paused: boolean;
  is_now_paused: boolean;
  pause_duration_minutes?: number;
  error?: string;
}

/**
 * Pause the SLA timer for a ticket.
 *
 * This should be called when:
 * - Ticket status changes to a status configured to pause SLA
 * - Ticket response state changes to 'awaiting_client' (if enabled)
 *
 * If SLA is already paused, this is a no-op.
 *
 * @param trx - Database transaction
 * @param tenant - Tenant ID
 * @param ticketId - Ticket ID
 * @param reason - Why the SLA is being paused
 * @param triggeredBy - User ID who triggered the pause (optional)
 */
export async function pauseSla(
  trx: Knex.Transaction,
  tenant: string,
  ticketId: string,
  reason: SlaPauseReason,
  triggeredBy?: string
): Promise<PauseResult> {
  try {
    // Get current ticket state
    const ticket = await trx('tickets')
      .where({ tenant, ticket_id: ticketId })
      .select('sla_policy_id', 'sla_paused_at', 'status_id')
      .first();

    if (!ticket) {
      return { success: false, was_paused: false, is_now_paused: false, error: 'Ticket not found' };
    }

    // Skip if no SLA tracking
    if (!ticket.sla_policy_id) {
      return { success: true, was_paused: false, is_now_paused: false };
    }

    // Check if already paused
    if (ticket.sla_paused_at) {
      return { success: true, was_paused: true, is_now_paused: true };
    }

    const now = new Date();

    // Pause the SLA
    await trx('tickets')
      .where({ tenant, ticket_id: ticketId })
      .update({
        sla_paused_at: now
      });

    // Log the pause event
    await logPauseEvent(trx, tenant, ticketId, 'paused', reason, {
      paused_at: now.toISOString(),
      status_id: ticket.status_id,
      triggered_by: triggeredBy
    });

    return { success: true, was_paused: false, is_now_paused: true };
  } catch (error) {
    console.error('Error pausing SLA:', error);
    return {
      success: false,
      was_paused: false,
      is_now_paused: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Resume the SLA timer for a ticket.
 *
 * This should be called when:
 * - Ticket status changes from a pause-configured status to a non-pause status
 * - Ticket response state changes from 'awaiting_client' (if that was the pause reason)
 *
 * If SLA is not paused, this is a no-op.
 *
 * @param trx - Database transaction
 * @param tenant - Tenant ID
 * @param ticketId - Ticket ID
 * @param triggeredBy - User ID who triggered the resume (optional)
 */
export async function resumeSla(
  trx: Knex.Transaction,
  tenant: string,
  ticketId: string,
  triggeredBy?: string
): Promise<PauseResult> {
  try {
    // Get current ticket state
    const ticket = await trx('tickets')
      .where({ tenant, ticket_id: ticketId })
      .select('sla_policy_id', 'sla_paused_at', 'sla_total_pause_minutes', 'status_id')
      .first();

    if (!ticket) {
      return { success: false, was_paused: false, is_now_paused: false, error: 'Ticket not found' };
    }

    // Skip if no SLA tracking
    if (!ticket.sla_policy_id) {
      return { success: true, was_paused: false, is_now_paused: false };
    }

    // Check if not paused
    if (!ticket.sla_paused_at) {
      return { success: true, was_paused: false, is_now_paused: false };
    }

    const now = new Date();
    const pausedAt = new Date(ticket.sla_paused_at);
    const pauseDurationMinutes = Math.floor((now.getTime() - pausedAt.getTime()) / 60000);
    const newTotalPauseMinutes = (ticket.sla_total_pause_minutes || 0) + pauseDurationMinutes;

    // Resume the SLA
    await trx('tickets')
      .where({ tenant, ticket_id: ticketId })
      .update({
        sla_paused_at: null,
        sla_total_pause_minutes: newTotalPauseMinutes
      });

    // Log the resume event
    await logPauseEvent(trx, tenant, ticketId, 'resumed', null, {
      resumed_at: now.toISOString(),
      paused_at: pausedAt.toISOString(),
      pause_duration_minutes: pauseDurationMinutes,
      new_total_pause_minutes: newTotalPauseMinutes,
      status_id: ticket.status_id,
      triggered_by: triggeredBy
    });

    return {
      success: true,
      was_paused: true,
      is_now_paused: false,
      pause_duration_minutes: pauseDurationMinutes
    };
  } catch (error) {
    console.error('Error resuming SLA:', error);
    return {
      success: false,
      was_paused: true,
      is_now_paused: true,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Handle a status change and update SLA pause state accordingly.
 *
 * This is the main entry point for status-based pause logic.
 * It checks if the new status is configured to pause SLA and
 * pauses/resumes accordingly.
 *
 * @param trx - Database transaction
 * @param tenant - Tenant ID
 * @param ticketId - Ticket ID
 * @param oldStatusId - Previous status ID
 * @param newStatusId - New status ID
 * @param triggeredBy - User ID who made the change
 */
export async function handleStatusChange(
  trx: Knex.Transaction,
  tenant: string,
  ticketId: string,
  oldStatusId: string | null,
  newStatusId: string,
  triggeredBy?: string
): Promise<PauseResult> {
  try {
    // Check if new status is configured to pause SLA
    const newStatusConfig = await trx('status_sla_pause_config')
      .where({ tenant, status_id: newStatusId })
      .first();

    const newStatusPauses = newStatusConfig?.pauses_sla ?? false;

    // Check current pause state
    const ticket = await trx('tickets')
      .where({ tenant, ticket_id: ticketId })
      .select('sla_paused_at', 'response_state')
      .first();

    if (!ticket) {
      return { success: false, was_paused: false, is_now_paused: false, error: 'Ticket not found' };
    }

    const isPaused = ticket.sla_paused_at !== null;

    // Get SLA settings to check if awaiting_client should also pause
    const slaSettings = await trx('sla_settings')
      .where({ tenant })
      .first();

    const pauseOnAwaitingClient = slaSettings?.pause_on_awaiting_client ?? true;
    const isAwaitingClient = ticket.response_state === 'awaiting_client';

    // Determine if SLA should be paused after this change
    // SLA should be paused if:
    // 1. New status is configured to pause, OR
    // 2. Awaiting client AND pause_on_awaiting_client is enabled
    const shouldBePaused = newStatusPauses || (isAwaitingClient && pauseOnAwaitingClient);

    if (shouldBePaused && !isPaused) {
      // Need to pause
      return pauseSla(trx, tenant, ticketId, 'status_pause', triggeredBy);
    } else if (!shouldBePaused && isPaused) {
      // Need to resume (only if the pause wasn't due to awaiting_client)
      // If awaiting_client is still active and that caused the pause, don't resume
      if (isAwaitingClient && pauseOnAwaitingClient) {
        // Keep paused due to awaiting_client
        return { success: true, was_paused: true, is_now_paused: true };
      }
      return resumeSla(trx, tenant, ticketId, triggeredBy);
    }

    // No change needed
    return { success: true, was_paused: isPaused, is_now_paused: isPaused };
  } catch (error) {
    console.error('Error handling status change for SLA:', error);
    return {
      success: false,
      was_paused: false,
      is_now_paused: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Handle a response state change and update SLA pause state accordingly.
 *
 * This is called when the response_state field changes on a ticket.
 * If pause_on_awaiting_client is enabled, changing to 'awaiting_client'
 * will pause the SLA, and changing away will resume it (unless status
 * also pauses SLA).
 *
 * @param trx - Database transaction
 * @param tenant - Tenant ID
 * @param ticketId - Ticket ID
 * @param oldResponseState - Previous response state
 * @param newResponseState - New response state
 * @param triggeredBy - User ID who made the change
 */
export async function handleResponseStateChange(
  trx: Knex.Transaction,
  tenant: string,
  ticketId: string,
  oldResponseState: string | null,
  newResponseState: string | null,
  triggeredBy?: string
): Promise<PauseResult> {
  try {
    // Get SLA settings
    const slaSettings = await trx('sla_settings')
      .where({ tenant })
      .first();

    const pauseOnAwaitingClient = slaSettings?.pause_on_awaiting_client ?? true;

    // If feature is disabled, no action needed
    if (!pauseOnAwaitingClient) {
      return { success: true, was_paused: false, is_now_paused: false };
    }

    // Get current ticket state
    const ticket = await trx('tickets')
      .where({ tenant, ticket_id: ticketId })
      .select('sla_paused_at', 'status_id')
      .first();

    if (!ticket) {
      return { success: false, was_paused: false, is_now_paused: false, error: 'Ticket not found' };
    }

    const isPaused = ticket.sla_paused_at !== null;
    const wasAwaitingClient = oldResponseState === 'awaiting_client';
    const isNowAwaitingClient = newResponseState === 'awaiting_client';

    // Check if current status also pauses SLA
    const statusConfig = await trx('status_sla_pause_config')
      .where({ tenant, status_id: ticket.status_id })
      .first();

    const statusPauses = statusConfig?.pauses_sla ?? false;

    if (isNowAwaitingClient && !isPaused) {
      // Changing to awaiting_client - should pause
      return pauseSla(trx, tenant, ticketId, 'awaiting_client', triggeredBy);
    } else if (wasAwaitingClient && !isNowAwaitingClient && isPaused) {
      // Changing away from awaiting_client - should resume (unless status also pauses)
      if (statusPauses) {
        // Keep paused due to status
        return { success: true, was_paused: true, is_now_paused: true };
      }
      return resumeSla(trx, tenant, ticketId, triggeredBy);
    }

    // No change needed
    return { success: true, was_paused: isPaused, is_now_paused: isPaused };
  } catch (error) {
    console.error('Error handling response state change for SLA:', error);
    return {
      success: false,
      was_paused: false,
      is_now_paused: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Check if SLA should be paused for a ticket based on all conditions.
 *
 * This is a stateless check that can be used to determine if pause
 * conditions are currently met, regardless of current pause state.
 *
 * @param trx - Database transaction or connection
 * @param tenant - Tenant ID
 * @param ticketId - Ticket ID
 */
export async function shouldSlaBePaused(
  trx: Knex | Knex.Transaction,
  tenant: string,
  ticketId: string
): Promise<{ paused: boolean; reason: SlaPauseReason | null }> {
  // Get the ticket's current state
  const ticket = await trx('tickets')
    .where({ tenant, ticket_id: ticketId })
    .select('status_id', 'response_state')
    .first();

  if (!ticket) {
    return { paused: false, reason: null };
  }

  // Get SLA settings
  let slaSettings = await trx('sla_settings')
    .where({ tenant })
    .first();

  // Use default settings if none exist
  if (!slaSettings) {
    slaSettings = { pause_on_awaiting_client: true };
  }

  // Check 1: Awaiting client response
  if (slaSettings.pause_on_awaiting_client && ticket.response_state === 'awaiting_client') {
    return { paused: true, reason: 'awaiting_client' };
  }

  // Check 2: Status-based pause
  const statusPauseConfig = await trx('status_sla_pause_config')
    .where({ tenant, status_id: ticket.status_id })
    .first();

  if (statusPauseConfig?.pauses_sla) {
    return { paused: true, reason: 'status_pause' };
  }

  return { paused: false, reason: null };
}

/**
 * Synchronize the SLA pause state for a ticket.
 *
 * This rechecks all pause conditions and ensures the ticket's
 * sla_paused_at field matches the expected state. Useful for
 * fixing inconsistencies or initializing pause state.
 *
 * @param trx - Database transaction
 * @param tenant - Tenant ID
 * @param ticketId - Ticket ID
 * @param triggeredBy - User ID (for audit log)
 */
export async function syncPauseState(
  trx: Knex.Transaction,
  tenant: string,
  ticketId: string,
  triggeredBy?: string
): Promise<PauseResult> {
  try {
    const { paused, reason } = await shouldSlaBePaused(trx, tenant, ticketId);

    const ticket = await trx('tickets')
      .where({ tenant, ticket_id: ticketId })
      .select('sla_paused_at')
      .first();

    if (!ticket) {
      return { success: false, was_paused: false, is_now_paused: false, error: 'Ticket not found' };
    }

    const isPaused = ticket.sla_paused_at !== null;

    if (paused && !isPaused) {
      // Should be paused but isn't
      return pauseSla(trx, tenant, ticketId, reason!, triggeredBy);
    } else if (!paused && isPaused) {
      // Should not be paused but is
      return resumeSla(trx, tenant, ticketId, triggeredBy);
    }

    // State is correct
    return { success: true, was_paused: isPaused, is_now_paused: isPaused };
  } catch (error) {
    console.error('Error syncing SLA pause state:', error);
    return {
      success: false,
      was_paused: false,
      is_now_paused: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Get pause statistics for a ticket.
 *
 * Returns information about current and historical pause state.
 *
 * @param trx - Database transaction or connection
 * @param tenant - Tenant ID
 * @param ticketId - Ticket ID
 */
export async function getPauseStats(
  trx: Knex | Knex.Transaction,
  tenant: string,
  ticketId: string
): Promise<{
  is_paused: boolean;
  paused_at: Date | null;
  total_pause_minutes: number;
  current_pause_minutes: number;
  pause_reason: SlaPauseReason | null;
} | null> {
  const ticket = await trx('tickets')
    .where({ tenant, ticket_id: ticketId })
    .select('sla_paused_at', 'sla_total_pause_minutes', 'response_state', 'status_id')
    .first();

  if (!ticket) {
    return null;
  }

  const isPaused = ticket.sla_paused_at !== null;
  let currentPauseMinutes = 0;
  let pauseReason: SlaPauseReason | null = null;

  if (isPaused) {
    const pausedAt = new Date(ticket.sla_paused_at);
    currentPauseMinutes = Math.floor((Date.now() - pausedAt.getTime()) / 60000);

    // Determine reason
    const { reason } = await shouldSlaBePaused(trx, tenant, ticketId);
    pauseReason = reason;
  }

  return {
    is_paused: isPaused,
    paused_at: isPaused ? new Date(ticket.sla_paused_at) : null,
    total_pause_minutes: ticket.sla_total_pause_minutes || 0,
    current_pause_minutes: currentPauseMinutes,
    pause_reason: pauseReason
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Log a pause/resume event to the audit log.
 */
async function logPauseEvent(
  trx: Knex.Transaction,
  tenant: string,
  ticketId: string,
  eventType: 'paused' | 'resumed',
  reason: SlaPauseReason | null,
  eventData: Record<string, unknown>
): Promise<void> {
  await trx('sla_audit_log').insert({
    tenant,
    ticket_id: ticketId,
    event_type: `sla_${eventType}`,
    event_data: JSON.stringify({
      ...eventData,
      reason
    }),
    triggered_by: eventData.triggered_by || null
  });
}
