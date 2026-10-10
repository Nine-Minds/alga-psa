import { buildTicketTransitionEvents } from '@alga-psa/shared/lib/tickets/ticketLifecycleEvents';
import {
  buildApiTicketCreatedPayload,
  buildInboundPublisherTicketAssignedPayload,
  buildInboundPublisherTicketClosedPayload,
  buildInboundPublisherTicketCreatedPayload,
  buildInboundPublisherTicketUpdatedPayload,
  buildModelPublisherTicketAssignedPayload,
  buildModelPublisherTicketClosedPayload,
  buildModelPublisherTicketCreatedPayload,
  buildModelPublisherTicketUpdatedPayload,
  buildPortalTicketReopenedPayload,
  buildRmmTicketCreatedPayload,
  buildTicketAssignedPayload,
  buildTicketClosedPayload,
  buildTicketMergedPayload,
  buildTicketModelChanges,
  buildTicketResponseStateChangedPayload,
  buildTicketSplitPayload,
  buildTicketStatusChangedOutboxPayload,
  buildTicketTeamAssignedPayload,
  buildTicketUpdatedPayload,
  withOutboxOccurredAt,
} from '@alga-psa/shared/lib/tickets/ticketWorkflowEventPayloads';
import {
  buildTicketResolutionSlaStageCompletionEvent,
  buildTicketResolutionSlaStageEnteredEvent,
} from '@alga-psa/shared/services/tickets/ticketSlaStageEvents';
import { buildTicketCommunicationWorkflowEvents } from '@alga-psa/tickets/lib/workflowTicketCommunicationEvents';
import {
  buildServerPublisherTicketAssignedPayload,
  buildServerPublisherTicketClosedPayload,
  buildServerPublisherTicketCreatedPayload,
  buildServerPublisherTicketUpdatedPayload,
} from '@alga-psa/event-bus/adapters/serverEventPublisherPayloads';
import { buildTicketTimeEntryAddedWorkflowEvent } from 'server/src/lib/api/services/timeEntryWorkflowEvents';
import type { EmitterCase } from '../harness';
import { HARNESS_EVENT_TIMESTAMP } from '../harness';
import {
  IDS,
  NOW,
  closedTicket,
  contactReply,
  internalNote,
  publicAgentComment,
  ticket,
  ticketTimeEntry,
} from '../fixtures';
import { NO_EMITTER_UMBRELLA_TICKET, type EmitterContracts } from '../registryTypes';

type TicketEventType = Extract<keyof EmitterContracts, `TICKET_${string}`>;

function required<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`${what}: builder returned nothing for the fixture input`);
  return value;
}

function eventPayload(
  events: ReadonlyArray<{ eventType: string; payload: Record<string, unknown> }>,
  eventType: string
): Record<string, unknown> {
  return required(events.find((e) => e.eventType === eventType), `no ${eventType} event`).payload;
}

/** Transition events between two snapshots, as publishTicketTransitionsAfterCommit publishes them. */
const TRANSITION_SITE = 'shared/lib/tickets/ticketLifecycleEvents.ts#publishTicketTransitionsAfterCommit';
const snapshot = {
  ticketId: ticket.ticket_id!,
  statusId: ticket.status_id,
  priorityId: ticket.priority_id ?? null,
  assignedTo: ticket.assigned_to,
  boardId: ticket.board_id,
  escalated: false,
};

function transition(
  eventType: string,
  after: Partial<typeof snapshot>,
  ctx: { previousStatusIsClosed?: boolean; newStatusIsClosed?: boolean } = {},
  before: Partial<typeof snapshot> = {}
) {
  return eventPayload(
    buildTicketTransitionEvents({
      before: { ...snapshot, ...before },
      after: { ...snapshot, ...after },
      ctx: { occurredAt: NOW, actorUserId: IDS.user, ...ctx },
    }),
    eventType
  );
}

// Typed callers feed the IEventPublisher adapters exactly what TicketModel hands them.
const modelUpdateChanges = buildTicketModelChanges(
  { title: ticket.title, status_id: ticket.status_id } as Record<string, unknown>,
  { title: 'Printer offline on the third floor', status_id: IDS.statusInProgress }
);
const createdMetadata = {
  source: 'web_app',
  board_id: ticket.board_id,
  priority_id: ticket.priority_id,
  client_id: ticket.client_id,
  clientName: 'Acme Corp',
  requesterName: 'Jordan Rivers',
};

const SERVER_PUBLISHER = 'packages/event-bus/src/adapters/serverEventPublisher.ts';
const MODEL_PUBLISHER = 'shared/services/tickets/ticketModelEventPublisher.ts';
const WORKFLOW_PUBLISHER = 'shared/workflow/adapters/workflowEventPublisher.ts';
const OUTBOX_PUBLISHER = 'shared/workflow/adapters/inboundEmailOutboxEventPublisher.ts';
const TICKET_ACTIONS = 'packages/tickets/src/actions/ticketActions.ts';
const OPTIMIZED_ACTIONS = 'packages/tickets/src/actions/optimizedTicketActions.ts';
const PORTAL_ACTIONS = 'packages/client-portal/src/actions/client-portal-actions/client-tickets.ts';
const TICKET_SERVICE = 'server/src/lib/api/services/TicketService.ts';
const BUNDLE_UTILS = 'packages/tickets/src/actions/ticketBundleUtils.ts';
const BUNDLE_ACTIONS = 'packages/tickets/src/actions/ticketBundleActions.ts';

const responseStateFields = ['previousResponseState', 'newResponseState'] as const;
function responseState(
  site: string,
  previousState: 'awaiting_client' | 'awaiting_internal' | null,
  newState: 'awaiting_client' | 'awaiting_internal' | null,
  trigger: 'comment' | 'manual' | 'close',
  occurredAt = NOW
): EmitterCase {
  return {
    site,
    build: () =>
      buildTicketResponseStateChangedPayload({
        ticketId: ticket.ticket_id!,
        userId: IDS.user,
        previousState,
        newState,
        trigger,
      }),
    ctx: { occurredAt },
    // Schema-optional, but a workflow can only branch on them when present (alga0002101).
    expectFields: responseStateFields,
  };
}

export const ticketContracts = {
  TICKET_CREATED: {
    status: 'covered',
    cases: [
      {
        site: `${TICKET_SERVICE}#create`,
        build: () =>
          buildApiTicketCreatedPayload({
            ticketId: ticket.ticket_id!,
            userId: IDS.user,
            createdAt: NOW,
            boardId: ticket.board_id,
            priorityId: ticket.priority_id,
            clientId: ticket.client_id,
            externalLinks: [
              {
                link_id: 'ffffffff-ffff-4fff-8fff-000000000001',
                entity_type: 'ticket',
                entity_id: ticket.ticket_id!,
                system: 'jira',
                external_id: 'OPS-42',
                relationship: 'tracks',
              },
            ],
          }),
      },
      {
        site: `${TICKET_SERVICE}#createFromAsset`,
        build: () =>
          buildApiTicketCreatedPayload({
            ticketId: ticket.ticket_id!,
            userId: IDS.user,
            createdAt: NOW,
            boardId: ticket.board_id,
            priorityId: ticket.priority_id,
            clientId: ticket.client_id,
          }),
      },
      {
        site: 'shared/rmm/alerts/ticketCreatedEvent.ts#publishRmmTicketCreated',
        build: () => buildRmmTicketCreatedPayload({ ticketId: ticket.ticket_id!, source: 'rmm_alert' }),
        ctx: { actor: { actorType: 'SYSTEM' } },
      },
      {
        site: `${MODEL_PUBLISHER}#publishTicketCreated`,
        build: () =>
          buildModelPublisherTicketCreatedPayload(
            { tenantId: IDS.tenant, ticketId: ticket.ticket_id!, userId: IDS.user, metadata: createdMetadata },
            { suppressContactNotifications: true }
          ),
      },
      {
        site: `${SERVER_PUBLISHER}#publishTicketCreated`,
        build: () =>
          buildServerPublisherTicketCreatedPayload(
            { ticketId: ticket.ticket_id!, userId: IDS.user, metadata: createdMetadata },
            NOW
          ),
      },
      {
        site: `${WORKFLOW_PUBLISHER}#publishTicketCreated`,
        publishPath: 'rawPublishEvent',
        build: () =>
          buildInboundPublisherTicketCreatedPayload({
            tenantId: IDS.tenant,
            ticketId: ticket.ticket_id!,
            userId: IDS.user,
            metadata: createdMetadata,
          }),
      },
      {
        // No actor (system-created, e.g. an inbound email): userId falls back to the ticket id.
        site: `${WORKFLOW_PUBLISHER}#publishTicketCreated`,
        publishPath: 'rawPublishEvent',
        build: () =>
          buildInboundPublisherTicketCreatedPayload({
            tenantId: IDS.tenant,
            ticketId: ticket.ticket_id!,
            metadata: createdMetadata,
          }),
      },
      {
        site: `${OUTBOX_PUBLISHER}#publishTicketCreated`,
        publishPath: 'rawPublishEvent',
        build: () =>
          withOutboxOccurredAt(
            buildInboundPublisherTicketCreatedPayload({
              tenantId: IDS.tenant,
              ticketId: ticket.ticket_id!,
              userId: IDS.user,
              metadata: createdMetadata,
            }),
            HARNESS_EVENT_TIMESTAMP
          ),
      },
    ],
  },

  TICKET_UPDATED: {
    status: 'covered',
    cases: [
      {
        site: `${TICKET_ACTIONS}#updateTicket`,
        build: () =>
          buildTicketUpdatedPayload({
            ticketId: ticket.ticket_id!,
            userId: IDS.user,
            updatedByUserId: IDS.user,
            changes: { title: { old: ticket.title, previous: ticket.title, new: 'Printer offline (3rd floor)' } },
            suppressContactNotifications: true,
            suppressInternalNotifications: false,
          }),
      },
      {
        site: `${OPTIMIZED_ACTIONS}#updateTicketInTransaction`,
        build: () =>
          buildTicketUpdatedPayload({
            ticketId: ticket.ticket_id!,
            userId: IDS.user,
            updatedByUserId: IDS.user,
            changes: { priority_id: { old: IDS.priority, previous: IDS.priority, new: IDS.otherPriority } },
          }),
      },
      {
        site: `${PORTAL_ACTIONS}#updateTicketStatus`,
        build: () =>
          buildTicketUpdatedPayload({
            ticketId: ticket.ticket_id!,
            userId: IDS.user,
            changes: {
              status_id: { old: IDS.statusOpen, previous: IDS.statusOpen, new: IDS.statusInProgress },
            },
          }),
      },
      {
        site: `${TICKET_SERVICE}#update`,
        build: () =>
          buildTicketUpdatedPayload({
            ticketId: ticket.ticket_id!,
            updatedByUserId: IDS.user,
            changes: { title: { old: ticket.title, new: 'Printer offline (3rd floor)' } },
            suppressContactNotifications: false,
            suppressInternalNotifications: false,
          }),
      },
      {
        site: 'packages/tags/src/actions/tagActions.ts#publishEntityTagUpdateEvent',
        build: () =>
          buildTicketUpdatedPayload({
            ticketId: ticket.ticket_id!,
            userId: IDS.user,
            updatedByUserId: IDS.user,
            changes: { tags: { old: ['hardware'], previous: ['hardware'], new: ['hardware', 'printer'] } },
          }),
      },
      {
        site: `${BUNDLE_UTILS}#applyClosedMasterChoice`,
        build: () =>
          buildTicketUpdatedPayload({
            ticketId: ticket.ticket_id!,
            userId: IDS.user,
            updatedByUserId: IDS.user,
            changes: { master_ticket_id: { old: null, previous: null, new: IDS.otherTicket } },
          }),
      },
      {
        site: `${MODEL_PUBLISHER}#publishTicketUpdated`,
        build: () =>
          buildModelPublisherTicketUpdatedPayload({
            tenantId: IDS.tenant,
            ticketId: ticket.ticket_id!,
            userId: IDS.user,
            changes: modelUpdateChanges,
            metadata: { updated_fields: Object.keys(modelUpdateChanges) },
          }),
      },
      {
        site: `${SERVER_PUBLISHER}#publishTicketUpdated`,
        build: () =>
          buildServerPublisherTicketUpdatedPayload({
            ticketId: ticket.ticket_id!,
            userId: IDS.user,
            changes: modelUpdateChanges,
            metadata: { updated_fields: Object.keys(modelUpdateChanges) },
          }),
      },
      {
        site: `${WORKFLOW_PUBLISHER}#publishTicketUpdated`,
        publishPath: 'rawPublishEvent',
        build: () =>
          buildInboundPublisherTicketUpdatedPayload({
            tenantId: IDS.tenant,
            ticketId: ticket.ticket_id!,
            userId: IDS.user,
            changes: modelUpdateChanges,
          }),
      },
      {
        site: `${OUTBOX_PUBLISHER}#publishTicketUpdated`,
        publishPath: 'rawPublishEvent',
        build: () =>
          withOutboxOccurredAt(
            buildInboundPublisherTicketUpdatedPayload({
              tenantId: IDS.tenant,
              ticketId: ticket.ticket_id!,
              userId: IDS.user,
              changes: modelUpdateChanges,
            }),
            HARNESS_EVENT_TIMESTAMP
          ),
      },
    ],
  },

  TICKET_CLOSED: {
    status: 'covered',
    cases: [
      {
        site: `${TICKET_ACTIONS}#updateTicket`,
        build: () =>
          buildTicketClosedPayload({
            ticketId: closedTicket.ticket_id!,
            userId: IDS.user,
            closedByUserId: IDS.user,
            closedAt: closedTicket.closed_at!,
            changes: {
              status_id: { old: IDS.statusOpen, previous: IDS.statusOpen, new: closedTicket.status_id },
            },
            suppressContactNotifications: true,
            suppressInternalNotifications: false,
          }),
      },
      {
        site: `${OPTIMIZED_ACTIONS}#updateTicketInTransaction`,
        build: () =>
          buildTicketClosedPayload({
            ticketId: closedTicket.ticket_id!,
            userId: IDS.user,
            closedByUserId: IDS.user,
            closedAt: closedTicket.closed_at!,
          }),
      },
      {
        site: `${PORTAL_ACTIONS}#updateTicketStatus`,
        build: () =>
          buildTicketClosedPayload({
            ticketId: closedTicket.ticket_id!,
            userId: IDS.user,
            closedByUserId: IDS.user,
            closedAt: closedTicket.closed_at!,
            changes: { status_id: { old: IDS.statusOpen, previous: IDS.statusOpen, new: closedTicket.status_id } },
          }),
      },
      {
        site: `${TICKET_SERVICE}#update`,
        build: () =>
          buildTicketClosedPayload({
            ticketId: closedTicket.ticket_id!,
            closedByUserId: IDS.user,
            closedAt: closedTicket.closed_at!,
            suppressContactNotifications: false,
            suppressInternalNotifications: false,
          }),
      },
      {
        site: `${BUNDLE_UTILS}#applyClosedMasterChoice`,
        build: () =>
          buildTicketClosedPayload({
            ticketId: closedTicket.ticket_id!,
            userId: IDS.user,
            closedByUserId: IDS.user,
            closedAt: closedTicket.closed_at!,
          }),
      },
      {
        site: `${MODEL_PUBLISHER}#publishTicketClosed`,
        build: () =>
          buildModelPublisherTicketClosedPayload({
            tenantId: IDS.tenant,
            ticketId: closedTicket.ticket_id!,
            userId: IDS.user,
          }),
      },
      {
        site: `${SERVER_PUBLISHER}#publishTicketClosed`,
        build: () =>
          buildServerPublisherTicketClosedPayload({ ticketId: closedTicket.ticket_id!, userId: IDS.user }, NOW),
      },
      {
        site: `${WORKFLOW_PUBLISHER}#publishTicketClosed`,
        publishPath: 'rawPublishEvent',
        build: () =>
          buildInboundPublisherTicketClosedPayload({
            tenantId: IDS.tenant,
            ticketId: closedTicket.ticket_id!,
            userId: IDS.user,
          }),
      },
      {
        site: `${OUTBOX_PUBLISHER}#publishTicketClosed`,
        publishPath: 'rawPublishEvent',
        build: () =>
          withOutboxOccurredAt(
            buildInboundPublisherTicketClosedPayload({
              tenantId: IDS.tenant,
              ticketId: closedTicket.ticket_id!,
              userId: IDS.user,
            }),
            HARNESS_EVENT_TIMESTAMP
          ),
      },
    ],
  },

  TICKET_ASSIGNED: {
    status: 'covered',
    cases: [
      {
        site: `${TICKET_ACTIONS}#updateTicket`,
        build: () =>
          buildTicketAssignedPayload({
            ticketId: ticket.ticket_id!,
            userId: ticket.assigned_to!,
            assignedByUserId: IDS.user,
            previousAssigneeId: IDS.previousAssignee,
            previousAssigneeType: 'user',
            newAssigneeId: ticket.assigned_to!,
            newAssigneeType: 'user',
            assignedAt: NOW,
            suppressContactNotifications: true,
          }),
      },
      {
        site: `${TICKET_ACTIONS}#addTicket`,
        build: () =>
          buildTicketAssignedPayload({
            ticketId: ticket.ticket_id!,
            userId: ticket.assigned_to!,
            assignedByUserId: IDS.user,
          }),
      },
      {
        site: `${OPTIMIZED_ACTIONS}#updateTicketInTransaction`,
        build: () =>
          buildTicketAssignedPayload({
            ticketId: ticket.ticket_id!,
            userId: ticket.assigned_to!,
            assignedByUserId: IDS.user,
            previousAssigneeId: null,
            newAssigneeId: ticket.assigned_to!,
            newAssigneeType: 'user',
          }),
      },
      {
        site: 'packages/tickets/src/actions/teamAssignmentActions.ts#assignTeamToTicket',
        build: () =>
          buildTicketTeamAssignedPayload({
            ticketId: ticket.ticket_id!,
            assignedToUserId: ticket.assigned_to!,
            assignedByUserId: IDS.user,
            teamId: IDS.team,
          }),
      },
      {
        site: `${TICKET_SERVICE}#assignTeam`,
        build: () =>
          buildTicketTeamAssignedPayload({
            ticketId: ticket.ticket_id!,
            assignedToUserId: ticket.assigned_to!,
            assignedByUserId: IDS.user,
            teamId: IDS.team,
            suppressInternalNotifications: true,
          }),
      },
      {
        site: 'shared/services/tickets/ticketResourceCore.ts#addTicketResourceCore',
        build: () =>
          buildTicketAssignedPayload({
            ticketId: ticket.ticket_id!,
            userId: ticket.assigned_to!,
            assignedByUserId: IDS.user,
          }),
      },
      {
        site: 'shared/services/tickets/createTicketWithSideEffects.ts#createTicketWithSideEffects',
        build: () =>
          buildTicketAssignedPayload({
            ticketId: ticket.ticket_id!,
            userId: ticket.assigned_to!,
            assignedByUserId: IDS.user,
          }),
      },
      {
        site: `${MODEL_PUBLISHER}#publishTicketAssigned`,
        build: () =>
          buildModelPublisherTicketAssignedPayload({
            tenantId: IDS.tenant,
            ticketId: ticket.ticket_id!,
            userId: ticket.assigned_to!,
            assignedByUserId: IDS.user,
          }),
      },
      {
        site: `${SERVER_PUBLISHER}#publishTicketAssigned`,
        build: () =>
          buildServerPublisherTicketAssignedPayload(
            { ticketId: ticket.ticket_id!, userId: ticket.assigned_to!, assignedByUserId: IDS.user },
            NOW
          ),
      },
      {
        site: `${WORKFLOW_PUBLISHER}#publishTicketAssigned`,
        publishPath: 'rawPublishEvent',
        build: () =>
          buildInboundPublisherTicketAssignedPayload({
            tenantId: IDS.tenant,
            ticketId: ticket.ticket_id!,
            userId: ticket.assigned_to!,
            assignedByUserId: IDS.user,
          }),
      },
      {
        site: `${OUTBOX_PUBLISHER}#publishTicketAssigned`,
        publishPath: 'rawPublishEvent',
        build: () =>
          withOutboxOccurredAt(
            buildInboundPublisherTicketAssignedPayload({
              tenantId: IDS.tenant,
              ticketId: ticket.ticket_id!,
              userId: ticket.assigned_to!,
              assignedByUserId: IDS.user,
            }),
            HARNESS_EVENT_TIMESTAMP
          ),
      },
    ],
  },

  TICKET_RESPONSE_STATE_CHANGED: {
    status: 'covered',
    cases: [
      // null -> value (first transition)
      responseState(
        'packages/tickets/src/actions/comment-actions/commentActions.ts#updateTicketResponseState',
        null,
        'awaiting_client',
        'comment'
      ),
      // value -> null (close clears the state)
      responseState(`${OPTIMIZED_ACTIONS}#updateTicketInTransaction`, 'awaiting_client', null, 'close'),
      // value -> value
      responseState(
        `${OPTIMIZED_ACTIONS}#updateTicketResponseStateFromComment`,
        'awaiting_internal',
        'awaiting_client',
        'comment'
      ),
      responseState(`${OPTIMIZED_ACTIONS}#updateTicketInTransaction`, 'awaiting_client', 'awaiting_internal', 'manual'),
      responseState(`${TICKET_ACTIONS}#publishResponseStateChangedEvent`, 'awaiting_client', 'awaiting_internal', 'manual'),
      responseState(
        'server/src/lib/jobs/handlers/publishScheduledCommentHandler.ts#dispatchScheduledResponseStateEvent',
        null,
        'awaiting_client',
        'comment',
        '2026-07-16T11:59:00.000Z'
      ),
    ],
  },

  TICKET_STATUS_CHANGED: {
    status: 'covered',
    cases: [
      {
        site: TRANSITION_SITE,
        build: () => transition('TICKET_STATUS_CHANGED', { statusId: IDS.statusInProgress }),
      },
      {
        site: `${BUNDLE_UTILS}#applyClosedMasterChoice`,
        build: () => transition('TICKET_STATUS_CHANGED', { statusId: IDS.statusClosed }, { newStatusIsClosed: true }),
      },
      {
        site: `${OUTBOX_PUBLISHER}#publishTicketStatusChanged`,
        publishPath: 'rawPublishEvent',
        build: () =>
          buildTicketStatusChangedOutboxPayload({
            tenantId: IDS.tenant,
            ticketId: ticket.ticket_id!,
            userId: IDS.user,
            previousStatusId: ticket.status_id,
            newStatusId: IDS.statusInProgress,
            changedAt: NOW,
          }),
      },
      {
        // No actor: the outbox payload omits the actor fields.
        site: `${OUTBOX_PUBLISHER}#publishTicketStatusChanged`,
        publishPath: 'rawPublishEvent',
        build: () =>
          buildTicketStatusChangedOutboxPayload({
            tenantId: IDS.tenant,
            ticketId: ticket.ticket_id!,
            previousStatusId: ticket.status_id,
            newStatusId: IDS.statusInProgress,
            changedAt: NOW,
          }),
      },
    ],
  },

  TICKET_PRIORITY_CHANGED: {
    status: 'covered',
    cases: [
      {
        site: TRANSITION_SITE,
        build: () => transition('TICKET_PRIORITY_CHANGED', { priorityId: IDS.otherPriority }),
      },
    ],
  },

  TICKET_UNASSIGNED: {
    status: 'covered',
    cases: [
      { site: TRANSITION_SITE, build: () => transition('TICKET_UNASSIGNED', { assignedTo: null }) },
    ],
  },

  TICKET_QUEUE_CHANGED: {
    status: 'covered',
    cases: [
      { site: TRANSITION_SITE, build: () => transition('TICKET_QUEUE_CHANGED', { boardId: IDS.otherBoard }) },
    ],
  },

  TICKET_ESCALATED: {
    status: 'covered',
    cases: [
      { site: TRANSITION_SITE, build: () => transition('TICKET_ESCALATED', { escalated: true }) },
    ],
  },

  TICKET_REOPENED: {
    status: 'covered',
    cases: [
      {
        site: TRANSITION_SITE,
        build: () =>
          transition(
            'TICKET_REOPENED',
            { statusId: IDS.statusOpen },
            { previousStatusIsClosed: true, newStatusIsClosed: false },
            { statusId: IDS.statusClosed }
          ),
      },
      {
        site: `${PORTAL_ACTIONS}#updateTicketStatus`,
        build: () =>
          buildPortalTicketReopenedPayload({
            ticketId: ticket.ticket_id!,
            userId: IDS.user,
            previousStatusId: IDS.statusClosed,
            newStatusId: IDS.statusOpen,
            reopenedAt: NOW,
            changes: { status_id: { old: IDS.statusClosed, previous: IDS.statusClosed, new: IDS.statusOpen } },
          }),
      },
    ],
  },

  TICKET_MERGED: {
    status: 'covered',
    cases: [
      {
        site: `${BUNDLE_ACTIONS}#promoteBundleMasterAction`,
        build: () =>
          buildTicketMergedPayload({
            sourceTicketId: IDS.otherTicket,
            targetTicketId: ticket.ticket_id!,
            mergedAt: NOW,
            reason: 'bundle:promote_master',
          }),
      },
      {
        site: `${BUNDLE_UTILS}#attachChildrenToBundle`,
        build: () =>
          buildTicketMergedPayload({
            sourceTicketId: IDS.childTicket,
            targetTicketId: ticket.ticket_id!,
            mergedAt: NOW,
            reason: 'bundle:add_child',
          }),
      },
      {
        site: `${TICKET_SERVICE}#promoteBundleMaster`,
        build: () =>
          buildTicketMergedPayload({
            sourceTicketId: IDS.otherTicket,
            targetTicketId: ticket.ticket_id!,
            mergedAt: NOW,
            reason: 'bundle:promote_master',
          }),
      },
    ],
  },

  TICKET_SPLIT: {
    status: 'covered',
    cases: [
      {
        site: `${BUNDLE_ACTIONS}#removeChildFromBundleAction`,
        build: () =>
          buildTicketSplitPayload({
            originalTicketId: ticket.ticket_id!,
            newTicketIds: [IDS.childTicket],
            splitAt: NOW,
            reason: 'bundle:remove_child',
          }),
      },
      {
        site: `${BUNDLE_ACTIONS}#unbundleMasterTicketAction`,
        build: () =>
          buildTicketSplitPayload({
            originalTicketId: ticket.ticket_id!,
            newTicketIds: [IDS.childTicket, IDS.childTicket2],
            splitAt: NOW,
            reason: 'bundle:unbundle_master',
          }),
      },
      {
        site: `${TICKET_SERVICE}#removeBundleChild`,
        build: () =>
          buildTicketSplitPayload({
            originalTicketId: ticket.ticket_id!,
            newTicketIds: [IDS.childTicket],
            splitAt: NOW,
            reason: 'bundle:remove_child',
          }),
      },
      {
        site: `${TICKET_SERVICE}#unbundleMaster`,
        build: () =>
          buildTicketSplitPayload({
            originalTicketId: ticket.ticket_id!,
            newTicketIds: [IDS.childTicket, IDS.childTicket2],
            splitAt: NOW,
            reason: 'bundle:unbundle_master',
          }),
      },
    ],
  },

  TICKET_SLA_STAGE_ENTERED: {
    status: 'covered',
    cases: [
      {
        site: `${TICKET_ACTIONS}#addTicket`,
        build: () =>
          required(
            buildTicketResolutionSlaStageEnteredEvent({
              tenantId: IDS.tenant,
              ticketId: ticket.ticket_id!,
              itilPriorityLevel: ticket.itil_priority_level,
              enteredAt: ticket.entered_at,
            }),
            'SLA entered'
          ).payload,
      },
      {
        site: `${TICKET_ACTIONS}#createTicketFromAsset`,
        build: () =>
          required(
            buildTicketResolutionSlaStageEnteredEvent({
              tenantId: IDS.tenant,
              ticketId: ticket.ticket_id!,
              itilPriorityLevel: ticket.itil_priority_level,
              enteredAt: ticket.entered_at,
            }),
            'SLA entered'
          ).payload,
      },
      {
        site: `shared/services/tickets/createTicketWithSideEffects.ts#createTicketWithSideEffects`,
        build: () =>
          required(
            buildTicketResolutionSlaStageEnteredEvent({
              tenantId: IDS.tenant,
              ticketId: ticket.ticket_id!,
              itilPriorityLevel: ticket.itil_priority_level,
              enteredAt: ticket.entered_at,
            }),
            'SLA entered'
          ).payload,
      },
    ],
  },

  TICKET_SLA_STAGE_MET: {
    status: 'covered',
    cases: [
      {
        site: `${TICKET_ACTIONS}#updateTicket`,
        build: () =>
          required(
            buildTicketResolutionSlaStageCompletionEvent({
              tenantId: IDS.tenant,
              ticketId: closedTicket.ticket_id!,
              itilPriorityLevel: closedTicket.itil_priority_level,
              enteredAt: closedTicket.entered_at,
              // Priority 3 allows 24h; closed 3h after entry.
              closedAt: '2026-07-16T12:00:00.000Z',
            }),
            'SLA met'
          ).payload,
      },
      {
        site: `${OPTIMIZED_ACTIONS}#updateTicketInTransaction`,
        build: () =>
          required(
            buildTicketResolutionSlaStageCompletionEvent({
              tenantId: IDS.tenant,
              ticketId: closedTicket.ticket_id!,
              itilPriorityLevel: closedTicket.itil_priority_level,
              enteredAt: closedTicket.entered_at,
              // Priority 3 allows 24h; closed 3h after entry.
              closedAt: '2026-07-16T12:00:00.000Z',
            }),
            'SLA met'
          ).payload,
      },
      {
        site: `${BUNDLE_UTILS}#applyClosedMasterChoice`,
        build: () =>
          required(
            buildTicketResolutionSlaStageCompletionEvent({
              tenantId: IDS.tenant,
              ticketId: closedTicket.ticket_id!,
              itilPriorityLevel: closedTicket.itil_priority_level,
              enteredAt: closedTicket.entered_at,
              // Priority 3 allows 24h; closed 3h after entry.
              closedAt: '2026-07-16T12:00:00.000Z',
            }),
            'SLA met'
          ).payload,
      },
    ],
  },

  TICKET_SLA_STAGE_BREACHED: {
    status: 'covered',
    cases: [
      {
        site: `${TICKET_ACTIONS}#updateTicket`,
        build: () =>
          required(
            buildTicketResolutionSlaStageCompletionEvent({
              tenantId: IDS.tenant,
              ticketId: closedTicket.ticket_id!,
              itilPriorityLevel: closedTicket.itil_priority_level,
              enteredAt: closedTicket.entered_at,
              // Priority 3 allows 24h; closed two days after entry.
              closedAt: '2026-07-18T09:00:00.000Z',
            }),
            'SLA breached'
          ).payload,
      },
      {
        site: `${OPTIMIZED_ACTIONS}#updateTicketInTransaction`,
        build: () =>
          required(
            buildTicketResolutionSlaStageCompletionEvent({
              tenantId: IDS.tenant,
              ticketId: closedTicket.ticket_id!,
              itilPriorityLevel: closedTicket.itil_priority_level,
              enteredAt: closedTicket.entered_at,
              // Priority 3 allows 24h; closed two days after entry.
              closedAt: '2026-07-18T09:00:00.000Z',
            }),
            'SLA breached'
          ).payload,
      },
      {
        site: `${BUNDLE_UTILS}#applyClosedMasterChoice`,
        build: () =>
          required(
            buildTicketResolutionSlaStageCompletionEvent({
              tenantId: IDS.tenant,
              ticketId: closedTicket.ticket_id!,
              itilPriorityLevel: closedTicket.itil_priority_level,
              enteredAt: closedTicket.entered_at,
              // Priority 3 allows 24h; closed two days after entry.
              closedAt: '2026-07-18T09:00:00.000Z',
            }),
            'SLA breached'
          ).payload,
      },
    ],
  },

  TICKET_MESSAGE_ADDED: {
    status: 'covered',
    cases: [
      {
        site: 'packages/tickets/src/actions/comment-actions/commentActions.ts#createComment',
        build: () =>
          eventPayload(
            buildTicketCommunicationWorkflowEvents({
              ticketId: publicAgentComment.ticket_id!,
              messageId: publicAgentComment.comment_id!,
              visibility: 'public',
              author: { authorType: 'user', authorId: publicAgentComment.user_id! },
              channel: 'ui',
              createdAt: publicAgentComment.created_at,
            }),
            'TICKET_MESSAGE_ADDED'
          ),
      },
      {
        site: `${TICKET_ACTIONS}#addTicketComment`,
        build: () =>
          eventPayload(
            buildTicketCommunicationWorkflowEvents({
              ticketId: contactReply.ticket_id!,
              messageId: contactReply.comment_id!,
              visibility: 'public',
              author: { authorType: 'contact', authorId: contactReply.contact_id!, contactId: contactReply.contact_id! },
              channel: 'portal',
              createdAt: new Date(contactReply.created_at!),
              attachmentsCount: 2,
            }),
            'TICKET_MESSAGE_ADDED'
          ),
      },
    ],
  },

  TICKET_INTERNAL_NOTE_ADDED: {
    status: 'covered',
    cases: [
      {
        site: `${OPTIMIZED_ACTIONS}#addTicketCommentWithCache`,
        build: () =>
          eventPayload(
            buildTicketCommunicationWorkflowEvents({
              ticketId: internalNote.ticket_id!,
              messageId: internalNote.comment_id!,
              visibility: 'internal',
              author: { authorType: 'user', authorId: internalNote.user_id! },
              channel: 'ui',
              createdAt: internalNote.created_at,
            }),
            'TICKET_INTERNAL_NOTE_ADDED'
          ),
      },
    ],
  },

  TICKET_CUSTOMER_REPLIED: {
    status: 'covered',
    cases: [
      {
        site: `${TICKET_ACTIONS}#addTicketComment`,
        build: () =>
          eventPayload(
            buildTicketCommunicationWorkflowEvents({
              ticketId: contactReply.ticket_id!,
              messageId: contactReply.comment_id!,
              visibility: 'public',
              author: { authorType: 'contact', authorId: contactReply.contact_id!, contactId: contactReply.contact_id! },
              channel: 'email',
              createdAt: contactReply.created_at,
            }),
            'TICKET_CUSTOMER_REPLIED'
          ),
      },
    ],
  },

  TICKET_TIME_ENTRY_ADDED: {
    status: 'covered',
    cases: [
      {
        site: 'server/src/lib/api/services/TimeEntryService.ts#create',
        build: () =>
          required(
            buildTicketTimeEntryAddedWorkflowEvent({
              workItemType: ticketTimeEntry.work_item_type,
              workItemId: ticketTimeEntry.work_item_id,
              timeEntryId: ticketTimeEntry.entry_id!,
              minutes: ticketTimeEntry.billable_duration,
              billable: ticketTimeEntry.billable_duration > 0,
              createdAt: ticketTimeEntry.created_at,
            }),
            'time entry added'
          ).payload,
      },
      {
        site: 'server/src/lib/api/services/TimeEntryService.ts#stopTimeTracking',
        build: () =>
          required(
            buildTicketTimeEntryAddedWorkflowEvent({
              workItemType: ticketTimeEntry.work_item_type,
              workItemId: ticketTimeEntry.work_item_id,
              timeEntryId: ticketTimeEntry.entry_id!,
              minutes: 30,
              billable: false,
              createdAt: new Date(ticketTimeEntry.created_at),
            }),
            'time entry added (non-billable)'
          ).payload,
      },
    ],
  },

  TICKET_APPROVAL_REQUESTED: {
    status: 'no-product-emitter',
    ticket: NO_EMITTER_UMBRELLA_TICKET,
    reason: 'Catalogued trigger; no product code publishes TICKET_APPROVAL_REQUESTED (only workflow-harness fixtures reference it).',
  },
  TICKET_APPROVAL_GRANTED: {
    status: 'no-product-emitter',
    ticket: NO_EMITTER_UMBRELLA_TICKET,
    reason: 'Catalogued trigger; no product code publishes TICKET_APPROVAL_GRANTED.',
  },
  TICKET_APPROVAL_REJECTED: {
    status: 'no-product-emitter',
    ticket: NO_EMITTER_UMBRELLA_TICKET,
    reason: 'Catalogued trigger; no product code publishes TICKET_APPROVAL_REJECTED.',
  },
  TICKET_TAGS_CHANGED: {
    status: 'no-product-emitter',
    ticket: NO_EMITTER_UMBRELLA_TICKET,
    reason:
      'Catalogued trigger; tag changes publish TICKET_UPDATED (tagActions#publishEntityTagUpdateEvent), never TICKET_TAGS_CHANGED.',
  },
} satisfies Record<TicketEventType, EmitterContracts[TicketEventType]>;
