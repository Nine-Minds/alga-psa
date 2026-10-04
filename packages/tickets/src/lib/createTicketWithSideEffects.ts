import type { Knex } from 'knex';
import { registerAfterCommit, tenantDb } from '@alga-psa/db';
import { publishEvent, publishWorkflowEvent } from '@alga-psa/event-bus/publishers';
import { TicketModel, type CreateTicketInput } from '@alga-psa/shared/models/ticketModel';
import TagDefinition from '@alga-psa/tags/models/tagDefinition';
import TagMapping from '@alga-psa/tags/models/tagMapping';
import { generateEntityColor } from '@alga-psa/tags/lib/colorUtils';
import { associateAssetWithTicket } from '@alga-psa/shared/services/assets/assetTicketAssociation';
import { applyChecklistTemplateToTicket } from '@alga-psa/shared/lib/ticketChecklists';
import {
  TICKET_ACTIVITY_ACTOR,
  TICKET_ACTIVITY_ENTITY,
  TICKET_ACTIVITY_EVENT,
  TICKET_ACTIVITY_SOURCE,
  writeTicketActivity,
} from '@alga-psa/shared/lib/ticketActivity';
import { TicketModelEventPublisher } from './adapters/TicketModelEventPublisher';
import { TicketModelAnalyticsTracker } from './adapters/TicketModelAnalyticsTracker';
import { addTicketResourceCore, publishTicketResourceEvent } from './ticketResourceCore';
import { assignTeamToTicketCore } from './teamAssignmentCore';
import { buildTicketResolutionSlaStageEnteredEvent } from './workflowTicketSlaStageEvents';

/**
 * Who is creating the ticket. A `system` actor (scheduler, generator) is stored
 * as such everywhere: `entered_by` stays null, the activity row and workflow
 * events carry a SYSTEM actor, and no stand-in user id is ever invented.
 */
export type CreateTicketActor = { type: 'system' } | { type: 'user'; userId: string };

export interface CreateTicketWithSideEffectsInput {
  actor: CreateTicketActor;
  /** Core ticket fields. `entered_by` is derived from `actor`; do not set it. */
  ticket: Omit<CreateTicketInput, 'entered_by'>;
  /** Team to assign. The team lead becomes the primary assignee when none is set. */
  teamId?: string | null;
  /** Additional agents (role `support`). */
  additionalAgentIds?: string[];
  /** Tag texts to apply to the new ticket (created as definitions when new). */
  tags?: string[];
  /** Assets linked to the ticket as `affected`. */
  assetIds?: string[];
  /** Checklist template applied in addition to any auto-applying templates. */
  checklistTemplateId?: string | null;
  /**
   * Notification suppression carried on the published events. Contact-facing
   * suppression is honoured by the TICKET_CREATED email subscriber and by the
   * assignment events published here.
   */
  notificationSuppression?: { suppressContactNotifications?: boolean };
}

export interface CreateTicketWithSideEffectsResult {
  ticketId: string;
  ticketNumber: string;
}

const ADDITIONAL_AGENT_ROLE = 'support';

function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string' && value) return value;
  return new Date().toISOString();
}

/**
 * Creates a ticket and everything a created ticket normally carries (team,
 * agents, tags, assets, checklist, activity row, domain events) inside the
 * caller's transaction. Events are published after that transaction commits, so
 * the transaction must be owned by a `withTransaction` frame.
 *
 * Session-free: callers resolve authorization first. This is the composition
 * the web action `addTicket` assembles by hand around `TicketModel`; the
 * recurring-ticket generator is its first consumer.
 */
export async function createTicketWithSideEffects(
  trx: Knex.Transaction,
  tenant: string,
  input: CreateTicketWithSideEffectsInput,
): Promise<CreateTicketWithSideEffectsResult> {
  const { actor } = input;
  const actorUserId = actor.type === 'user' ? actor.userId : null;
  const suppressContact = input.notificationSuppression?.suppressContactNotifications === true;
  const suppressionPayload = suppressContact ? { suppressContactNotifications: true } : {};

  const eventPublisher = new TicketModelEventPublisher(trx, {
    ticketCreatedPayload: suppressionPayload,
  });

  const created = await TicketModel.createTicketWithRetry(
    { ...input.ticket, entered_by: actorUserId ?? undefined },
    tenant,
    trx,
    {},
    eventPublisher,
    new TicketModelAnalyticsTracker(),
    actorUserId ?? undefined,
    3,
  );
  const ticketId = created.ticket_id;

  const db = tenantDb(trx, tenant);

  if (input.teamId) {
    await assignTeamToTicketCore(trx, tenant, actorUserId, ticketId, input.teamId);
  }

  // Agent events are published after commit. A promotion event (resource === null)
  // is dropped: the single TICKET_ASSIGNED published below covers it.
  const agentEvents: Awaited<ReturnType<typeof addTicketResourceCore>>['event'][] = [];
  for (const agentId of new Set(input.additionalAgentIds ?? [])) {
    const result = await addTicketResourceCore(
      trx,
      tenant,
      actorUserId,
      ticketId,
      agentId,
      ADDITIONAL_AGENT_ROLE,
      suppressionPayload,
    );
    if (result.resource) agentEvents.push(result.event);
  }

  for (const tagText of new Set((input.tags ?? []).map((tag) => tag.trim()).filter(Boolean))) {
    const colors = generateEntityColor(tagText);
    const definition = await TagDefinition.getOrCreate(trx, tenant, tagText, 'ticket', {
      background_color: colors.background,
      text_color: colors.text,
    });
    await TagMapping.insert(
      trx,
      tenant,
      { tag_id: definition.tag_id, tagged_id: ticketId, tagged_type: 'ticket' },
      actorUserId ?? undefined,
    );
  }

  const now = new Date().toISOString();
  for (const assetId of new Set(input.assetIds ?? [])) {
    await associateAssetWithTicket(trx, tenant, assetId, ticketId, now, 'affected');
  }

  if (input.checklistTemplateId) {
    await applyChecklistTemplateToTicket(trx, tenant, ticketId, input.checklistTemplateId, 'template');
  }

  const fullTicket = await db.table('tickets').where({ ticket_id: ticketId }).first();
  if (!fullTicket) {
    throw new Error('Created ticket could not be reloaded after insert.');
  }

  await writeTicketActivity(trx, {
    tenant,
    ticketId,
    eventType: TICKET_ACTIVITY_EVENT.CREATED,
    entityType: TICKET_ACTIVITY_ENTITY.TICKET,
    entityId: ticketId,
    actor: actor.type === 'user'
      ? { actorType: TICKET_ACTIVITY_ACTOR.USER, userId: actor.userId }
      : { actorType: TICKET_ACTIVITY_ACTOR.SYSTEM },
    source: actor.type === 'user' ? TICKET_ACTIVITY_SOURCE.UI : TICKET_ACTIVITY_SOURCE.SYSTEM,
    occurredAt: toIso(fullTicket.entered_at),
    details: {
      title: fullTicket.title,
      board_id: fullTicket.board_id,
      status_id: fullTicket.status_id,
      priority_id: fullTicket.priority_id,
      assigned_to: fullTicket.assigned_to,
      client_id: fullTicket.client_id,
      ticket_origin: fullTicket.ticket_origin,
    },
  });

  const assignee: string | null = fullTicket.assigned_to ?? null;
  if (assignee) {
    registerAfterCommit(
      trx,
      () =>
        publishEvent({
          eventType: 'TICKET_ASSIGNED',
          payload: {
            tenantId: tenant,
            ticketId,
            userId: assignee,
            ...(actorUserId ? { assignedByUserId: actorUserId } : {}),
            ...suppressionPayload,
          },
        }),
      `TICKET_ASSIGNED ticket=${ticketId}`,
    );
  }

  for (const event of agentEvents) {
    registerAfterCommit(
      trx,
      () => publishTicketResourceEvent(event),
      `${event.eventType} ticket=${ticketId}`,
    );
  }

  const enteredSlaEvent = buildTicketResolutionSlaStageEnteredEvent({
    tenantId: tenant,
    ticketId,
    itilPriorityLevel: fullTicket.itil_priority_level,
    enteredAt: fullTicket.entered_at,
  });
  if (enteredSlaEvent) {
    registerAfterCommit(
      trx,
      () =>
        publishWorkflowEvent({
          eventType: enteredSlaEvent.eventType,
          payload: enteredSlaEvent.payload,
          ctx: {
            tenantId: tenant,
            actor: actorUserId
              ? { actorType: 'USER' as const, actorUserId }
              : { actorType: 'SYSTEM' as const },
            occurredAt: toIso(fullTicket.entered_at),
          },
          idempotencyKey: enteredSlaEvent.idempotencyKey,
        }),
      `${enteredSlaEvent.eventType} ticket=${ticketId}`,
    );
  }

  return { ticketId, ticketNumber: created.ticket_number };
}
