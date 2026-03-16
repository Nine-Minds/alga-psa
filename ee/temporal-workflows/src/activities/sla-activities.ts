import { Context } from '@temporalio/activity';
import { v4 as uuidv4 } from 'uuid';
import { createTenantKnex, withTransaction } from '@alga-psa/db';
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

async function withTenantTransaction(
  tenantId: string,
  fn: (trx: Knex.Transaction) => Promise<void>
): Promise<void> {
  const { knex } = await createTenantKnex(tenantId);
  await withTransaction(knex, fn);
}
