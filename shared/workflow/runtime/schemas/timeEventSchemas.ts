import { z } from 'zod';
import { BaseDomainEventPayloadSchema, uuidSchema } from './commonEventPayloadSchemas';

const timeEntryIdSchema = uuidSchema('Time Entry ID');
const userIdSchema = uuidSchema('User ID');
const workItemIdSchema = uuidSchema('Work Item ID');

const workItemTypeSchema = z.enum(['TICKET', 'PROJECT_TASK']).describe('Work item type');

export const timeEntrySubmittedEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  timeEntryId: timeEntryIdSchema,
  userId: userIdSchema,
  workItemId: workItemIdSchema,
  workItemType: workItemTypeSchema,
}).describe('Payload for TIME_ENTRY_SUBMITTED');

export type TimeEntrySubmittedEventPayload = z.infer<typeof timeEntrySubmittedEventPayloadSchema>;

export const timeEntryApprovedEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  timeEntryId: timeEntryIdSchema,
  userId: userIdSchema,
  workItemId: workItemIdSchema,
  workItemType: workItemTypeSchema,
}).describe('Payload for TIME_ENTRY_APPROVED');

export type TimeEntryApprovedEventPayload = z.infer<typeof timeEntryApprovedEventPayloadSchema>;

