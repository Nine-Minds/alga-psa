import type { Knex } from 'knex';
import { registerAfterCommit, tenantDb } from '@alga-psa/db';
import { publishWorkflowEvent, type WorkflowActor } from '@alga-psa/event-bus/publishers';
import { TicketModel, type CreateTicketInput } from '../../models/ticketModel';
import { TagModel } from '../../models/tagModel';
import { associateAssetWithTicket } from '../assets/assetTicketAssociation';
import {
  applyChecklistTemplateToTicket,
  insertChecklistItemsReplacingTemplates,
  type ChecklistItemToInsert,
} from '../../lib/ticketChecklists';
import {
  TICKET_ACTIVITY_ACTOR,
  TICKET_ACTIVITY_ENTITY,
  TICKET_ACTIVITY_EVENT,
  TICKET_ACTIVITY_SOURCE,
  writeTicketActivity,
} from '../../lib/ticketActivity';
import { TicketModelEventPublisher } from './ticketModelEventPublisher';
import { addTicketResourceCore, type TicketAdditionalAgentEvent } from './ticketResourceCore';
import { assignTeamToTicketCore } from './teamAssignmentCore';
import { buildTicketResolutionSlaStageEnteredEvent, publishWorkflowTicketSlaStageEvent } from './ticketSlaStageEvents';
import { buildTicketAdditionalAgentAssignedPayload, buildTicketAssignedPayload } from '../../lib/tickets/ticketWorkflowEventPayloads';

/**
 * Who is creating the ticket.
 *
 * - `system` (scheduler, generator): `entered_by` stays null, the activity row and
 *   bus events carry a SYSTEM actor, and no stand-in user id is ever invented.
 * - `user`: a human acting through the UI.
 * - `workflow`: a workflow run acting as its run actor. `entered_by` is that user;
 *   the activity row says WORKFLOW; bus events use the USER actor (the event bus
 *   has no WORKFLOW actor type) and carry `workflowRunId` / `workflowLineage`.
 */
export type CreateTicketActor =
  | { type: 'system' }
  | { type: 'user'; userId: string }
  | { type: 'workflow'; userId: string; runId: string; workflowId: string; lineage: string[] };

export interface CreateTicketActorEffects {
  /** Value for `tickets.entered_by`, and the user id passed to cores/tags/`updated_by`. */
  actorUserId: string | null;
  activityActor: Parameters<typeof writeTicketActivity>[1]['actor'];
  activitySource: (typeof TICKET_ACTIVITY_SOURCE)[keyof typeof TICKET_ACTIVITY_SOURCE];
  busActor: WorkflowActor;
  /** Merged into the payload of every event published for a workflow actor. */
  provenance: { workflowRunId?: string; workflowLineage?: string[] };
}

/** The one place an actor is turned into stored and published attribution. */
export function resolveActorEffects(actor: CreateTicketActor): CreateTicketActorEffects {
  switch (actor.type) {
    case 'system':
      return {
        actorUserId: null,
        activityActor: { actorType: TICKET_ACTIVITY_ACTOR.SYSTEM },
        activitySource: TICKET_ACTIVITY_SOURCE.SYSTEM,
        busActor: { actorType: 'SYSTEM' },
        provenance: {},
      };
    case 'user':
      return {
        actorUserId: actor.userId,
        activityActor: { actorType: TICKET_ACTIVITY_ACTOR.USER, userId: actor.userId },
        activitySource: TICKET_ACTIVITY_SOURCE.UI,
        busActor: { actorType: 'USER', actorUserId: actor.userId },
        provenance: {},
      };
    case 'workflow':
      return {
        actorUserId: actor.userId,
        activityActor: { actorType: TICKET_ACTIVITY_ACTOR.WORKFLOW, userId: actor.userId },
        activitySource: TICKET_ACTIVITY_SOURCE.WORKFLOW,
        busActor: { actorType: 'USER', actorUserId: actor.userId },
        provenance: {
          workflowRunId: actor.runId,
          workflowLineage: [...actor.lineage, actor.workflowId],
        },
      };
  }
}

/** A checklist item the ticket owns outright (a snapshot, e.g. from a ticket template). */
export interface OwnedChecklistItemInput {
  item_name: string;
  description?: string | null;
  is_required: boolean;
  /** Checklist template the item was copied from; the replacement rule drops auto-applied rows for it. */
  checklist_template_id?: string | null;
}

/** Provenance of a ticket created from a ticket template (written as TICKET_CREATED_FROM_TEMPLATE). */
export interface CreatedFromTemplateInput {
  template_id: string;
  template_name: string;
  custom_fields_copied: number;
}

export function ownedChecklistItemsToInsert(items: readonly OwnedChecklistItemInput[]): ChecklistItemToInsert[] {
  return items.map((item) => ({
    item_name: item.item_name,
    description: item.description ?? null,
    is_required: item.is_required,
    assigned_to: null,
    source: item.checklist_template_id ? 'template' : 'manual',
    template_id: item.checklist_template_id ?? null,
  }));
}

/**
 * The effects of "created from a ticket template" once the ticket row exists: the owned checklist items
 * (replacement rule, plus a CHECKLIST_TEMPLATE_APPLIED activity per carried checklist template that auto-apply
 * had not applied) and the TICKET_CREATED_FROM_TEMPLATE activity. Used by `createTicketWithSideEffects` and by
 * `addTicket`, which composes its own create but must record the same provenance.
 */
export async function applyCreatedFromTemplateEffects(
  trx: Knex.Transaction,
  tenant: string,
  args: {
    ticketId: string;
    actor: CreateTicketActor;
    checklistItems: readonly OwnedChecklistItemInput[];
    fromTemplate: CreatedFromTemplateInput;
  }
): Promise<{ checklistItemsCopied: number }> {
  const { actorUserId, activityActor, activitySource } = resolveActorEffects(args.actor);
  const checklistItemsCopied = await insertChecklistItemsReplacingTemplates(trx, tenant, {
    targetTicketId: args.ticketId,
    items: ownedChecklistItemsToInsert(args.checklistItems),
    userId: actorUserId,
    audit: { actor: activityActor, source: activitySource },
  });
  await writeTicketActivity(trx, {
    tenant,
    ticketId: args.ticketId,
    eventType: TICKET_ACTIVITY_EVENT.CREATED_FROM_TEMPLATE,
    entityType: TICKET_ACTIVITY_ENTITY.TICKET,
    entityId: args.ticketId,
    actor: activityActor,
    source: activitySource,
    details: {
      template_id: args.fromTemplate.template_id,
      template_name: args.fromTemplate.template_name,
      checklist_items_copied: checklistItemsCopied,
      custom_fields_copied: args.fromTemplate.custom_fields_copied,
    },
  });
  return { checklistItemsCopied };
}

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
  /** Owned checklist items applied with the replacement rule (they win over auto-applied rows for the same checklist template). */
  checklistItems?: OwnedChecklistItemInput[];
  /** When set, the ticket records that it was created from a ticket template (activity row inside this layer). */
  fromTemplate?: CreatedFromTemplateInput;
  /**
   * Notification suppression carried on every published ticket event
   * (TICKET_CREATED, TICKET_ASSIGNED and the additional-agent events). The
   * subscribers skip the suppressed audience; SLA, search, webhooks and workflow
   * triggers are unaffected.
   */
  notificationSuppression?: {
    suppressContactNotifications?: boolean;
    suppressInternalNotifications?: boolean;
  };
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
  const { actorUserId, activityActor, activitySource, busActor, provenance } = resolveActorEffects(input.actor);
  const suppressionPayload = {
    suppressContactNotifications: input.notificationSuppression?.suppressContactNotifications === true,
    suppressInternalNotifications: input.notificationSuppression?.suppressInternalNotifications === true,
  };
  const eventExtras = { ...suppressionPayload, ...provenance };

  const eventPublisher = new TicketModelEventPublisher(trx, {
    ticketCreatedPayload: eventExtras,
  });

  const created = await TicketModel.createTicketWithRetry(
    { ...input.ticket, entered_by: actorUserId ?? undefined },
    tenant,
    trx,
    {},
    eventPublisher,
    undefined,
    actorUserId ?? undefined,
    3,
  );
  const ticketId = created.ticket_id;

  const db = tenantDb(trx, tenant);

  if (input.teamId) {
    await assignTeamToTicketCore(trx, tenant, actorUserId, ticketId, input.teamId);
  }

  // Skip agents the team step already recorded as `team_member` resources:
  // addTicketResourceCore treats an existing resource as a conflict. Filter up
  // front rather than catching the error, which would hide real conflicts.
  const requestedAgentIds = [...new Set(input.additionalAgentIds ?? [])];
  const existingAgentIds = new Set<string>();
  if (requestedAgentIds.length > 0) {
    const existing = await db
      .table('ticket_resources')
      .where({ ticket_id: ticketId })
      .whereIn('additional_user_id', requestedAgentIds)
      .select('additional_user_id');
    for (const row of existing as Array<{ additional_user_id: string }>) {
      existingAgentIds.add(row.additional_user_id);
    }
  }

  // Agent events are published after commit. A promotion event (resource === null)
  // is dropped: the single TICKET_ASSIGNED published below covers it.
  const agentEvents: TicketAdditionalAgentEvent[] = [];
  for (const agentId of requestedAgentIds) {
    if (existingAgentIds.has(agentId)) continue;
    const result = await addTicketResourceCore(
      trx,
      tenant,
      actorUserId,
      ticketId,
      agentId,
      ADDITIONAL_AGENT_ROLE,
      suppressionPayload,
    );
    if (result.resource && result.event.eventType === 'TICKET_ADDITIONAL_AGENT_ASSIGNED') agentEvents.push(result.event);
  }

  for (const tagText of new Set((input.tags ?? []).map((tag) => tag.trim()).filter(Boolean))) {
    const definition = await TagModel.getOrCreateTagDefinition(tagText, 'ticket', tenant, trx);
    await TagModel.createTagMapping(
      definition.tag_id,
      ticketId,
      'ticket',
      tenant,
      trx,
      actorUserId ?? undefined,
    );
  }

  const now = new Date().toISOString();
  for (const assetId of new Set(input.assetIds ?? [])) {
    await associateAssetWithTicket(trx, tenant, assetId, ticketId, now, 'affected');
  }

  if (input.checklistTemplateId) {
    // A client-scoped template that doesn't match the new ticket's client is skipped, not fatal:
    // ticket creation must never fail because of an optional checklist.
    const checklistResult = await applyChecklistTemplateToTicket(trx, tenant, ticketId, input.checklistTemplateId, 'template');
    if (checklistResult.reason) {
      console.warn('[createTicketWithSideEffects] checklist template not applied', {
        ticketId,
        templateId: input.checklistTemplateId,
        reason: checklistResult.reason,
      });
    }
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
    actor: activityActor,
    source: activitySource,
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

  if (input.fromTemplate) {
    await applyCreatedFromTemplateEffects(trx, tenant, {
      ticketId,
      actor: input.actor,
      checklistItems: input.checklistItems ?? [],
      fromTemplate: input.fromTemplate,
    });
  } else if (input.checklistItems?.length) {
    await insertChecklistItemsReplacingTemplates(trx, tenant, {
      targetTicketId: ticketId,
      items: ownedChecklistItemsToInsert(input.checklistItems),
      userId: actorUserId,
      audit: { actor: activityActor, source: activitySource },
    });
  }

  const eventCtx = (extra: { occurredAt?: string } = {}) => ({
    ctx: { tenantId: tenant, actor: busActor, ...(extra.occurredAt ? { occurredAt: extra.occurredAt } : {}) },
  });

  const assignee: string | null = fullTicket.assigned_to ?? null;
  if (assignee) {
    registerAfterCommit(
      trx,
      () =>
        publishWorkflowEvent({
          eventType: 'TICKET_ASSIGNED',
          payload: buildTicketAssignedPayload({
            ticketId,
            userId: assignee,
            ...(actorUserId ? { assignedByUserId: actorUserId } : {}),
            extras: eventExtras,
          }),
          ...eventCtx(),
        }),
      `TICKET_ASSIGNED ticket=${ticketId}`,
    );
  }

  for (const event of agentEvents) {
    registerAfterCommit(
      trx,
      () =>
        publishWorkflowEvent({
          eventType: event.eventType,
          payload: buildTicketAdditionalAgentAssignedPayload({
            ticketId,
            primaryAgentId: event.payload.primaryAgentId as string,
            additionalAgentId: event.payload.additionalAgentId as string,
            assignedByUserId: event.payload.assignedByUserId as string | undefined,
            extras: eventExtras,
          }),
          ...eventCtx(),
        }),
      `${event.eventType} ticket=${ticketId}`,
    );
  }

  const enteredSlaEvent = buildTicketResolutionSlaStageEnteredEvent({
    // Suppression flags describe notifications; an SLA stage event has none, so only provenance rides along.
    payloadExtras: provenance,
    tenantId: tenant,
    ticketId,
    itilPriorityLevel: fullTicket.itil_priority_level,
    enteredAt: fullTicket.entered_at,
  });
  if (enteredSlaEvent) {
    registerAfterCommit(
      trx,
      () =>
        publishWorkflowTicketSlaStageEvent(
          enteredSlaEvent,
          eventCtx({ occurredAt: toIso(fullTicket.entered_at) }).ctx,
        ),
      `${enteredSlaEvent.eventType} ticket=${ticketId}`,
    );
  }

  return { ticketId, ticketNumber: created.ticket_number };
}
