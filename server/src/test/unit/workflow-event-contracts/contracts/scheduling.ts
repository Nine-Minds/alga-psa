import {
  buildAppointmentAssignedPayload,
  buildAppointmentCanceledPayload,
  buildAppointmentCompletedPayload,
  buildAppointmentCreatedPayload,
  buildAppointmentNoShowPayload,
  buildAppointmentRescheduledPayload,
  buildCapacityThresholdReachedPayload,
  buildScheduleBlockCreatedPayload,
  buildScheduleBlockDeletedPayload,
  buildTechnicianArrivedPayload,
  buildTechnicianCheckedOutPayload,
  buildTechnicianDispatchedPayload,
  buildTechnicianEnRoutePayload,
} from '@alga-psa/workflow-streams';
import type { EmitterContracts } from '../registryTypes';
import { IDS, NOW, EARLIER, ticket } from '../fixtures';

/**
 * Scheduling / dispatch. Every builder already existed in domainEventBuilders and every product
 * site already used it with publishWorkflowEvent, so nothing needed extracting; this domain only
 * needed contract cases. Cases mirror each builder branch the sites reach (with/without ticket,
 * with/without previous assignee, ...).
 */

const SCHEDULE = 'packages/scheduling/src/actions/scheduleActions.ts';
const APPT_MGMT = 'packages/scheduling/src/actions/appointmentRequestManagementActions.ts';
const PORTAL = 'packages/client-portal/src/actions/client-portal-actions/appointmentRequestActions.ts';
const CAPACITY = 'packages/scheduling/src/lib/capacityThresholdWorkflowEvents.ts';

type SchedulingEventType =
  | 'APPOINTMENT_CREATED'
  | 'APPOINTMENT_ASSIGNED'
  | 'APPOINTMENT_RESCHEDULED'
  | 'APPOINTMENT_CANCELED'
  | 'APPOINTMENT_COMPLETED'
  | 'APPOINTMENT_NO_SHOW'
  | 'CAPACITY_THRESHOLD_REACHED'
  | 'SCHEDULE_BLOCK_CREATED'
  | 'SCHEDULE_BLOCK_DELETED'
  | 'TECHNICIAN_DISPATCHED'
  | 'TECHNICIAN_EN_ROUTE'
  | 'TECHNICIAN_ARRIVED'
  | 'TECHNICIAN_CHECKED_OUT';

const START = new Date('2026-07-17T14:00:00.000Z');
const END = new Date('2026-07-17T15:30:00.000Z');
const MOVED_START = new Date('2026-07-18T09:00:00.000Z');
const MOVED_END = new Date('2026-07-18T10:30:00.000Z');

const ticketEntry = {
  entry_id: IDS.scheduleEntry,
  work_item_type: 'ticket' as const,
  work_item_id: ticket.ticket_id,
  status: 'scheduled',
  scheduled_start: START,
  scheduled_end: END,
  assigned_user_ids: [IDS.assignee],
  created_at: new Date(EARLIER),
};
const requestEntry = {
  ...ticketEntry,
  work_item_type: 'appointment_request' as const,
  work_item_id: 'a0a0a0a0-0000-4000-8000-000000000009',
};
const privateBlock = {
  entry_id: IDS.scheduleEntry,
  work_item_type: 'ad_hoc' as const,
  work_item_id: null,
  is_private: true,
  title: 'Busy',
  notes: 'Dentist',
  scheduled_start: START,
  scheduled_end: END,
  assigned_user_ids: [IDS.user],
  created_at: new Date(EARLIER),
};

const tid = ticket.ticket_id;
const apptId = IDS.scheduleEntry;

export const schedulingContracts = {
  APPOINTMENT_CREATED: {
    status: 'covered',
    cases: [
      {
        site: `${SCHEDULE}#createScheduleEntry`,
        build: () =>
          buildAppointmentCreatedPayload({ entry: ticketEntry, ticketId: tid, timezone: 'UTC', createdByUserId: IDS.user }),
      },
      {
        site: `${APPT_MGMT}#approveAppointmentRequest`,
        build: () =>
          buildAppointmentCreatedPayload({ entry: requestEntry, ticketId: tid, timezone: 'UTC', createdByUserId: IDS.user }),
      },
      {
        site: `${PORTAL}#createAppointmentRequest`,
        ctx: { actor: { actorType: 'CONTACT', actorContactId: IDS.contact } },
        build: () =>
          buildAppointmentCreatedPayload({
            entry: { ...requestEntry, assigned_user_ids: [] },
            timezone: 'UTC',
          }),
      },
    ],
  },
  APPOINTMENT_ASSIGNED: {
    status: 'covered',
    cases: [
      {
        site: `${SCHEDULE}#createScheduleEntry`,
        build: () => buildAppointmentAssignedPayload({ appointmentId: apptId, ticketId: tid, newAssigneeId: IDS.assignee }),
      },
      {
        site: `${SCHEDULE}#updateScheduleEntry`,
        build: () =>
          buildAppointmentAssignedPayload({
            appointmentId: apptId,
            ticketId: tid,
            previousAssigneeId: IDS.previousAssignee,
            newAssigneeId: IDS.assignee,
          }),
      },
      {
        site: `${APPT_MGMT}#approveAppointmentRequest`,
        build: () =>
          buildAppointmentAssignedPayload({
            appointmentId: apptId,
            ticketId: tid,
            previousAssigneeId: IDS.previousAssignee,
            newAssigneeId: IDS.assignee,
          }),
      },
      {
        site: `${PORTAL}#createAppointmentRequest`,
        ctx: { actor: { actorType: 'CONTACT', actorContactId: IDS.contact } },
        build: () => buildAppointmentAssignedPayload({ appointmentId: apptId, newAssigneeId: IDS.assignee }),
      },
      {
        site: `${PORTAL}#updateAppointmentRequest`,
        ctx: { actor: { actorType: 'CONTACT', actorContactId: IDS.contact } },
        build: () =>
          buildAppointmentAssignedPayload({
            appointmentId: apptId,
            ticketId: tid,
            previousAssigneeId: IDS.previousAssignee,
            newAssigneeId: IDS.assignee,
          }),
      },
      {
        site: 'shared/workflow/runtime/actions/businessOperations/scheduling.ts#registerSchedulingActions',
        build: () =>
          buildAppointmentAssignedPayload({ appointmentId: apptId, previousAssigneeId: IDS.previousAssignee, newAssigneeId: IDS.assignee }),
      },
    ],
  },
  APPOINTMENT_RESCHEDULED: {
    status: 'covered',
    cases: [
      {
        site: `${SCHEDULE}#updateScheduleEntry`,
        build: () =>
          buildAppointmentRescheduledPayload({
            before: ticketEntry,
            after: { ...ticketEntry, scheduled_start: MOVED_START, scheduled_end: MOVED_END },
            ticketId: tid,
            timezone: 'UTC',
          }),
      },
      {
        site: `${PORTAL}#updateAppointmentRequest`,
        ctx: { actor: { actorType: 'CONTACT', actorContactId: IDS.contact } },
        build: () =>
          buildAppointmentRescheduledPayload({
            before: { entry_id: apptId, scheduled_start: START, scheduled_end: END },
            after: { entry_id: apptId, scheduled_start: MOVED_START, scheduled_end: MOVED_END },
            timezone: 'UTC',
          }),
      },
      {
        site: 'shared/workflow/runtime/actions/businessOperations/scheduling.ts#registerSchedulingActions',
        build: () =>
          buildAppointmentRescheduledPayload({
            before: ticketEntry,
            after: { ...ticketEntry, scheduled_start: MOVED_START, scheduled_end: MOVED_END },
            timezone: 'UTC',
          }),
      },
    ],
  },
  APPOINTMENT_CANCELED: {
    status: 'covered',
    cases: [
      {
        site: `${SCHEDULE}#updateScheduleEntry`,
        build: () => buildAppointmentCanceledPayload({ appointmentId: apptId, ticketId: tid }),
      },
      {
        site: `${SCHEDULE}#deleteScheduleEntry`,
        build: () => buildAppointmentCanceledPayload({ appointmentId: apptId, ticketId: tid, reason: 'Deleted' }),
      },
      {
        site: `${PORTAL}#cancelAppointmentRequest`,
        ctx: { actor: { actorType: 'CONTACT', actorContactId: IDS.contact } },
        build: () => buildAppointmentCanceledPayload({ appointmentId: apptId, reason: 'Cancelled by client' }),
      },
      {
        site: 'shared/workflow/runtime/actions/businessOperations/scheduling.ts#registerSchedulingActions',
        build: () => buildAppointmentCanceledPayload({ appointmentId: apptId }),
      },
    ],
  },
  APPOINTMENT_COMPLETED: {
    status: 'covered',
    cases: [
      {
        site: `${SCHEDULE}#updateScheduleEntry`,
        build: () => buildAppointmentCompletedPayload({ appointmentId: apptId, ticketId: tid }),
      },
      {
        site: 'shared/workflow/runtime/actions/businessOperations/scheduling.ts#registerSchedulingActions',
        build: () => buildAppointmentCompletedPayload({ appointmentId: apptId, outcome: 'Resolved on site' }),
      },
    ],
  },
  APPOINTMENT_NO_SHOW: {
    status: 'covered',
    cases: [
      {
        site: `${SCHEDULE}#updateScheduleEntry`,
        build: () => buildAppointmentNoShowPayload({ appointmentId: apptId, ticketId: tid, party: 'customer' }),
      },
    ],
  },
  CAPACITY_THRESHOLD_REACHED: {
    status: 'covered',
    cases: [
      {
        site: `${CAPACITY}#maybePublishCapacityThresholdReached`,
        build: () =>
          buildCapacityThresholdReachedPayload({
            teamId: IDS.team,
            date: '2026-07-17',
            capacityLimit: 40,
            currentBooked: 34.5,
            triggeredAt: NOW,
          }),
      },
    ],
  },
  SCHEDULE_BLOCK_CREATED: {
    status: 'covered',
    cases: [
      {
        site: `${SCHEDULE}#createScheduleEntry`,
        build: () => buildScheduleBlockCreatedPayload({ entry: privateBlock, timezone: 'UTC' }),
      },
      {
        site: `${SCHEDULE}#updateScheduleEntry`,
        build: () => buildScheduleBlockCreatedPayload({ entry: { ...privateBlock, title: 'Vendor visit' }, timezone: 'UTC' }),
      },
    ],
  },
  SCHEDULE_BLOCK_DELETED: {
    status: 'covered',
    cases: [
      {
        site: `${SCHEDULE}#updateScheduleEntry`,
        build: () =>
          buildScheduleBlockDeletedPayload({ scheduleBlockId: apptId, reason: 'No longer private ad-hoc block' }),
      },
      {
        site: `${SCHEDULE}#deleteScheduleEntry`,
        build: () => buildScheduleBlockDeletedPayload({ scheduleBlockId: apptId, reason: 'Deleted' }),
      },
    ],
  },
  TECHNICIAN_DISPATCHED: {
    status: 'covered',
    cases: [
      {
        site: `${SCHEDULE}#createScheduleEntry`,
        build: () =>
          buildTechnicianDispatchedPayload({
            appointmentId: apptId,
            ticketId: tid,
            technicianUserId: IDS.technician,
            dispatchedByUserId: IDS.user,
          }),
      },
      {
        site: `${SCHEDULE}#updateScheduleEntry`,
        build: () => buildTechnicianDispatchedPayload({ appointmentId: apptId, technicianUserId: IDS.technician }),
      },
    ],
  },
  TECHNICIAN_EN_ROUTE: {
    status: 'covered',
    cases: [
      {
        site: `${SCHEDULE}#updateScheduleEntry`,
        build: () =>
          buildTechnicianEnRoutePayload({ appointmentId: apptId, ticketId: tid, technicianUserId: IDS.technician }),
      },
    ],
  },
  TECHNICIAN_ARRIVED: {
    status: 'covered',
    cases: [
      {
        site: `${SCHEDULE}#updateScheduleEntry`,
        build: () =>
          buildTechnicianArrivedPayload({ appointmentId: apptId, ticketId: tid, technicianUserId: IDS.technician }),
      },
    ],
  },
  TECHNICIAN_CHECKED_OUT: {
    status: 'covered',
    cases: [
      {
        site: `${SCHEDULE}#updateScheduleEntry`,
        build: () =>
          buildTechnicianCheckedOutPayload({ appointmentId: apptId, ticketId: tid, technicianUserId: IDS.technician }),
      },
    ],
  },
} satisfies Pick<EmitterContracts, SchedulingEventType>;
