import {
  buildAppointmentRequestApprovedPayload,
  buildAppointmentRequestDeclinedPayload,
  buildProjectAssignedPayload,
  buildProjectClosedPayload,
  buildProjectTaskAdditionalAgentAssignedPayload,
  buildProjectTaskUpdatedPayload,
  buildScheduleEntryCreatedPayload,
  buildScheduleEntryDeletedPayload,
  buildScheduleEntryUpdatedPayload,
  buildTaskCommentAddedPayload,
  buildTaskCommentUpdatedPayload,
  buildTimeEntryApprovedPayload,
  buildTimeEntrySubmittedPayload,
} from '@alga-psa/workflow-streams';
import {
  buildInboundPublisherTicketCommentAddedPayload,
  buildModelPublisherTicketCommentAddedPayload,
  buildTicketAdditionalAgentAssignedPayload,
  buildTicketCommentAddedPayload,
} from '@alga-psa/shared/lib/tickets/ticketWorkflowEventPayloads';
import { buildServerPublisherTicketCommentAddedPayload } from '@alga-psa/event-bus/adapters/serverEventPublisherPayloads';
import type { EmitterCase } from '../harness';
import { IDS, NOW, ticket } from '../fixtures';
import { NO_EMITTER_UMBRELLA_TICKET, type EmitterContracts } from '../registryTypes';

/**
 * Events the workflow worker has a payload schema for, that product code publishes, and that were
 * missing from the catalog until the single schema tree landed: ticket comments / extra agents,
 * schedule entries, appointment requests, project assignment / closure, project task updates /
 * extra agents, task comments and time-entry submission / approval.
 */

const NO_EMITTER_APPOINTMENT_REASON =
  'The worker schema and catalog entry exist, but no product code publishes this appointment-request lifecycle event.';

// ---- tickets ----
const comment = { content: 'Hello', author: 'Test User', isInternal: false };
const commentBase = {
  tenantId: IDS.tenant,
  occurredAt: NOW,
  ticketId: ticket.ticket_id!,
  commentId: IDS.comment,
  userId: IDS.user,
};
// A workflow can only correlate on commentId when it is present.
const commentFields = ['commentId'] as const;

const commentCase = (site: string, build: EmitterCase['build'], extra: Partial<EmitterCase> = {}): EmitterCase => ({
  site,
  build,
  expectFields: commentFields,
  ...extra,
});

// ---- scheduling ----
const entryParams = { entryId: IDS.scheduleEntry, userId: IDS.user };
const scheduleUserCtx = { actor: { actorType: 'USER' as const, actorUserId: IDS.user } };
const entryCase = (
  site: string,
  build: (changes: Record<string, unknown>) => Record<string, unknown>,
  changes: Record<string, unknown>
): EmitterCase => ({ site, ctx: scheduleUserCtx, build: () => build(changes) });

const SCHEDULING = 'packages/scheduling/src/actions';
const APPOINTMENT_REQUEST_PARAMS = {
  appointmentRequestId: IDS.appointmentRequest,
  serviceId: IDS.service,
  serviceName: 'On-site visit',
  requestedDate: '2026-07-20',
  requestedTime: '09:30',
  requestedDuration: 60,
  isAuthenticated: true,
  requesterEmail: 'jordan.rivers@example.com',
  requesterName: 'Jordan Rivers',
  requesterPhone: null,
  clientId: IDS.client,
  contactId: IDS.contact,
  clientUserId: null,
  preferredAssignedUserId: IDS.technician,
  companyName: 'Acme Corp',
  ticketId: null,
  description: null,
  approvedByUserId: IDS.user,
  assignedUserId: IDS.technician,
  scheduleEntryId: IDS.scheduleEntry,
  declineReason: null,
};

// ---- projects ----
const PROJECT_ACTIONS = 'packages/projects/src/actions';
const taskUserCtx = { actor: { actorType: 'USER' as const, actorUserId: IDS.user } };
const taskChanges = { title: { previous: 'Install racks', new: 'Install and label racks' } };

// ---- time entries ----
const TIME_ENTRY_ACTIONS = 'packages/scheduling/src/actions/timeEntryCrudActions.ts#publishTimeEntrySearchEvent';
const timeEntryParams = {
  timeEntryId: IDS.timeEntry,
  userId: IDS.user,
  workItemId: IDS.ticket,
  workItemType: 'TICKET' as const,
  timestamp: NOW,
};

export const workerSchemaContracts = {
  // ---------------- tickets ----------------
  TICKET_COMMENT_ADDED: {
    status: 'covered',
    cases: [
      commentCase('packages/tickets/src/actions/comment-actions/commentActions.ts#createComment', () =>
        buildTicketCommentAddedPayload({
          ...commentBase,
          thread_id: null,
          parent_comment_id: null,
          is_reply: false,
          comment: { ...comment, authorType: 'internal', thread_id: null, parent_comment_id: null, is_reply: false },
        })
      ),
      commentCase('packages/tickets/src/actions/optimizedTicketActions.ts#addTicketCommentWithCache', () =>
        buildTicketCommentAddedPayload({
          ...commentBase,
          comment: { ...comment, authorType: 'internal' },
          suppressContactNotifications: false,
        })
      ),
      commentCase('packages/tickets/src/actions/ticketActions.ts#addTicketComment', () =>
        buildTicketCommentAddedPayload({ ...commentBase, comment })
      ),
      commentCase('packages/client-portal/src/actions/client-portal-actions/client-tickets.ts#addClientTicketComment', () =>
        buildTicketCommentAddedPayload({ ...commentBase, comment })
      ),
      commentCase('server/src/lib/api/services/TicketService.ts#addComment', () =>
        buildTicketCommentAddedPayload({ ...commentBase, comment, suppressContactNotifications: true })
      ),
      commentCase('shared/models/ticketModel.ts#addComment', () =>
        buildTicketCommentAddedPayload({ ...commentBase, comment })
      ),
      commentCase('server/src/lib/jobs/handlers/publishScheduledCommentHandler.ts#publishScheduledCommentHandler', () =>
        buildTicketCommentAddedPayload({ ...commentBase, comment })
      ),
      commentCase(
        'shared/services/tickets/ticketModelEventPublisher.ts#publishCommentCreated',
        () =>
          buildModelPublisherTicketCommentAddedPayload({
            tenantId: IDS.tenant,
            ticketId: ticket.ticket_id!,
            commentId: IDS.comment,
            userId: IDS.user,
            metadata: { content: 'Hello', author: 'Test User', isInternal: false },
          }),
        { ctx: { occurredAt: NOW } }
      ),
      commentCase(
        'packages/event-bus/src/adapters/serverEventPublisher.ts#publishCommentCreated',
        () =>
          buildServerPublisherTicketCommentAddedPayload({
            ticketId: ticket.ticket_id!,
            commentId: IDS.comment,
            userId: IDS.user,
            metadata: { content: 'Hello', author: 'Test User', isInternal: false },
          }),
        { ctx: { occurredAt: NOW } }
      ),
      commentCase(
        'shared/workflow/adapters/workflowEventPublisher.ts#publishCommentCreated',
        () =>
          buildInboundPublisherTicketCommentAddedPayload({
            tenantId: IDS.tenant,
            ticketId: ticket.ticket_id!,
            commentId: IDS.comment,
            userId: IDS.user,
            metadata: { content: 'Hello', author: 'Test User', isInternal: false },
          }),
        { publishPath: 'rawPublishEvent', ctx: { occurredAt: NOW } }
      ),
      commentCase(
        'shared/workflow/adapters/inboundEmailOutboxEventPublisher.ts#publishCommentCreated',
        () =>
          buildInboundPublisherTicketCommentAddedPayload({
            tenantId: IDS.tenant,
            ticketId: ticket.ticket_id!,
            commentId: IDS.comment,
            metadata: { content: 'Reply by email', author: 'Jordan Rivers', isInternal: false },
          }),
        { publishPath: 'rawPublishEvent', ctx: { occurredAt: NOW } }
      ),
    ],
  },
  TICKET_ADDITIONAL_AGENT_ASSIGNED: {
    status: 'covered',
    cases: [
      {
        site: 'shared/services/tickets/ticketResourceCore.ts#addTicketResourceCore',
        ctx: scheduleUserCtx,
        build: () =>
          buildTicketAdditionalAgentAssignedPayload({
            ticketId: ticket.ticket_id!,
            primaryAgentId: IDS.assignee,
            additionalAgentId: IDS.technician,
            assignedByUserId: IDS.user,
            suppressContactNotifications: true,
          }),
      },
      {
        site: 'shared/services/tickets/createTicketWithSideEffects.ts#createTicketWithSideEffects',
        ctx: scheduleUserCtx,
        build: () =>
          buildTicketAdditionalAgentAssignedPayload({
            ticketId: ticket.ticket_id!,
            primaryAgentId: IDS.assignee,
            additionalAgentId: IDS.technician,
          }),
      },
    ],
  },

  // ---------------- schedule entries ----------------
  SCHEDULE_ENTRY_CREATED: {
    status: 'covered',
    cases: [
      entryCase(`${SCHEDULING}/scheduleActions.ts#addScheduleEntry`, (changes) => buildScheduleEntryCreatedPayload({ ...entryParams, changes }), {
        after: { title: 'Site visit', work_item_type: 'ticket' },
      }),
      entryCase(`${SCHEDULING}/onlineMeetingSchedulingActions.ts#scheduleOnlineMeeting`, (changes) => buildScheduleEntryCreatedPayload({ ...entryParams, changes }), {
        after: { title: 'Kickoff call' },
      }),
      entryCase(`${SCHEDULING}/appointmentRequestManagementActions.ts#approveAppointmentRequest`, (changes) => buildScheduleEntryCreatedPayload({ ...entryParams, changes }), {
        after: { title: 'On-site visit' },
        appointmentRequestId: IDS.appointmentRequest,
      }),
      entryCase('packages/clients/src/actions/interactionCreateHelper.ts#createInteractionScheduleEntry', (changes) => buildScheduleEntryCreatedPayload({ ...entryParams, changes }), {
        after: { title: 'Follow-up call' },
      }),
      entryCase('server/src/lib/api/services/TimeSheetService.ts#createScheduleEntry', (changes) => buildScheduleEntryCreatedPayload({ ...entryParams, changes }), {
        after: { title: 'Maintenance window' },
      }),
      {
        site: 'packages/opportunities/src/lib/opportunitySteps.ts#publishScheduleEntryEventAfterCommit',
        ctx: scheduleUserCtx,
        build: () => buildScheduleEntryCreatedPayload(entryParams),
      },
    ],
  },
  SCHEDULE_ENTRY_UPDATED: {
    status: 'covered',
    cases: [
      entryCase(`${SCHEDULING}/scheduleActions.ts#updateScheduleEntry`, (changes) => buildScheduleEntryUpdatedPayload({ ...entryParams, changes }), {
        before: { title: 'Site visit' },
        after: { title: 'Site visit (rescheduled)' },
      }),
      entryCase(`${SCHEDULING}/calendarSharingActions.ts#updateSharedEntry`, (changes) => buildScheduleEntryUpdatedPayload({ ...entryParams, changes }), {
        before: { title: 'Sync' },
        after: { title: 'Sync (shared)' },
      }),
      entryCase(`${SCHEDULING}/appointmentRequestManagementActions.ts#approveAppointmentRequest`, (changes) => buildScheduleEntryUpdatedPayload({ ...entryParams, changes }), {
        before: { title: 'Request' },
        after: { title: 'Request (approved)' },
      }),
      entryCase('server/src/lib/api/services/TimeSheetService.ts#updateScheduleEntry', (changes) => buildScheduleEntryUpdatedPayload({ ...entryParams, changes }), {
        before: { title: 'Maintenance window' },
        after: { title: 'Maintenance window (extended)' },
      }),
      entryCase('packages/integrations/src/services/calendar/CalendarSyncService.ts#publishInboundEdit', (changes) => buildScheduleEntryUpdatedPayload({ ...entryParams, changes }), {
        before: { title: 'Sync' },
        after: { title: 'Sync (edited in calendar)' },
        source: 'calendar_sync',
      }),
      entryCase('ee/packages/calendar/src/lib/services/calendar/CalendarSyncService.ts#publishInboundEdit', (changes) => buildScheduleEntryUpdatedPayload({ ...entryParams, changes }), {
        before: { title: 'Sync' },
        after: { title: 'Sync (edited in calendar)' },
        source: 'calendar_sync',
      }),
      {
        site: 'packages/opportunities/src/lib/opportunitySteps.ts#publishScheduleEntryEventAfterCommit',
        ctx: scheduleUserCtx,
        build: () => buildScheduleEntryUpdatedPayload(entryParams),
      },
    ],
  },
  SCHEDULE_ENTRY_DELETED: {
    status: 'covered',
    cases: [
      entryCase(`${SCHEDULING}/scheduleActions.ts#deleteScheduleEntry`, (changes) => buildScheduleEntryDeletedPayload({ ...entryParams, changes }), {
        before: { title: 'Site visit' },
      }),
      entryCase('server/src/lib/api/services/TimeSheetService.ts#deleteScheduleEntry', (changes) => buildScheduleEntryDeletedPayload({ ...entryParams, changes }), {
        before: { title: 'Maintenance window' },
      }),
      {
        site: 'packages/opportunities/src/lib/opportunitySteps.ts#publishScheduleEntryEventAfterCommit',
        ctx: scheduleUserCtx,
        build: () => buildScheduleEntryDeletedPayload(entryParams),
      },
    ],
  },

  // ---------------- appointment requests ----------------
  APPOINTMENT_REQUEST_CREATED: {
    status: 'no-product-emitter',
    ticket: NO_EMITTER_UMBRELLA_TICKET,
    reason: NO_EMITTER_APPOINTMENT_REASON,
  },
  APPOINTMENT_REQUEST_CANCELLED: {
    status: 'no-product-emitter',
    ticket: NO_EMITTER_UMBRELLA_TICKET,
    reason: NO_EMITTER_APPOINTMENT_REASON,
  },
  APPOINTMENT_REQUEST_APPROVED: {
    status: 'covered',
    cases: [
      {
        site: `${SCHEDULING}/appointmentRequestManagementActions.ts#approveAppointmentRequest`,
        ctx: scheduleUserCtx,
        build: () => buildAppointmentRequestApprovedPayload(APPOINTMENT_REQUEST_PARAMS),
      },
    ],
  },
  APPOINTMENT_REQUEST_DECLINED: {
    status: 'covered',
    cases: [
      {
        site: `${SCHEDULING}/appointmentRequestManagementActions.ts#declineAppointmentRequest`,
        ctx: scheduleUserCtx,
        build: () =>
          buildAppointmentRequestDeclinedPayload({
            ...APPOINTMENT_REQUEST_PARAMS,
            assignedUserId: null,
            scheduleEntryId: null,
            declineReason: 'No technician available that day',
          }),
      },
    ],
  },

  // ---------------- projects ----------------
  PROJECT_ASSIGNED: {
    status: 'covered',
    cases: [
      {
        site: `${PROJECT_ACTIONS}/projectActions.ts#updateProject`,
        ctx: taskUserCtx,
        build: () => buildProjectAssignedPayload({ projectId: IDS.project, assignedToId: IDS.assignee, assignedByUserId: IDS.user }),
      },
      {
        site: 'server/src/lib/api/services/ProjectService.ts#update',
        ctx: taskUserCtx,
        build: () =>
          buildProjectAssignedPayload({ projectId: IDS.project, assignedToId: IDS.assignee, assignedByUserId: IDS.user, assignedAt: NOW }),
      },
    ],
  },
  PROJECT_CLOSED: {
    status: 'covered',
    cases: [
      {
        site: `${PROJECT_ACTIONS}/projectActions.ts#updateProjectStatus`,
        ctx: taskUserCtx,
        build: () =>
          buildProjectClosedPayload({ projectId: IDS.project, closedByUserId: IDS.user, statusChanges: { is_closed: true } }),
      },
    ],
  },
  PROJECT_TASK_UPDATED: {
    status: 'covered',
    cases: [
      {
        site: `${PROJECT_ACTIONS}/projectTaskActions.ts#updateTaskWithChecklist`,
        ctx: taskUserCtx,
        build: () =>
          buildProjectTaskUpdatedPayload({
            projectId: IDS.project,
            phaseId: IDS.phase,
            taskId: IDS.task,
            userId: IDS.user,
            updatedAt: NOW,
            changes: taskChanges,
          }),
      },
      {
        site: `${PROJECT_ACTIONS}/projectTaskActions.ts#moveTaskToPhase`,
        ctx: taskUserCtx,
        build: () =>
          buildProjectTaskUpdatedPayload({
            projectId: IDS.project,
            phaseId: IDS.phase,
            taskId: IDS.task,
            userId: IDS.user,
            changes: { phase_id: { previous: IDS.phase, new: IDS.taskStatusMapping } },
          }),
      },
      {
        site: 'packages/tags/src/actions/tagActions.ts#publishTagChangeEvent',
        ctx: { ...taskUserCtx, occurredAt: NOW },
        build: () =>
          buildProjectTaskUpdatedPayload({
            projectId: IDS.project,
            phaseId: IDS.phase,
            taskId: IDS.task,
            userId: IDS.user,
            updatedAt: NOW,
            changes: { tags: { previous: [], new: ['urgent'] } },
          }),
      },
    ],
  },
  PROJECT_TASK_ADDITIONAL_AGENT_ASSIGNED: {
    status: 'covered',
    cases: [
      {
        site: `${PROJECT_ACTIONS}/projectTaskActions.ts#addTaskResourceAction`,
        ctx: taskUserCtx,
        build: () =>
          buildProjectTaskAdditionalAgentAssignedPayload({
            projectId: IDS.project,
            taskId: IDS.task,
            primaryAgentId: IDS.assignee,
            additionalAgentId: IDS.technician,
            assignedByUserId: IDS.user,
          }),
      },
      {
        site: `${PROJECT_ACTIONS}/projectTaskActions.ts#addTaskResourcesAction`,
        ctx: taskUserCtx,
        build: () =>
          buildProjectTaskAdditionalAgentAssignedPayload({
            projectId: IDS.project,
            taskId: IDS.task,
            primaryAgentId: IDS.assignee,
            additionalAgentId: IDS.technician,
            assignedByUserId: IDS.user,
          }),
      },
    ],
  },
  TASK_COMMENT_ADDED: {
    status: 'covered',
    cases: [
      {
        site: 'packages/projects/src/lib/taskComments/taskCommentService.ts#createTaskComment',
        ctx: taskUserCtx,
        expectFields: ['taskCommentId'],
        build: () =>
          buildTaskCommentAddedPayload({
            projectId: IDS.project,
            taskId: IDS.task,
            taskCommentId: IDS.taskComment,
            createdByUserId: IDS.user,
            taskName: 'Install racks',
            commentContent: '[{"type":"paragraph","content":[{"type":"text","text":"Racks delivered"}]}]',
            threadId: IDS.taskComment,
            parentCommentId: null,
            isReply: false,
          }),
      },
    ],
  },
  TASK_COMMENT_UPDATED: {
    status: 'covered',
    cases: [
      {
        site: 'packages/projects/src/lib/taskComments/taskCommentService.ts#updateTaskComment',
        ctx: taskUserCtx,
        expectFields: ['taskCommentId'],
        build: () =>
          buildTaskCommentUpdatedPayload({
            projectId: IDS.project,
            taskId: IDS.task,
            taskCommentId: IDS.taskComment,
            updatedByUserId: IDS.user,
            taskName: 'Install racks',
            oldCommentContent: '[{"type":"paragraph","content":[{"type":"text","text":"Racks delivered"}]}]',
            newCommentContent: '[{"type":"paragraph","content":[{"type":"text","text":"Racks delivered and mounted"}]}]',
          }),
      },
    ],
  },

  // ---------------- time entries ----------------
  TIME_ENTRY_SUBMITTED: {
    status: 'covered',
    cases: [
      {
        site: TIME_ENTRY_ACTIONS,
        ctx: taskUserCtx,
        build: () => buildTimeEntrySubmittedPayload(timeEntryParams),
      },
      {
        site: TIME_ENTRY_ACTIONS,
        ctx: taskUserCtx,
        build: () => buildTimeEntrySubmittedPayload({ ...timeEntryParams, workItemId: IDS.task, workItemType: 'PROJECT_TASK' }),
      },
    ],
  },
  TIME_ENTRY_APPROVED: {
    status: 'covered',
    cases: [
      {
        site: TIME_ENTRY_ACTIONS,
        ctx: taskUserCtx,
        build: () => buildTimeEntryApprovedPayload({ ...timeEntryParams, approvedBy: IDS.assignee }),
      },
      {
        site: 'server/src/lib/api/services/TimeEntryService.ts#approveTimeEntries',
        ctx: { actor: { actorType: 'USER' as const, actorUserId: IDS.assignee } },
        build: () => buildTimeEntryApprovedPayload({ ...timeEntryParams, approvedBy: IDS.assignee }),
      },
    ],
  },
} satisfies Partial<EmitterContracts>;
