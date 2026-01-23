import { z } from 'zod';
import {
  BaseDomainEventPayloadSchema,
  changesSchema,
  updatedFieldsSchema,
  uuidSchema,
} from './commonEventPayloadSchemas';

/**
 * Ticket event payloads for workflow runtime v2 simulation and validation.
 *
 * Notes:
 * - Payloads follow PRD conventions: tenantId + occurredAt required; actor fields optional.
 * - These are intentionally higher-level and stable; they can be expanded/versioned as needed.
 */

const ticketIdSchema = uuidSchema('Ticket ID');
const userIdSchema = uuidSchema('User ID');
const contactIdSchema = uuidSchema('Contact ID');
const messageIdSchema = uuidSchema('Message ID');
const noteIdSchema = uuidSchema('Note ID');
const timeEntryIdSchema = uuidSchema('Time Entry ID');
const assigneeTypeSchema = z.enum(['user', 'team']).describe('Assignee type');

export const ticketCreatedEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  ticketId: ticketIdSchema,
  createdByUserId: userIdSchema.optional().describe('User who created the ticket'),
  actorUserId: userIdSchema.optional().describe('Actor User ID (preferred)'),
  createdAt: z.string().optional().describe('Created timestamp (ISO 8601)'),
  updatedFields: updatedFieldsSchema,
  changes: changesSchema,
}).describe('Payload for TICKET_CREATED');

export type TicketCreatedEventPayload = z.infer<typeof ticketCreatedEventPayloadSchema>;

export const ticketAssignedEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  ticketId: ticketIdSchema,
  assignedToUserId: userIdSchema.optional().describe('Deprecated: user assigned to the ticket'),
  assignedByUserId: userIdSchema.optional().describe('User who performed the assignment'),
  previousAssigneeId: z.string().uuid().optional(),
  previousAssigneeType: assigneeTypeSchema.optional(),
  newAssigneeId: z.string().uuid().optional(),
  newAssigneeType: assigneeTypeSchema.optional(),
  assignedAt: z.string().optional().describe('Assigned timestamp (ISO 8601)'),
  updatedFields: updatedFieldsSchema,
  changes: changesSchema,
}).describe('Payload for TICKET_ASSIGNED');

export type TicketAssignedEventPayload = z.infer<typeof ticketAssignedEventPayloadSchema>;

export const ticketClosedEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  ticketId: ticketIdSchema,
  closedByUserId: userIdSchema.optional().describe('User who closed the ticket'),
  closedAt: z.string().optional().describe('Closed timestamp (ISO 8601)'),
  reason: z.string().optional().describe('Optional close reason'),
  updatedFields: updatedFieldsSchema,
  changes: changesSchema,
}).describe('Payload for TICKET_CLOSED');

export type TicketClosedEventPayload = z.infer<typeof ticketClosedEventPayloadSchema>;

export const ticketUpdatedEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  ticketId: ticketIdSchema,
  updatedByUserId: userIdSchema.optional().describe('User who updated the ticket'),
  updatedFields: updatedFieldsSchema,
  changes: changesSchema,
}).describe('Payload for TICKET_UPDATED');

export type TicketUpdatedEventPayload = z.infer<typeof ticketUpdatedEventPayloadSchema>;

export const ticketResponseStateChangedEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  ticketId: ticketIdSchema,
  previousResponseState: z.string().optional().describe('Previous response state'),
  newResponseState: z.string().optional().describe('New response state'),
}).describe('Payload for TICKET_RESPONSE_STATE_CHANGED');

export type TicketResponseStateChangedEventPayload = z.infer<
  typeof ticketResponseStateChangedEventPayloadSchema
>;

export const ticketStatusChangedEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  ticketId: ticketIdSchema,
  previousStatusId: z.string().min(1).describe('Previous status ID'),
  newStatusId: z.string().min(1).describe('New status ID'),
  reason: z.string().optional(),
  changedAt: z.string().datetime().optional().describe('Timestamp when status changed (ISO 8601)'),
}).describe('Payload for TICKET_STATUS_CHANGED');

export type TicketStatusChangedEventPayload = z.infer<typeof ticketStatusChangedEventPayloadSchema>;

export const ticketPriorityChangedEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  ticketId: ticketIdSchema,
  previousPriorityId: z.string().min(1).describe('Previous priority ID'),
  newPriorityId: z.string().min(1).describe('New priority ID'),
  reason: z.string().optional(),
  changedAt: z.string().datetime().optional().describe('Timestamp when priority changed (ISO 8601)'),
}).describe('Payload for TICKET_PRIORITY_CHANGED');

export type TicketPriorityChangedEventPayload = z.infer<typeof ticketPriorityChangedEventPayloadSchema>;

export const ticketUnassignedEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  ticketId: ticketIdSchema,
  previousAssigneeId: z.string().uuid().describe('Previous assignee ID'),
  previousAssigneeType: assigneeTypeSchema.describe('Previous assignee type'),
  unassignedAt: z.string().datetime().optional(),
  reason: z.string().optional(),
}).describe('Payload for TICKET_UNASSIGNED');

export type TicketUnassignedEventPayload = z.infer<typeof ticketUnassignedEventPayloadSchema>;

export const ticketReopenedEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  ticketId: ticketIdSchema,
  previousStatusId: z.string().min(1).describe('Previous status ID'),
  newStatusId: z.string().min(1).describe('New status ID'),
  reopenedAt: z.string().datetime().optional(),
  reason: z.string().optional(),
}).describe('Payload for TICKET_REOPENED');

export type TicketReopenedEventPayload = z.infer<typeof ticketReopenedEventPayloadSchema>;

export const ticketMergedEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  sourceTicketId: ticketIdSchema.describe('Source ticket ID'),
  targetTicketId: ticketIdSchema.describe('Target ticket ID'),
  mergedAt: z.string().datetime().optional(),
  reason: z.string().optional(),
}).describe('Payload for TICKET_MERGED');

export type TicketMergedEventPayload = z.infer<typeof ticketMergedEventPayloadSchema>;

export const ticketSplitEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  originalTicketId: ticketIdSchema.describe('Original ticket ID'),
  newTicketIds: z.array(ticketIdSchema).min(1).describe('New ticket IDs'),
  splitAt: z.string().datetime().optional(),
  reason: z.string().optional(),
}).describe('Payload for TICKET_SPLIT');

export type TicketSplitEventPayload = z.infer<typeof ticketSplitEventPayloadSchema>;

export const ticketTagsChangedEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  ticketId: ticketIdSchema,
  addedTagIds: z.array(z.string().uuid()).optional(),
  removedTagIds: z.array(z.string().uuid()).optional(),
  changedAt: z.string().datetime().optional(),
}).describe('Payload for TICKET_TAGS_CHANGED');

export type TicketTagsChangedEventPayload = z.infer<typeof ticketTagsChangedEventPayloadSchema>;

export const ticketQueueChangedEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  ticketId: ticketIdSchema,
  previousBoardId: z.string().uuid().optional(),
  newBoardId: z.string().uuid().optional(),
  changedAt: z.string().datetime().optional(),
}).describe('Payload for TICKET_QUEUE_CHANGED');

export type TicketQueueChangedEventPayload = z.infer<typeof ticketQueueChangedEventPayloadSchema>;

export const ticketEscalatedEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  ticketId: ticketIdSchema,
  fromQueueId: z.string().uuid().optional(),
  toQueueId: z.string().uuid().optional(),
  escalatedAt: z.string().datetime().optional(),
  reason: z.string().optional(),
}).describe('Payload for TICKET_ESCALATED');

export type TicketEscalatedEventPayload = z.infer<typeof ticketEscalatedEventPayloadSchema>;

const visibilitySchema = z.enum(['public', 'internal']).describe('Message visibility');
const messageChannelSchema = z.enum(['email', 'portal', 'ui', 'api']).describe('Message channel');
const authorTypeSchema = z.enum(['user', 'contact']).describe('Author type');

export const ticketMessageAddedEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  ticketId: ticketIdSchema,
  messageId: messageIdSchema,
  visibility: visibilitySchema,
  authorId: z.string().uuid().describe('Author ID (user/contact)'),
  authorType: authorTypeSchema,
  channel: messageChannelSchema,
  createdAt: z.string().datetime().optional(),
  attachmentsCount: z.number().int().nonnegative().optional(),
}).describe('Payload for TICKET_MESSAGE_ADDED');

export type TicketMessageAddedEventPayload = z.infer<typeof ticketMessageAddedEventPayloadSchema>;

export const ticketCustomerRepliedEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  ticketId: ticketIdSchema,
  messageId: messageIdSchema,
  contactId: contactIdSchema,
  channel: messageChannelSchema,
  receivedAt: z.string().datetime().optional(),
  attachmentsCount: z.number().int().nonnegative().optional(),
}).describe('Payload for TICKET_CUSTOMER_REPLIED');

export type TicketCustomerRepliedEventPayload = z.infer<typeof ticketCustomerRepliedEventPayloadSchema>;

export const ticketInternalNoteAddedEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  ticketId: ticketIdSchema,
  noteId: noteIdSchema,
  createdAt: z.string().datetime().optional(),
}).describe('Payload for TICKET_INTERNAL_NOTE_ADDED');

export type TicketInternalNoteAddedEventPayload = z.infer<
  typeof ticketInternalNoteAddedEventPayloadSchema
>;

export const ticketTimeEntryAddedEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  ticketId: ticketIdSchema,
  timeEntryId: timeEntryIdSchema,
  minutes: z.number().int().positive(),
  billable: z.boolean(),
  createdAt: z.string().datetime().optional(),
}).describe('Payload for TICKET_TIME_ENTRY_ADDED');

export type TicketTimeEntryAddedEventPayload = z.infer<typeof ticketTimeEntryAddedEventPayloadSchema>;

const slaStageSchema = z.enum(['response', 'resolution', 'custom']).describe('SLA stage');

export const ticketSlaStageEnteredEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  ticketId: ticketIdSchema,
  slaPolicyId: z.string().uuid(),
  stage: slaStageSchema,
  enteredAt: z.string().datetime().optional(),
  targetAt: z.string().datetime().optional(),
}).describe('Payload for TICKET_SLA_STAGE_ENTERED');

export type TicketSlaStageEnteredEventPayload = z.infer<typeof ticketSlaStageEnteredEventPayloadSchema>;

export const ticketSlaStageMetEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  ticketId: ticketIdSchema,
  slaPolicyId: z.string().uuid(),
  stage: slaStageSchema,
  metAt: z.string().datetime().optional(),
  targetAt: z.string().datetime().optional(),
}).describe('Payload for TICKET_SLA_STAGE_MET');

export type TicketSlaStageMetEventPayload = z.infer<typeof ticketSlaStageMetEventPayloadSchema>;

export const ticketSlaStageBreachedEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  ticketId: ticketIdSchema,
  slaPolicyId: z.string().uuid(),
  stage: slaStageSchema,
  breachedAt: z.string().datetime().optional(),
  targetAt: z.string().datetime().optional(),
  overdueBySeconds: z.number().int().nonnegative().optional(),
}).describe('Payload for TICKET_SLA_STAGE_BREACHED');

export type TicketSlaStageBreachedEventPayload = z.infer<
  typeof ticketSlaStageBreachedEventPayloadSchema
>;

export const ticketApprovalRequestedEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  ticketId: ticketIdSchema,
  approvalRequestId: z.string().uuid(),
  approvalType: z.string().min(1),
  requestedByUserId: userIdSchema.optional(),
  requestedAt: z.string().datetime().optional(),
  notes: z.string().optional(),
}).describe('Payload for TICKET_APPROVAL_REQUESTED');

export type TicketApprovalRequestedEventPayload = z.infer<typeof ticketApprovalRequestedEventPayloadSchema>;

export const ticketApprovalGrantedEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  ticketId: ticketIdSchema,
  approvalRequestId: z.string().uuid(),
  approvedByUserId: userIdSchema.optional(),
  approvedAt: z.string().datetime().optional(),
  conditions: z.unknown().optional(),
}).describe('Payload for TICKET_APPROVAL_GRANTED');

export type TicketApprovalGrantedEventPayload = z.infer<typeof ticketApprovalGrantedEventPayloadSchema>;

export const ticketApprovalRejectedEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  ticketId: ticketIdSchema,
  approvalRequestId: z.string().uuid(),
  rejectedByUserId: userIdSchema.optional(),
  rejectedAt: z.string().datetime().optional(),
  reason: z.string().optional(),
}).describe('Payload for TICKET_APPROVAL_REJECTED');

export type TicketApprovalRejectedEventPayload = z.infer<typeof ticketApprovalRejectedEventPayloadSchema>;
