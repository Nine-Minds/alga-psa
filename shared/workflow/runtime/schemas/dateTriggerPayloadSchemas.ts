import { z } from 'zod';
import { withWorkflowPicker } from '../jsonSchemaMetadata';
import { dateOnlySchema } from './commonEventPayloadSchemas';
import { dateTriggerSourceDefinitions, type DateTriggerPayloadSchemaRefs } from '../dateTriggerSourceDefinitions';

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
