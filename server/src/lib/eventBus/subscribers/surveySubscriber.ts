import logger from '@alga-psa/core/logger';

import { getEventBus } from '../index';
import { EventSchemas, type TicketClosedEvent, type ProjectClosedEvent } from '@alga-psa/event-schemas';
import { tenantDb } from '@alga-psa/db';
import { getSurveyTriggersForTenant, type SurveyTrigger } from '@alga-psa/surveys/actions/surveyActions';
import { createTenantKnex, runWithTenant } from '../../db';
import { sendSurveyInvitation } from '../../../services/surveyService';
import {
  INBOUND_OUTBOX_EVENT_TYPES,
  withInboundOutboxDelivery,
  newInboundDeliveryOwner,
} from '@alga-psa/shared/services/email/inboundEmailConsumerDedupe';

/** Stable ledger consumer id for the survey subscriber. */
const INBOUND_OUTBOX_SURVEY_CONSUMER = 'survey';

/**
 * Run a survey effect under the inbound-outbox delivery contract. Sending a
 * survey invitation is an external (email) effect, so this is at-least-once
 * with a bounded duplicate window (fenced reservation -> send -> completion).
 * Non-outbox events pass through untouched; a ledger outage fails open.
 */
async function withSurveyInboundOutboxEffect(
  event: { id: string; eventType: string; payload: Record<string, unknown> },
  effect: () => Promise<void>
): Promise<void> {
  const tenantId = event.payload.tenantId;
  if (typeof tenantId !== 'string' || !tenantId || !INBOUND_OUTBOX_EVENT_TYPES.has(event.eventType)) {
    await effect();
    return;
  }
  let knex: Awaited<ReturnType<typeof createTenantKnex>>['knex'];
  try {
    ({ knex } = await createTenantKnex(tenantId));
  } catch (error) {
    // Ledger outage fails open: deliver normally so a transient DB error never
    // suppresses the survey invitation.
    logger.warn('[SurveySubscriber] Delivery gate unavailable; delivering normally', {
      eventType: event.eventType,
      tenantId,
      error: error instanceof Error ? error.message : String(error),
    });
    await effect();
    return;
  }
  const outcome = await withInboundOutboxDelivery({
    event,
    consumer: INBOUND_OUTBOX_SURVEY_CONSUMER,
    db: knex,
    owner: newInboundDeliveryOwner(),
    effect,
  });
  if (outcome.status === 'skipped') {
    logger.info('[SurveySubscriber] Skipping already-delivered inbound outbox event', {
      eventId: event.id,
      eventType: event.eventType,
      tenantId,
      consumer: INBOUND_OUTBOX_SURVEY_CONSUMER,
    });
  } else if (outcome.status === 'failed') {
    logger.warn('[SurveySubscriber] Inbound outbox delivery failed; recovery will retry', {
      eventId: event.id,
      eventType: event.eventType,
      tenantId,
      consumer: INBOUND_OUTBOX_SURVEY_CONSUMER,
    });
  }
}

type TicketSnapshot = {
  ticket_id: string;
  board_id: string | null;
  status_id: string | null;
  priority_id: string | null;
  client_id: string | null;
  contact_name_id: string | null;
};

type ProjectSnapshot = {
  project_id: string;
  client_id: string | null;
  contact_name_id: string | null;
};

let isRegistered = false;

export async function registerSurveySubscriber(): Promise<void> {
  if (isRegistered) {
    return;
  }

  await getEventBus().subscribe('TICKET_CLOSED', handleTicketClosedEvent, { subscriberId: 'survey' });
  await getEventBus().subscribe('PROJECT_CLOSED', handleProjectClosedEvent, { subscriberId: 'survey' });
  isRegistered = true;
  logger.info('[SurveySubscriber] Registered survey event handlers');
}

export async function unregisterSurveySubscriber(): Promise<void> {
  if (!isRegistered) {
    return;
  }

  await getEventBus().unsubscribe('TICKET_CLOSED', handleTicketClosedEvent);
  await getEventBus().unsubscribe('PROJECT_CLOSED', handleProjectClosedEvent);
  isRegistered = false;
  logger.info('[SurveySubscriber] Unregistered survey event handlers');
}

function extractActorUserId(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') {
    return undefined;
  }

  const record = payload as Record<string, unknown>;
  const candidates = [record.assignedByUserId, record.actorUserId, record.userId];
  const value = candidates.find((candidate) => typeof candidate === 'string' && candidate.length > 0);
  return typeof value === 'string' ? value : undefined;
}

function shouldSendTicketClosedSurveyInvitation(payload: { suppressContactNotifications?: boolean }): boolean {
  return payload.suppressContactNotifications !== true;
}

async function handleTicketClosedEvent(event: unknown): Promise<void> {
  try {
    const validated = EventSchemas.TICKET_CLOSED.parse(event) as TicketClosedEvent;
    const { tenantId, ticketId } = validated.payload;
    const actorUserId = extractActorUserId(validated.payload);
    logger.info('[SurveySubscriber] Handling TICKET_CLOSED', { tenantId, ticketId, event });

    if (!shouldSendTicketClosedSurveyInvitation(validated.payload)) {
      logger.debug('[SurveySubscriber] Skipped ticket closed survey invitation due to suppression', {
        tenantId,
        ticketId,
      });
      return;
    }

    await withSurveyInboundOutboxEffect(
      { id: validated.id, eventType: validated.eventType, payload: validated.payload },
      async () => {
        const triggers = await getSurveyTriggersForTenant(tenantId);
        logger.info('[SurveySubscriber] Loaded triggers', { tenantId, triggerCount: triggers.length });
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
              actorUserId,
            });
            logger.info('[SurveySubscriber] sendSurveyInvitation dispatched', {
              tenantId,
              ticketId,
              templateId,
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
      }
    );
  } catch (error) {
    logger.error('[SurveySubscriber] Failed to process ticket closed event', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    // An inbound outbox delivery whose failure could not be recorded must
    // propagate so the event bus redelivers; non-outbox events keep their
    // best-effort behavior.
    if (INBOUND_OUTBOX_EVENT_TYPES.has((event as { eventType?: unknown }).eventType as string)) throw error;
  }
}

async function handleProjectClosedEvent(event: unknown): Promise<void> {
  try {
    const validated = EventSchemas.PROJECT_CLOSED.parse(event) as ProjectClosedEvent;
    const { tenantId, projectId } = validated.payload;
    const actorUserId = extractActorUserId(validated.payload);

    const triggers = await getSurveyTriggersForTenant(tenantId);
    if (triggers.length === 0) {
      return;
    }

    const project = await loadProjectSnapshot(tenantId, projectId);
    if (!project) {
      logger.warn('[SurveySubscriber] Project not found for closed event', { tenantId, projectId });
      return;
    }

    const matchingTemplates = collectMatchingTemplatesForProject(triggers);
    if (matchingTemplates.size === 0) {
      return;
    }

    for (const templateId of matchingTemplates) {
      try {
        await sendSurveyInvitation({
          tenantId,
          ticketId: projectId,
          templateId,
          clientId: project.client_id,
          contactId: project.contact_name_id,
          actorUserId,
        });
      } catch (error) {
        logger.error('[SurveySubscriber] Failed to send survey invitation for project', {
          tenantId,
          projectId,
          templateId,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  } catch (error) {
    logger.error('[SurveySubscriber] Failed to process project closed event', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

export const __testHooks = {
  shouldSendTicketClosedSurveyInvitation,
  handleTicketClosedEvent,
  handleProjectClosedEvent,
};

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

  if ('board_id' in conditions && conditions.board_id?.length) {
    if (!ticket.board_id || !conditions.board_id.includes(ticket.board_id)) {
      return false;
    }
  }

  if (conditions.status_id?.length) {
    if (!ticket.status_id || !conditions.status_id.includes(ticket.status_id)) {
      return false;
    }
  }

  if ('priority' in conditions && conditions.priority?.length) {
    if (!ticket.priority_id || !conditions.priority.includes(ticket.priority_id)) {
      return false;
    }
  }

  return true;
}

async function loadTicketSnapshot(tenantId: string, ticketId: string): Promise<TicketSnapshot | null> {
  return runWithTenant(tenantId, async () => {
    const { knex } = await createTenantKnex();
    const result = await tenantDb(knex, tenantId).table<TicketSnapshot>('tickets')
      .select('ticket_id', 'board_id', 'status_id', 'priority_id', 'client_id', 'contact_name_id')
      .where('ticket_id', ticketId)
      .first();
    return result || null;
  });
}

function collectMatchingTemplatesForProject(triggers: SurveyTrigger[]): Set<string> {
  const templateIds = new Set<string>();

  for (const trigger of triggers) {
    if (!trigger.enabled || trigger.triggerType !== 'project_completed') {
      continue;
    }

    // For projects, we don't have specific conditions yet, so all enabled project_completed triggers match
    templateIds.add(trigger.templateId);
  }

  return templateIds;
}

async function loadProjectSnapshot(tenantId: string, projectId: string): Promise<ProjectSnapshot | null> {
  return runWithTenant(tenantId, async () => {
    const { knex } = await createTenantKnex();
    const result = await tenantDb(knex, tenantId).table<ProjectSnapshot>('projects')
      .select('project_id', 'client_id', 'contact_name_id')
      .where('project_id', projectId)
      .first();
    return result || null;
  });
}
