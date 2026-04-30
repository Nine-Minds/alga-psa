import { Context } from '@temporalio/activity';
import { v4 as uuidv4 } from 'uuid';
import { withTenantTransactionRetryReadOnly } from '@alga-psa/db';
import type { Knex } from 'knex';
import type {
  IBusinessHoursScheduleWithEntries,
} from '@alga-psa/sla/types';
import {
  calculateDeadline,
} from '@alga-psa/sla/services/businessHoursCalculator';
import {
  checkEscalationNeeded,
  escalateTicket,
} from '@alga-psa/sla/services/escalationService';
import { getRedisStreamClient } from '@alga-psa/workflow-streams';

const logger = () => Context.current().log;

export async function calculateNextWakeTime(input: {
  currentTime: string;
  targetMinutes: number;
  schedule: IBusinessHoursScheduleWithEntries;
  pauseMinutes: number;
}): Promise<string> {
  const startTime = new Date(input.currentTime);
  const safeTargetMinutes = Math.max(0, input.targetMinutes);
  const deadline = calculateDeadline(
    input.schedule,
    startTime,
    safeTargetMinutes
  );
  const adjustedDeadline = new Date(
    deadline.getTime() + Math.max(0, input.pauseMinutes) * 60000
  );
  return adjustedDeadline.toISOString();
}

export async function sendSlaNotification(input: {
  tenantId: string;
  ticketId: string;
  phase: 'response' | 'resolution';
  thresholdPercent: number;
}): Promise<void> {
  const log = logger();
  const now = new Date().toISOString();
  const eventId = uuidv4();

  const event = {
    id: eventId,
    eventType: 'TICKET_SLA_THRESHOLD_REACHED',
    timestamp: now,
    payload: {
      tenantId: input.tenantId,
      occurredAt: now,
      ticketId: input.ticketId,
      phase: input.phase,
      thresholdPercent: input.thresholdPercent,
    },
  };

  const streamName = getEventStreamName('TICKET_SLA_THRESHOLD_REACHED');

  log.info('Publishing SLA threshold reached event', {
    ticketId: input.ticketId,
    phase: input.phase,
    thresholdPercent: input.thresholdPercent,
    streamName,
  });

  await getRedisStreamClient().publishToStream(streamName, {
    event: JSON.stringify(event),
    channel: 'global',
  });

  log.info('SLA threshold reached event published', {
    ticketId: input.ticketId,
    eventId,
  });
}

function getEventStreamName(eventType: string): string {
  const prefix = process.env.REDIS_PREFIX || 'alga-psa:';
  const streamPrefix = process.env.REDIS_EVENT_STREAM_PREFIX || 'event-stream:';
  return `${prefix}${streamPrefix}global:${eventType}`;
}

export async function checkAndEscalate(input: {
  tenantId: string;
  ticketId: string;
  phase: 'response' | 'resolution';
  thresholdPercent: number;
}): Promise<void> {
  const log = logger();

  await withTenantTransaction(input.tenantId, async (trx) => {
    const escalationLevel = await checkEscalationNeeded(
      trx,
      input.tenantId,
      input.ticketId,
      input.thresholdPercent
    );

    if (!escalationLevel) {
      log.info('No escalation needed', {
        ticketId: input.ticketId,
        thresholdPercent: input.thresholdPercent,
      });
      return;
    }

    log.info('Escalating ticket', {
      ticketId: input.ticketId,
      escalationLevel,
      thresholdPercent: input.thresholdPercent,
    });

    await escalateTicket(trx, input.tenantId, input.ticketId, escalationLevel);
    log.info('SLA escalation completed', {
      ticketId: input.ticketId,
      escalationLevel,
    });
  });
}

export async function updateSlaStatus(input: {
  tenantId: string;
  ticketId: string;
  phase: 'response' | 'resolution';
  breached: boolean;
}): Promise<void> {
  const log = logger();
  log.info('Updating SLA status', {
    ticketId: input.ticketId,
    phase: input.phase,
    breached: input.breached,
  });

  await withTenantTransaction(input.tenantId, async (trx) => {
    if (input.phase === 'response') {
      await trx('tickets')
        .where({ tenant: input.tenantId, ticket_id: input.ticketId })
        .update({
          sla_response_met: input.breached ? false : true,
          sla_response_at: input.breached ? new Date() : null,
        });
      return;
    }

    await trx('tickets')
      .where({ tenant: input.tenantId, ticket_id: input.ticketId })
      .update({
        sla_resolution_met: input.breached ? false : true,
      });
  });
}

export async function recordSlaAuditLog(input: {
  tenantId: string;
  ticketId: string;
  eventType: string;
  eventData: Record<string, unknown>;
}): Promise<void> {
  await withTenantTransaction(input.tenantId, async (trx) => {
    await trx('sla_audit_log').insert({
      tenant: input.tenantId,
      ticket_id: input.ticketId,
      event_type: input.eventType,
      event_data: JSON.stringify(input.eventData),
      triggered_by: null,
    });
  });
}

export interface CompleteIfTicketClosedResult {
  closed: boolean;
  responseMet: boolean | null;
  resolutionMet: boolean | null;
  reason?: 'closed' | 'deleted';
}

/**
 * Self-heal: if the ticket has been closed (or deleted) but the workflow
 * never received a completeResolution/cancel signal, backfill the SLA
 * timestamps where applicable and report back so the workflow can exit
 * gracefully. Returns { closed: false } when the ticket is still open and
 * present.
 */
export async function completeIfTicketClosed(input: {
  tenantId: string;
  ticketId: string;
}): Promise<CompleteIfTicketClosedResult> {
  const log = logger();
  let result: CompleteIfTicketClosedResult = {
    closed: false,
    responseMet: null,
    resolutionMet: null,
  };

  await withTenantTransaction(input.tenantId, async (trx) => {
    const ticket = await trx('tickets')
      .where({ tenant: input.tenantId, ticket_id: input.ticketId })
      .select(
        'closed_at',
        'sla_response_due_at',
        'sla_resolution_due_at',
        'sla_response_at',
        'sla_response_met',
        'sla_resolution_at',
        'sla_resolution_met'
      )
      .first();

    if (!ticket) {
      // Ticket was deleted out from under the workflow — exit cleanly so we
      // don't keep firing breach activities against a row that no longer
      // exists. Don't try to write to sla_audit_log either: the FK to tickets
      // would fail.
      result = {
        closed: true,
        responseMet: null,
        resolutionMet: null,
        reason: 'deleted',
      };
      log.info('SLA workflow self-healed: ticket no longer exists', {
        ticketId: input.ticketId,
      });
      return;
    }

    if (!ticket.closed_at) {
      return;
    }

    const closedAt = new Date(ticket.closed_at);
    const responseDue = ticket.sla_response_due_at
      ? new Date(ticket.sla_response_due_at)
      : null;
    const resolutionDue = ticket.sla_resolution_due_at
      ? new Date(ticket.sla_resolution_due_at)
      : null;

    const responseMet = responseDue ? closedAt <= responseDue : null;
    const resolutionMet = resolutionDue ? closedAt <= resolutionDue : null;

    const updates: Record<string, unknown> = {};
    if (!ticket.sla_response_at) {
      updates.sla_response_at = closedAt;
    }
    if (ticket.sla_response_met === null && responseMet !== null) {
      updates.sla_response_met = responseMet;
    }
    if (!ticket.sla_resolution_at) {
      updates.sla_resolution_at = closedAt;
    }
    if (ticket.sla_resolution_met === null && resolutionMet !== null) {
      updates.sla_resolution_met = resolutionMet;
    }

    if (Object.keys(updates).length > 0) {
      await trx('tickets')
        .where({ tenant: input.tenantId, ticket_id: input.ticketId })
        .update(updates);

      // Only record an audit row when self-heal actually changed something.
      // Avoids duplicate audit noise if this activity runs again (e.g. a
      // restarted workflow with the same workflowId) and finds nothing to do.
      await trx('sla_audit_log').insert({
        tenant: input.tenantId,
        ticket_id: input.ticketId,
        event_type: 'self_healed_on_closed',
        event_data: JSON.stringify({
          closed_at: closedAt.toISOString(),
          response_met: responseMet,
          resolution_met: resolutionMet,
          backfilled_fields: Object.keys(updates),
        }),
        triggered_by: null,
      });

      log.info('SLA workflow self-healed: ticket already closed, backfilled fields', {
        ticketId: input.ticketId,
        closedAt: closedAt.toISOString(),
        backfilledFields: Object.keys(updates),
      });
    } else {
      log.info('SLA workflow self-healed: ticket closed, all SLA fields already set', {
        ticketId: input.ticketId,
        closedAt: closedAt.toISOString(),
      });
    }

    result = {
      closed: true,
      responseMet,
      resolutionMet,
      reason: 'closed',
    };
  });

  return result;
}

async function withTenantTransaction(
  tenantId: string,
  fn: (trx: Knex.Transaction) => Promise<void>
): Promise<void> {
  await withTenantTransactionRetryReadOnly(tenantId, fn);
}
