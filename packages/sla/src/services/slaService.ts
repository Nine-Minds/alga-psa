/**
 * SLA Service
 *
 * Main service for SLA lifecycle management. Handles:
 * - Starting SLA timers when tickets are created
 * - Recording first response times
 * - Recording resolution times
 * - Calculating SLA status
 * - Updating SLA tracking fields on tickets
 *
 * This service is used by:
 * - Ticket creation actions (to start SLA)
 * - Comment creation actions (to record first response)
 * - Ticket close actions (to record resolution)
 * - SLA timer job (to check for breaches)
 */

import { Knex } from 'knex';
import {
  ISlaPolicy,
  ISlaPolicyTarget,
  ISlaPolicyWithTargets,
  ISlaStatus,
  SlaTimerStatus,
  IBusinessHoursScheduleWithEntries
} from '../types';
import {
  calculateDeadline,
  getRemainingBusinessMinutes,
  isWithinBusinessHours,
  formatRemainingTime
} from './businessHoursCalculator';

/**
 * Result of starting SLA tracking for a ticket
 */
export interface StartSlaResult {
  success: boolean;
  sla_policy_id: string | null;
  sla_started_at: Date | null;
  sla_response_due_at: Date | null;
  sla_resolution_due_at: Date | null;
  error?: string;
}

/**
 * Result of recording a response or resolution
 */
export interface RecordSlaEventResult {
  success: boolean;
  met: boolean | null;
  recorded_at: Date;
  error?: string;
}

/**
 * Start SLA tracking for a ticket.
 *
 * This should be called when a ticket is created. It:
 * 1. Resolves the SLA policy (client > board > default)
 * 2. Gets the target times for the ticket's priority
 * 3. Calculates due dates based on business hours
 * 4. Updates the ticket with SLA tracking fields
 *
 * @param trx - Database transaction
 * @param tenant - Tenant ID
 * @param ticketId - Ticket ID
 * @param clientId - Client ID (for policy resolution)
 * @param boardId - Board ID (for policy resolution)
 * @param priorityId - Priority ID (for target lookup)
 * @param createdAt - When the ticket was created (SLA start time)
 */
export async function startSlaForTicket(
  trx: Knex.Transaction,
  tenant: string,
  ticketId: string,
  clientId: string | null,
  boardId: string | null,
  priorityId: string | null,
  createdAt: Date = new Date()
): Promise<StartSlaResult> {
  try {
    // 1. Resolve the SLA policy for this ticket
    const policy = await resolveSlaPolicy(trx, tenant, clientId, boardId);

    if (!policy) {
      // No SLA policy applies - that's okay, not all tickets need SLA
      return {
        success: true,
        sla_policy_id: null,
        sla_started_at: null,
        sla_response_due_at: null,
        sla_resolution_due_at: null
      };
    }

    // 2. Get the target for this priority
    const target = policy.targets.find(t => t.priority_id === priorityId);

    if (!target) {
      // No target for this priority - apply policy but no due dates
      await trx('tickets')
        .where({ tenant, ticket_id: ticketId })
        .update({
          sla_policy_id: policy.sla_policy_id,
          sla_started_at: createdAt
        });

      return {
        success: true,
        sla_policy_id: policy.sla_policy_id,
        sla_started_at: createdAt,
        sla_response_due_at: null,
        sla_resolution_due_at: null
      };
    }

    // 3. Get business hours schedule
    const schedule = await getBusinessHoursSchedule(trx, tenant, policy, target);

    // 4. Calculate due dates
    let responseDueAt: Date | null = null;
    let resolutionDueAt: Date | null = null;

    if (target.response_time_minutes) {
      responseDueAt = calculateDeadline(schedule, createdAt, target.response_time_minutes);
    }

    if (target.resolution_time_minutes) {
      resolutionDueAt = calculateDeadline(schedule, createdAt, target.resolution_time_minutes);
    }

    // 5. Update ticket with SLA tracking fields
    await trx('tickets')
      .where({ tenant, ticket_id: ticketId })
      .update({
        sla_policy_id: policy.sla_policy_id,
        sla_started_at: createdAt,
        sla_response_due_at: responseDueAt,
        sla_resolution_due_at: resolutionDueAt
      });

    // 6. Log SLA started event
    await logSlaEvent(trx, tenant, ticketId, 'sla_started', {
      policy_id: policy.sla_policy_id,
      policy_name: policy.policy_name,
      priority_id: priorityId,
      response_target_minutes: target.response_time_minutes,
      resolution_target_minutes: target.resolution_time_minutes,
      response_due_at: responseDueAt?.toISOString(),
      resolution_due_at: resolutionDueAt?.toISOString()
    });

    return {
      success: true,
      sla_policy_id: policy.sla_policy_id,
      sla_started_at: createdAt,
      sla_response_due_at: responseDueAt,
      sla_resolution_due_at: resolutionDueAt
    };
  } catch (error) {
    console.error('Error starting SLA for ticket:', error);
    return {
      success: false,
      sla_policy_id: null,
      sla_started_at: null,
      sla_response_due_at: null,
      sla_resolution_due_at: null,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Record the first response time for a ticket.
 *
 * This should be called when an internal user posts the first public comment.
 * It marks whether the response SLA was met.
 *
 * @param trx - Database transaction
 * @param tenant - Tenant ID
 * @param ticketId - Ticket ID
 * @param respondedAt - When the response was made
 * @param respondedBy - User ID of responder
 */
export async function recordFirstResponse(
  trx: Knex.Transaction,
  tenant: string,
  ticketId: string,
  respondedAt: Date = new Date(),
  respondedBy?: string
): Promise<RecordSlaEventResult> {
  try {
    // Get current ticket SLA state
    const ticket = await trx('tickets')
      .where({ tenant, ticket_id: ticketId })
      .select(
        'sla_policy_id',
        'sla_response_at',
        'sla_response_due_at',
        'sla_total_pause_minutes'
      )
      .first();

    if (!ticket) {
      return { success: false, met: null, recorded_at: respondedAt, error: 'Ticket not found' };
    }

    // Skip if no SLA or already responded
    if (!ticket.sla_policy_id || ticket.sla_response_at) {
      return { success: true, met: null, recorded_at: respondedAt };
    }

    // Calculate if SLA was met
    let met: boolean | null = null;
    if (ticket.sla_response_due_at) {
      // Account for pause time by adjusting the due date
      const adjustedDueAt = new Date(
        new Date(ticket.sla_response_due_at).getTime() +
        (ticket.sla_total_pause_minutes || 0) * 60000
      );
      met = respondedAt <= adjustedDueAt;
    }

    // Update ticket
    await trx('tickets')
      .where({ tenant, ticket_id: ticketId })
      .update({
        sla_response_at: respondedAt,
        sla_response_met: met
      });

    // Log event
    await logSlaEvent(trx, tenant, ticketId, 'response_recorded', {
      responded_at: respondedAt.toISOString(),
      responded_by: respondedBy,
      due_at: ticket.sla_response_due_at,
      pause_minutes: ticket.sla_total_pause_minutes,
      met
    });

    return { success: true, met, recorded_at: respondedAt };
  } catch (error) {
    console.error('Error recording first response:', error);
    return {
      success: false,
      met: null,
      recorded_at: respondedAt,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Record the resolution time for a ticket.
 *
 * This should be called when a ticket is closed/resolved.
 * It marks whether the resolution SLA was met.
 *
 * @param trx - Database transaction
 * @param tenant - Tenant ID
 * @param ticketId - Ticket ID
 * @param resolvedAt - When the ticket was resolved
 * @param resolvedBy - User ID of resolver
 */
export async function recordResolution(
  trx: Knex.Transaction,
  tenant: string,
  ticketId: string,
  resolvedAt: Date = new Date(),
  resolvedBy?: string
): Promise<RecordSlaEventResult> {
  try {
    // Get current ticket SLA state
    const ticket = await trx('tickets')
      .where({ tenant, ticket_id: ticketId })
      .select(
        'sla_policy_id',
        'sla_resolution_at',
        'sla_resolution_due_at',
        'sla_total_pause_minutes'
      )
      .first();

    if (!ticket) {
      return { success: false, met: null, recorded_at: resolvedAt, error: 'Ticket not found' };
    }

    // Skip if no SLA
    if (!ticket.sla_policy_id) {
      return { success: true, met: null, recorded_at: resolvedAt };
    }

    // Calculate if SLA was met
    let met: boolean | null = null;
    if (ticket.sla_resolution_due_at) {
      // Account for pause time by adjusting the due date
      const adjustedDueAt = new Date(
        new Date(ticket.sla_resolution_due_at).getTime() +
        (ticket.sla_total_pause_minutes || 0) * 60000
      );
      met = resolvedAt <= adjustedDueAt;
    }

    // Update ticket
    await trx('tickets')
      .where({ tenant, ticket_id: ticketId })
      .update({
        sla_resolution_at: resolvedAt,
        sla_resolution_met: met
      });

    // Log event
    await logSlaEvent(trx, tenant, ticketId, 'resolution_recorded', {
      resolved_at: resolvedAt.toISOString(),
      resolved_by: resolvedBy,
      due_at: ticket.sla_resolution_due_at,
      pause_minutes: ticket.sla_total_pause_minutes,
      met
    });

    return { success: true, met, recorded_at: resolvedAt };
  } catch (error) {
    console.error('Error recording resolution:', error);
    return {
      success: false,
      met: null,
      recorded_at: resolvedAt,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Get the current SLA status for a ticket.
 *
 * This calculates real-time remaining time and status.
 *
 * @param trx - Database transaction or connection
 * @param tenant - Tenant ID
 * @param ticketId - Ticket ID
 */
export async function getSlaStatus(
  trx: Knex | Knex.Transaction,
  tenant: string,
  ticketId: string
): Promise<ISlaStatus | null> {
  // Get ticket SLA data
  const ticket = await trx('tickets')
    .where({ tenant, ticket_id: ticketId })
    .select(
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
      'priority_id'
    )
    .first();

  if (!ticket || !ticket.sla_policy_id) {
    return null;
  }

  const now = new Date();
  const isPaused = ticket.sla_paused_at !== null;
  const totalPauseMinutes = ticket.sla_total_pause_minutes || 0;

  // Calculate current pause time if currently paused
  let currentPauseMinutes = 0;
  if (isPaused && ticket.sla_paused_at) {
    currentPauseMinutes = Math.floor(
      (now.getTime() - new Date(ticket.sla_paused_at).getTime()) / 60000
    );
  }

  const effectivePauseMinutes = totalPauseMinutes + currentPauseMinutes;

  // Calculate remaining times
  let responseRemaining: number | undefined;
  let resolutionRemaining: number | undefined;

  if (ticket.sla_response_due_at && !ticket.sla_response_at) {
    // Response not yet made
    const adjustedDue = new Date(
      new Date(ticket.sla_response_due_at).getTime() + effectivePauseMinutes * 60000
    );
    responseRemaining = Math.floor((adjustedDue.getTime() - now.getTime()) / 60000);
  }

  if (ticket.sla_resolution_due_at && !ticket.sla_resolution_at) {
    // Not yet resolved
    const adjustedDue = new Date(
      new Date(ticket.sla_resolution_due_at).getTime() + effectivePauseMinutes * 60000
    );
    resolutionRemaining = Math.floor((adjustedDue.getTime() - now.getTime()) / 60000);
  }

  // Determine status
  let status: SlaTimerStatus = 'on_track';

  if (isPaused) {
    status = 'paused';
  } else if (ticket.sla_response_met === false || (responseRemaining !== undefined && responseRemaining < 0)) {
    status = 'response_breached';
  } else if (ticket.sla_resolution_met === false || (resolutionRemaining !== undefined && resolutionRemaining < 0)) {
    status = 'resolution_breached';
  } else {
    // Check if at risk (within 25% of deadline)
    const atRiskThreshold = 0.25;
    if (responseRemaining !== undefined && ticket.sla_response_due_at) {
      const totalResponseMinutes = Math.floor(
        (new Date(ticket.sla_response_due_at).getTime() - new Date(ticket.sla_started_at).getTime()) / 60000
      );
      if (responseRemaining <= totalResponseMinutes * atRiskThreshold) {
        status = 'at_risk';
      }
    }
    if (resolutionRemaining !== undefined && ticket.sla_resolution_due_at) {
      const totalResolutionMinutes = Math.floor(
        (new Date(ticket.sla_resolution_due_at).getTime() - new Date(ticket.sla_started_at).getTime()) / 60000
      );
      if (resolutionRemaining <= totalResolutionMinutes * atRiskThreshold) {
        status = 'at_risk';
      }
    }
  }

  return {
    status,
    response_remaining_minutes: responseRemaining,
    resolution_remaining_minutes: resolutionRemaining,
    is_paused: isPaused,
    pause_reason: isPaused ? 'status_pause' : undefined, // TODO: Get actual reason
    total_pause_minutes: effectivePauseMinutes
  };
}

/**
 * Update SLA when ticket priority changes.
 *
 * When priority changes, we recalculate due dates based on elapsed time.
 * The elapsed business time carries over, but targets change.
 *
 * @param trx - Database transaction
 * @param tenant - Tenant ID
 * @param ticketId - Ticket ID
 * @param newPriorityId - New priority ID
 * @param changedBy - User who made the change
 */
export async function handlePriorityChange(
  trx: Knex.Transaction,
  tenant: string,
  ticketId: string,
  newPriorityId: string,
  changedBy?: string
): Promise<void> {
  // Get current ticket state
  const ticket = await trx('tickets')
    .where({ tenant, ticket_id: ticketId })
    .select(
      'sla_policy_id',
      'sla_started_at',
      'sla_response_at',
      'sla_resolution_at',
      'sla_total_pause_minutes',
      'client_id',
      'board_id',
      'priority_id'
    )
    .first();

  if (!ticket || !ticket.sla_policy_id || !ticket.sla_started_at) {
    return;
  }

  const oldPriorityId = ticket.priority_id;

  // Get the policy with targets
  const policy = await getSlaPolicyWithTargets(trx, tenant, ticket.sla_policy_id);
  if (!policy) return;

  // Get new target
  const newTarget = policy.targets.find(t => t.priority_id === newPriorityId);
  if (!newTarget) return;

  // Get business hours schedule
  const schedule = await getBusinessHoursSchedule(trx, tenant, policy, newTarget);

  // Recalculate due dates from original start time
  const startedAt = new Date(ticket.sla_started_at);
  let newResponseDue: Date | null = null;
  let newResolutionDue: Date | null = null;

  if (newTarget.response_time_minutes && !ticket.sla_response_at) {
    newResponseDue = calculateDeadline(schedule, startedAt, newTarget.response_time_minutes);
  }

  if (newTarget.resolution_time_minutes && !ticket.sla_resolution_at) {
    newResolutionDue = calculateDeadline(schedule, startedAt, newTarget.resolution_time_minutes);
  }

  // Update ticket
  await trx('tickets')
    .where({ tenant, ticket_id: ticketId })
    .update({
      sla_response_due_at: ticket.sla_response_at ? undefined : newResponseDue,
      sla_resolution_due_at: ticket.sla_resolution_at ? undefined : newResolutionDue
    });

  // Log event
  await logSlaEvent(trx, tenant, ticketId, 'priority_changed', {
    old_priority_id: oldPriorityId,
    new_priority_id: newPriorityId,
    new_response_due_at: newResponseDue?.toISOString(),
    new_resolution_due_at: newResolutionDue?.toISOString(),
    changed_by: changedBy
  });
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Resolve which SLA policy applies to a ticket.
 * Priority: Client > Board > Tenant Default
 */
async function resolveSlaPolicy(
  trx: Knex.Transaction,
  tenant: string,
  clientId: string | null,
  boardId: string | null
): Promise<ISlaPolicyWithTargets | null> {
  // 1. Check client-specific policy
  if (clientId) {
    const client = await trx('clients')
      .where({ tenant, client_id: clientId })
      .select('sla_policy_id')
      .first();

    if (client?.sla_policy_id) {
      const policy = await getSlaPolicyWithTargets(trx, tenant, client.sla_policy_id);
      if (policy) return policy;
    }
  }

  // 2. Check board-specific policy
  if (boardId) {
    const board = await trx('boards')
      .where({ tenant, board_id: boardId })
      .select('sla_policy_id')
      .first();

    if (board?.sla_policy_id) {
      const policy = await getSlaPolicyWithTargets(trx, tenant, board.sla_policy_id);
      if (policy) return policy;
    }
  }

  // 3. Fall back to tenant default
  const defaultPolicy = await trx('sla_policies')
    .where({ tenant, is_default: true })
    .first();

  if (defaultPolicy) {
    return getSlaPolicyWithTargets(trx, tenant, defaultPolicy.sla_policy_id);
  }

  return null;
}

/**
 * Get an SLA policy with its targets.
 */
async function getSlaPolicyWithTargets(
  trx: Knex | Knex.Transaction,
  tenant: string,
  policyId: string
): Promise<ISlaPolicyWithTargets | null> {
  const policy = await trx('sla_policies')
    .where({ tenant, sla_policy_id: policyId })
    .first();

  if (!policy) return null;

  const targets = await trx('sla_policy_targets')
    .where({ tenant, sla_policy_id: policyId });

  return {
    ...policy,
    targets
  };
}

/**
 * Get the business hours schedule for an SLA policy/target.
 */
async function getBusinessHoursSchedule(
  trx: Knex | Knex.Transaction,
  tenant: string,
  policy: ISlaPolicy,
  target: ISlaPolicyTarget
): Promise<IBusinessHoursScheduleWithEntries> {
  // If target is 24x7, return a 24x7 schedule
  if (target.is_24x7) {
    return {
      schedule_id: '24x7',
      schedule_name: '24x7',
      timezone: 'UTC',
      is_default: false,
      is_24x7: true,
      entries: [],
      holidays: []
    };
  }

  // Get schedule from policy
  if (policy.business_hours_schedule_id) {
    const schedule = await trx('business_hours_schedules')
      .where({ tenant, schedule_id: policy.business_hours_schedule_id })
      .first();

    if (schedule) {
      const entries = await trx('business_hours_entries')
        .where({ tenant, schedule_id: schedule.schedule_id });

      const holidays = await trx('holidays')
        .where({ tenant })
        .where(function() {
          this.whereNull('schedule_id')
            .orWhere('schedule_id', schedule.schedule_id);
        });

      return {
        ...schedule,
        entries,
        holidays
      };
    }
  }

  // Fall back to default schedule
  const defaultSchedule = await trx('business_hours_schedules')
    .where({ tenant, is_default: true })
    .first();

  if (defaultSchedule) {
    const entries = await trx('business_hours_entries')
      .where({ tenant, schedule_id: defaultSchedule.schedule_id });

    const holidays = await trx('holidays')
      .where({ tenant })
      .where(function() {
        this.whereNull('schedule_id')
          .orWhere('schedule_id', defaultSchedule.schedule_id);
      });

    return {
      ...defaultSchedule,
      entries,
      holidays
    };
  }

  // Ultimate fallback: 24x7
  return {
    schedule_id: '24x7-fallback',
    schedule_name: '24x7 (Fallback)',
    timezone: 'UTC',
    is_default: false,
    is_24x7: true,
    entries: [],
    holidays: []
  };
}

/**
 * Log an SLA event to the audit log.
 */
async function logSlaEvent(
  trx: Knex.Transaction,
  tenant: string,
  ticketId: string,
  eventType: string,
  eventData: Record<string, unknown>,
  triggeredBy?: string
): Promise<void> {
  await trx('sla_audit_log').insert({
    tenant,
    ticket_id: ticketId,
    event_type: eventType,
    event_data: JSON.stringify(eventData),
    triggered_by: triggeredBy || null
  });
}
