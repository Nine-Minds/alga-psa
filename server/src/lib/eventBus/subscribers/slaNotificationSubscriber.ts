/**
 * SLA Notification Subscriber
 *
 * Handles TICKET_SLA_THRESHOLD_REACHED events published by the Temporal SLA workflow.
 * Fetches ticket details and calls the SLA notification service to send
 * in-app and email notifications to the appropriate recipients.
 */

import logger from '@alga-psa/core/logger';
import { getEventBus } from '../index';
import { EventSchemas } from '@alga-psa/event-schemas';
import { createTenantKnex, runWithTenant, withTransaction } from '@alga-psa/db';
import {
  sendSlaNotification,
  type SlaNotificationContext,
} from '@alga-psa/sla/services/slaNotificationService';
import type { Knex } from 'knex';

let isRegistered = false;

export async function registerSlaNotificationSubscriber(): Promise<void> {
  if (isRegistered) {
    return;
  }

  await getEventBus().subscribe('TICKET_SLA_THRESHOLD_REACHED', handleSlaThresholdReachedEvent);

  isRegistered = true;
  logger.info('[SlaNotificationSubscriber] Registered');
}

export async function unregisterSlaNotificationSubscriber(): Promise<void> {
  if (!isRegistered) {
    return;
  }

  await getEventBus().unsubscribe('TICKET_SLA_THRESHOLD_REACHED', handleSlaThresholdReachedEvent);

  isRegistered = false;
  logger.info('[SlaNotificationSubscriber] Unregistered');
}

async function handleSlaThresholdReachedEvent(event: unknown): Promise<void> {
  try {
    const validated = EventSchemas.TICKET_SLA_THRESHOLD_REACHED.parse(event);
    const { tenantId, ticketId, phase, thresholdPercent } = validated.payload;

    logger.info('[SlaNotificationSubscriber] Handling TICKET_SLA_THRESHOLD_REACHED', {
      tenantId,
      ticketId,
      phase,
      thresholdPercent,
    });

    await runWithTenant(tenantId, async () => {
      const { knex } = await createTenantKnex();

      await withTransaction(knex, async (trx: Knex.Transaction) => {
        const ticket = await trx('tickets as t')
          .leftJoin('clients as c', function () {
            this.on('t.client_id', 'c.client_id').andOn('t.tenant', 'c.tenant');
          })
          .leftJoin('priorities as p', function () {
            this.on('t.priority_id', 'p.priority_id').andOn('t.tenant', 'p.tenant');
          })
          .where('t.tenant', tenantId)
          .where('t.ticket_id', ticketId)
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
          logger.warn('[SlaNotificationSubscriber] Ticket or SLA policy missing, skipping', {
            ticketId,
          });
          return;
        }

        const dueAt =
          phase === 'response'
            ? new Date(ticket.sla_response_due_at)
            : new Date(ticket.sla_resolution_due_at);

        const remainingMinutes = Math.floor(
          (dueAt.getTime() - Date.now()) / 60000
        );

        const context: SlaNotificationContext = {
          tenant: tenantId,
          ticketId: ticket.ticket_id,
          ticketNumber: ticket.ticket_number,
          ticketTitle: ticket.title,
          clientName: ticket.client_name,
          priorityName: ticket.priority_name,
          assigneeId: ticket.assigned_to,
          boardId: ticket.board_id,
          slaPolicyId: ticket.sla_policy_id,
          thresholdPercent,
          slaType: phase,
          remainingMinutes,
          dueAt,
        };

        const result = await sendSlaNotification(trx, context);

        logger.info('[SlaNotificationSubscriber] Notification result', {
          ticketId,
          thresholdPercent,
          recipientCount: result.recipientCount,
          inAppSent: result.inAppSent,
          emailSent: result.emailSent,
          errors: result.errors.length > 0 ? result.errors : undefined,
        });
      });
    });
  } catch (error) {
    logger.error('[SlaNotificationSubscriber] Failed to handle event', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
