import logger from '@alga-psa/shared/core/logger';

import { getEventBus } from '../index';
import { EventSchemas, type TicketClosedEvent } from '../events';
import { getSurveyTriggersForTenant, type SurveyTrigger } from '../../actions/surveyActions';
import { createTenantKnex, runWithTenant } from '../../db';
import { sendSurveyInvitation } from '../../../services/surveyService';

type TicketSnapshot = {
  ticket_id: string;
  board_id: string | null;
  status_id: string | null;
  priority_id: string | null;
  client_id: string | null;
  contact_name_id: string | null;
};

let isRegistered = false;

export async function registerSurveySubscriber(): Promise<void> {
  if (isRegistered) {
    return;
  }

  await getEventBus().subscribe('TICKET_CLOSED', handleTicketClosedEvent);
  isRegistered = true;
  logger.info('[SurveySubscriber] Registered survey ticket closed handler');
}

export async function unregisterSurveySubscriber(): Promise<void> {
  if (!isRegistered) {
    return;
  }

  await getEventBus().unsubscribe('TICKET_CLOSED', handleTicketClosedEvent);
  isRegistered = false;
  logger.info('[SurveySubscriber] Unregistered survey ticket closed handler');
}

async function handleTicketClosedEvent(event: unknown): Promise<void> {
  try {
    const validated = EventSchemas.TICKET_CLOSED.parse(event) as TicketClosedEvent;
    const { tenantId, ticketId } = validated.payload;

    const triggers = await getSurveyTriggersForTenant(tenantId);
    if (triggers.length === 0) {
      return;
    }

    const ticket = await loadTicketSnapshot(tenantId, ticketId);
    if (!ticket) {
      logger.warn('[SurveySubscriber] Ticket not found for closed event', { tenantId, ticketId });
      return;
    }

    const matchingTemplates = collectMatchingTemplates(triggers, ticket);
    if (matchingTemplates.size === 0) {
      return;
    }

    for (const templateId of matchingTemplates) {
      try {
        await sendSurveyInvitation({
          tenantId,
          ticketId,
          templateId,
          clientId: ticket.client_id,
          contactId: ticket.contact_name_id,
        });
      } catch (error) {
        logger.error('[SurveySubscriber] Failed to send survey invitation', {
          tenantId,
          ticketId,
          templateId,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  } catch (error) {
    logger.error('[SurveySubscriber] Failed to process ticket closed event', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

function collectMatchingTemplates(triggers: SurveyTrigger[], ticket: TicketSnapshot): Set<string> {
  const templateIds = new Set<string>();

  for (const trigger of triggers) {
    if (!trigger.enabled || trigger.triggerType !== 'ticket_closed') {
      continue;
    }

    if (!matchesConditions(trigger.triggerConditions, ticket)) {
      continue;
    }

    templateIds.add(trigger.templateId);
  }

  return templateIds;
}

function matchesConditions(
  conditions: SurveyTrigger['triggerConditions'],
  ticket: TicketSnapshot
): boolean {
  if (!conditions || Object.keys(conditions).length === 0) {
    return true;
  }

  if (conditions.board_id?.length) {
    if (!ticket.board_id || !conditions.board_id.includes(ticket.board_id)) {
      return false;
    }
  }

  if (conditions.status_id?.length) {
    if (!ticket.status_id || !conditions.status_id.includes(ticket.status_id)) {
      return false;
    }
  }

  if (conditions.priority?.length) {
    if (!ticket.priority_id || !conditions.priority.includes(ticket.priority_id)) {
      return false;
    }
  }

  return true;
}

async function loadTicketSnapshot(tenantId: string, ticketId: string): Promise<TicketSnapshot | null> {
  return runWithTenant(tenantId, async () => {
    const { knex } = await createTenantKnex();
    return knex<TicketSnapshot>('tickets')
      .select('ticket_id', 'board_id', 'status_id', 'priority_id', 'client_id', 'contact_name_id')
      .where({ tenant: tenantId, ticket_id: ticketId })
      .first();
  });
}
