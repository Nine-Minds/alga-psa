import { Context } from '@temporalio/activity';
import { createTenantKnex, withTransaction } from '@alga-psa/db';
import type { Knex } from 'knex';
import type {
  IBusinessHoursScheduleWithEntries,
  SlaNotificationContext,
} from '@alga-psa/sla/types';
import {
  calculateDeadline,
} from '@alga-psa/sla/services/businessHoursCalculator';
import {
  sendSlaNotification as sendSlaNotificationService,
} from '@alga-psa/sla/services/slaNotificationService';
import {
  checkEscalationNeeded,
  escalateTicket,
} from '@alga-psa/sla/services/escalationService';

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

  await withTenantTransaction(input.tenantId, async (trx) => {
    const ticket = await trx('tickets as t')
      .leftJoin('clients as c', function() {
        this.on('t.client_id', 'c.client_id').andOn('t.tenant', 'c.tenant');
      })
      .leftJoin('priorities as p', function() {
        this.on('t.priority_id', 'p.priority_id').andOn('t.tenant', 'p.tenant');
      })
      .where('t.tenant', input.tenantId)
      .where('t.ticket_id', input.ticketId)
      .select(
        't.ticket_id',
        't.ticket_number',
        't.title',
        't.assigned_to',
        't.board_id',
        't.sla_policy_id',
        't.sla_response_due_at',
        't.sla_resolution_due_at',
        'c.client_name as client_name',
        'p.priority_name'
      )
      .first();

    if (!ticket || !ticket.sla_policy_id) {
      log.warn('SLA notification skipped; ticket or policy missing', {
        ticketId: input.ticketId,
      });
      return;
    }

    const dueAt =
      input.phase === 'response'
        ? new Date(ticket.sla_response_due_at)
        : new Date(ticket.sla_resolution_due_at);

    const remainingMinutes = Math.floor(
      (dueAt.getTime() - Date.now()) / 60000
    );

    const context: SlaNotificationContext = {
      tenant: input.tenantId,
      ticketId: ticket.ticket_id,
      ticketNumber: ticket.ticket_number,
      ticketTitle: ticket.title,
      clientName: ticket.client_name,
      priorityName: ticket.priority_name,
      assigneeId: ticket.assigned_to,
      boardId: ticket.board_id,
      slaPolicyId: ticket.sla_policy_id,
      thresholdPercent: input.thresholdPercent,
      slaType: input.phase,
      remainingMinutes,
      dueAt,
    };

    await sendSlaNotificationService(trx, context);
  });
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
      return;
    }

    await escalateTicket(trx, input.tenantId, input.ticketId, escalationLevel);
    log.info('SLA escalation triggered', {
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
