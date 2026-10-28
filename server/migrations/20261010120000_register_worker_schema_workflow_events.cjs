'use strict';

/**
 * Registers the workflow events that the workflow worker already had payload schemas for
 * (`payload.<Name>.v1` in the canonical workflowEventPayloadSchemas map) but that were never
 * given a `system_event_catalog` row, so no workflow could trigger on them and their
 * emitters were outside the emitter/schema contract.
 *
 * Mirrors WORKFLOW_EVENT_CATALOG in packages/event-schemas/src/workflowEventCatalog.ts; the
 * integration-lane parity test (server/src/test/infrastructure/workflowEventCatalogParity.test.ts)
 * keeps the two in step.
 */

const EVENTS = [
  ['TICKET_COMMENT_ADDED', 'Ticket Comment Added', 'A comment (public or internal) is added to a ticket.', 'Tickets', 'payload.TicketCommentAdded.v1'],
  ['TICKET_ADDITIONAL_AGENT_ASSIGNED', 'Ticket Additional Agent Assigned', 'An additional agent is assigned to a ticket.', 'Tickets', 'payload.TicketAdditionalAgentAssigned.v1'],
  ['APPOINTMENT_REQUEST_CREATED', 'Appointment Request Created', 'A client or visitor requests an appointment.', 'Scheduling', 'payload.AppointmentRequestCreated.v1'],
  ['APPOINTMENT_REQUEST_APPROVED', 'Appointment Request Approved', 'An appointment request is approved.', 'Scheduling', 'payload.AppointmentRequestApproved.v1'],
  ['APPOINTMENT_REQUEST_DECLINED', 'Appointment Request Declined', 'An appointment request is declined.', 'Scheduling', 'payload.AppointmentRequestDeclined.v1'],
  ['APPOINTMENT_REQUEST_CANCELLED', 'Appointment Request Cancelled', 'An appointment request is cancelled by the requester.', 'Scheduling', 'payload.AppointmentRequestCancelled.v1'],
  ['SCHEDULE_ENTRY_CREATED', 'Schedule Entry Created', 'An entry is added to a technician schedule.', 'Scheduling', 'payload.ScheduleEntryCreated.v1'],
  ['SCHEDULE_ENTRY_UPDATED', 'Schedule Entry Updated', 'A technician schedule entry is changed.', 'Scheduling', 'payload.ScheduleEntryUpdated.v1'],
  ['SCHEDULE_ENTRY_DELETED', 'Schedule Entry Deleted', 'A technician schedule entry is removed.', 'Scheduling', 'payload.ScheduleEntryDeleted.v1'],
  ['PROJECT_ASSIGNED', 'Project Assigned', 'A project is assigned to a user.', 'Projects', 'payload.ProjectAssigned.v1'],
  ['PROJECT_CLOSED', 'Project Closed', 'A project is closed.', 'Projects', 'payload.ProjectClosed.v1'],
  ['PROJECT_TASK_UPDATED', 'Project Task Updated', 'A project task is edited.', 'Projects', 'payload.ProjectTaskUpdated.v1'],
  ['PROJECT_TASK_ADDITIONAL_AGENT_ASSIGNED', 'Project Task Additional Agent Assigned', 'An additional agent is assigned to a project task.', 'Projects', 'payload.ProjectTaskAdditionalAgentAssigned.v1'],
  ['TASK_COMMENT_ADDED', 'Task Comment Added', 'A comment is added to a project task.', 'Projects', 'payload.TaskCommentAdded.v1'],
  ['TASK_COMMENT_UPDATED', 'Task Comment Updated', 'A project task comment is edited.', 'Projects', 'payload.TaskCommentUpdated.v1'],
  ['TIME_ENTRY_SUBMITTED', 'Time Entry Submitted', 'A time entry is submitted for approval.', 'Time Management', 'payload.TimeEntrySubmitted.v1'],
  ['TIME_ENTRY_APPROVED', 'Time Entry Approved', 'A submitted time entry is approved.', 'Time Management', 'payload.TimeEntryApproved.v1'],
];

exports.up = async function up(knex) {
  if (!(await knex.schema.hasTable('system_event_catalog'))) return;

  // Literal timestamp: Citus rejects non-IMMUTABLE functions in ON CONFLICT DO UPDATE SET.
  const now = new Date().toISOString();

  for (const [eventType, name, description, category, payloadSchemaRef] of EVENTS) {
    await knex.raw(
      `
      INSERT INTO system_event_catalog (event_id, event_type, name, description, category, payload_schema_ref, created_at, updated_at)
      VALUES (gen_random_uuid(), ?, ?, ?, ?, ?, ?::timestamptz, ?::timestamptz)
      ON CONFLICT (event_type) DO UPDATE SET
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        category = EXCLUDED.category,
        payload_schema_ref = EXCLUDED.payload_schema_ref,
        updated_at = ?::timestamptz
    `,
      [eventType, name, description, category, payloadSchemaRef, now, now, now],
    );
  }
};

exports.down = async function down(knex) {
  if (!(await knex.schema.hasTable('system_event_catalog'))) return;
  await knex('system_event_catalog').whereIn('event_type', EVENTS.map(([eventType]) => eventType)).del();
};
