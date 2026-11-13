import { z } from 'zod';
import { withWorkflowPicker } from '../../jsonSchemaMetadata';
import { dateOnlySchema, ticketRecurrenceSchema } from './commonEventPayloadSchemas';
import { dateTriggerSourceDefinitions, type DateTriggerPayloadSchemaRefs } from './dateTriggerSourceDefinitions';

const date = dateOnlySchema('Calendar date (YYYY-MM-DD)');
// Entity ids are marked with their kind so the Run dialog and designer offer pickers. The contract
// picker narrows to the payload's client.
const clientId = withWorkflowPicker(z.string(), 'Client', 'client');
const contractId = withWorkflowPicker(z.string(), 'Contract', 'contract', ['clientId']);
const assetId = withWorkflowPicker(z.string(), 'Asset', 'asset');
const ticketId = withWorkflowPicker(z.string(), 'Ticket', 'ticket');
const ticketStatusId = withWorkflowPicker(z.string(), 'Status', 'ticket-status');
const boardId = withWorkflowPicker(z.string(), 'Board', 'board');
const contactId = withWorkflowPicker(z.string(), 'Contact', 'contact');
const assignedUserId = withWorkflowPicker(z.string(), 'Assigned user', 'user');
const common = { occursOn: date, fireDate: date, offsetDays: z.number().int().min(-365).max(365), clientId: clientId.optional(), clientName: z.string().optional() };
export const dateTriggerPayloadSchemas = {
  'payload.ClientAnniversary.v1': z.object({ ...common, clientId, clientName: z.string(), yearsAsClient: z.number().int().positive(), anniversarySource: z.enum(['client_since', 'created_at']) }).passthrough(),
  'payload.ContractRenewalDate.v1': z.object({ ...common, contractId, clientId, renewalMode: z.string().optional(), renewalCycleKey: z.string().optional() }).passthrough(),
  'payload.ContractEndDate.v1': z.object({ ...common, contractId, clientId, endDate: dateOnlySchema('Contract end date (YYYY-MM-DD)') }).passthrough(),
  'payload.AssetWarrantyEnd.v1': z.object({ ...common, assetId, warrantyEndDate: dateOnlySchema('Warranty end date (YYYY-MM-DD)') }).passthrough(),
  // The open occurrence drives it: its id is unique per maintenance cycle, so a workflow can dedup
  // and later link a ticket back to the occurrence it was created for.
  'payload.AssetMaintenanceDue.v1': z.object({
    ...common,
    occurrenceId: z.string(),
    scheduleId: z.string(),
    assetId,
    scheduleName: z.string().optional(),
    assetName: z.string().optional(),
    maintenanceType: z.string().optional(),
    dueDate: dateOnlySchema('Maintenance due date (YYYY-MM-DD)'),
  }).passthrough(),
  // `ticket.due_date` carries everything a reminder step needs, like `ticket.status_age`. A recurring
  // schedule's occurrence is reported from its schedule before the generator creates the ticket (so an
  // early reminder does not depend on lead_days); then `ticketExists` is false and the ticket fields are
  // absent. Once the ticket exists the same occurrence keeps its fire key, so it never fires twice.
  'payload.TicketDueDate.v1': z.object({
    ...common,
    ticketExists: z.boolean().describe('False when the reminder fires for a scheduled recurring ticket that has not been created yet'),
    ticketId: ticketId.optional(),
    ticketNumber: z.string().optional(),
    title: z.string().optional(),
    dueDate: dateOnlySchema('Due date in the tenant timezone (YYYY-MM-DD)'),
    dueAt: z.string().describe('Due date and time (ISO 8601 timestamp)'),
    statusId: ticketStatusId.optional(),
    statusName: z.string().optional(),
    boardId: boardId.optional(),
    boardName: z.string().optional(),
    priorityId: withWorkflowPicker(z.string(), 'Priority', 'ticket-priority').optional(),
    contactId: contactId.optional(),
    assignedUserId: assignedUserId.optional(),
    ticketOrigin: z.string().describe('Where the ticket came from (recurring for schedule-generated tickets)'),
    recurrence: ticketRecurrenceSchema.extend({
      occurrenceId: z.string().optional().describe('Recurring occurrence ID; absent until the schedule first tries to create the ticket'),
      definitionClientId: z.string().describe('The schedule\'s row for this client'),
      definitionName: z.string().optional().describe('Recurring schedule name'),
    }).optional(),
  }).passthrough(),
  // `ticket.status_age` carries everything a follow-up step needs (contact, assignee, board, status),
  // so a workflow never has to look the ticket up again.
  'payload.TicketStatusAge.v1': z.object({
    ...common,
    ticketId,
    ticketNumber: z.string(),
    title: z.string(),
    statusId: ticketStatusId,
    statusName: z.string(),
    boardId,
    boardName: z.string(),
    contactId: contactId.optional(),
    assignedUserId: assignedUserId.optional(),
    enteredStatusAt: z.string().describe('When the ticket entered its current status (ISO 8601 timestamp)'),
    daysInStatus: z.number().int().min(0).describe('Whole days the ticket has been in the status'),
    repeatIndex: z.number().int().min(0).describe('0 for the first firing, 1 for the next repeat, and so on'),
  }).passthrough(),
} as const;

// Date trigger sources: the fixed set of dates a `date` workflow trigger can fire on. The list itself
// lives in ../dateTriggerSourceDefinitions.ts; this file holds each source's payload schema, and the
// id-to-ref map is derived from that list.
export const dateTriggerPayloadSchemaRefs = Object.fromEntries(
  dateTriggerSourceDefinitions.map((definition) => [definition.id, definition.payloadSchemaRef])
) as DateTriggerPayloadSchemaRefs;
