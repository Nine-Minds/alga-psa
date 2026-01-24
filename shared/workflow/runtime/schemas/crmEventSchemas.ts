import { z } from 'zod';
import { BaseDomainEventPayloadSchema, changesSchema, updatedFieldsSchema, uuidSchema } from './commonEventPayloadSchemas';

const clientIdSchema = uuidSchema('Client ID');
const contactIdSchema = uuidSchema('Contact ID');
const userIdSchema = uuidSchema('User ID');
const interactionIdSchema = uuidSchema('Interaction ID');
const noteIdSchema = uuidSchema('Note ID');
const tagIdSchema = uuidSchema('Tag ID');

export const clientCreatedEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  clientId: clientIdSchema,
  clientName: z.string().min(1),
  createdByUserId: userIdSchema.optional(),
  createdAt: z.string().datetime().optional(),
  status: z.string().optional(),
}).describe('Payload for CLIENT_CREATED');

export type ClientCreatedEventPayload = z.infer<typeof clientCreatedEventPayloadSchema>;

export const clientUpdatedEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  clientId: clientIdSchema,
  updatedByUserId: userIdSchema.optional(),
  updatedAt: z.string().datetime().optional(),
  updatedFields: updatedFieldsSchema,
  changes: changesSchema,
}).describe('Payload for CLIENT_UPDATED');

export type ClientUpdatedEventPayload = z.infer<typeof clientUpdatedEventPayloadSchema>;

export const clientStatusChangedEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  clientId: clientIdSchema,
  previousStatus: z.string().min(1),
  newStatus: z.string().min(1),
  changedAt: z.string().datetime().optional(),
}).describe('Payload for CLIENT_STATUS_CHANGED');

export type ClientStatusChangedEventPayload = z.infer<typeof clientStatusChangedEventPayloadSchema>;

export const clientOwnerAssignedEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  clientId: clientIdSchema,
  previousOwnerUserId: userIdSchema.optional(),
  newOwnerUserId: userIdSchema,
  assignedByUserId: userIdSchema.optional(),
  assignedAt: z.string().datetime().optional(),
}).describe('Payload for CLIENT_OWNER_ASSIGNED');

export type ClientOwnerAssignedEventPayload = z.infer<typeof clientOwnerAssignedEventPayloadSchema>;

export const clientMergedEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  sourceClientId: clientIdSchema,
  targetClientId: clientIdSchema,
  mergedByUserId: userIdSchema.optional(),
  mergedAt: z.string().datetime().optional(),
  strategy: z.string().optional(),
}).describe('Payload for CLIENT_MERGED');

export type ClientMergedEventPayload = z.infer<typeof clientMergedEventPayloadSchema>;

export const clientArchivedEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  clientId: clientIdSchema,
  archivedByUserId: userIdSchema.optional(),
  archivedAt: z.string().datetime().optional(),
  reason: z.string().optional(),
}).describe('Payload for CLIENT_ARCHIVED');

export type ClientArchivedEventPayload = z.infer<typeof clientArchivedEventPayloadSchema>;

export const contactCreatedEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  contactId: contactIdSchema,
  clientId: clientIdSchema,
  fullName: z.string().min(1),
  email: z.string().email().optional(),
  phoneNumber: z.string().optional(),
  createdByUserId: userIdSchema.optional(),
  createdAt: z.string().datetime().optional(),
}).describe('Payload for CONTACT_CREATED');

export type ContactCreatedEventPayload = z.infer<typeof contactCreatedEventPayloadSchema>;

export const contactUpdatedEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  contactId: contactIdSchema,
  clientId: clientIdSchema,
  updatedByUserId: userIdSchema.optional(),
  updatedAt: z.string().datetime().optional(),
  updatedFields: updatedFieldsSchema,
  changes: changesSchema,
}).describe('Payload for CONTACT_UPDATED');

export type ContactUpdatedEventPayload = z.infer<typeof contactUpdatedEventPayloadSchema>;

export const contactPrimarySetEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  clientId: clientIdSchema,
  contactId: contactIdSchema,
  previousPrimaryContactId: contactIdSchema.optional(),
  setByUserId: userIdSchema.optional(),
  setAt: z.string().datetime().optional(),
}).describe('Payload for CONTACT_PRIMARY_SET');

export type ContactPrimarySetEventPayload = z.infer<typeof contactPrimarySetEventPayloadSchema>;

export const contactArchivedEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  contactId: contactIdSchema,
  clientId: clientIdSchema,
  archivedByUserId: userIdSchema.optional(),
  archivedAt: z.string().datetime().optional(),
  reason: z.string().optional(),
}).describe('Payload for CONTACT_ARCHIVED');

export type ContactArchivedEventPayload = z.infer<typeof contactArchivedEventPayloadSchema>;

export const contactMergedEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  sourceContactId: contactIdSchema,
  targetContactId: contactIdSchema,
  mergedByUserId: userIdSchema.optional(),
  mergedAt: z.string().datetime().optional(),
  strategy: z.string().optional(),
}).describe('Payload for CONTACT_MERGED');

export type ContactMergedEventPayload = z.infer<typeof contactMergedEventPayloadSchema>;

export const interactionLoggedEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  interactionId: interactionIdSchema,
  clientId: clientIdSchema,
  contactId: contactIdSchema.optional(),
  interactionType: z.string().min(1),
  channel: z.string().min(1),
  interactionOccurredAt: z.string().datetime().optional().describe('Timestamp when interaction occurred (ISO 8601)'),
  loggedByUserId: userIdSchema.optional(),
  subject: z.string().optional(),
  outcome: z.string().optional(),
}).describe('Payload for INTERACTION_LOGGED');

export type InteractionLoggedEventPayload = z.infer<typeof interactionLoggedEventPayloadSchema>;

const noteVisibilitySchema = z.enum(['public', 'internal']).describe('Note visibility');
const noteEntityTypeSchema = z.enum(['client', 'contact']).describe('Note entity type');

export const noteCreatedEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  noteId: noteIdSchema,
  entityType: noteEntityTypeSchema,
  entityId: z.string().uuid(),
  createdByUserId: userIdSchema.optional(),
  createdAt: z.string().datetime().optional(),
  visibility: noteVisibilitySchema.optional(),
  bodyPreview: z.string().optional(),
}).describe('Payload for NOTE_CREATED');

export type NoteCreatedEventPayload = z.infer<typeof noteCreatedEventPayloadSchema>;

export const tagDefinitionCreatedEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  tagId: tagIdSchema,
  tagName: z.string().min(1),
  createdByUserId: userIdSchema.optional(),
  createdAt: z.string().datetime().optional(),
}).describe('Payload for TAG_DEFINITION_CREATED');

export type TagDefinitionCreatedEventPayload = z.infer<typeof tagDefinitionCreatedEventPayloadSchema>;

export const tagDefinitionUpdatedEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  tagId: tagIdSchema,
  previousName: z.string().optional(),
  newName: z.string().optional(),
  updatedByUserId: userIdSchema.optional(),
  updatedAt: z.string().datetime().optional(),
}).describe('Payload for TAG_DEFINITION_UPDATED');

export type TagDefinitionUpdatedEventPayload = z.infer<typeof tagDefinitionUpdatedEventPayloadSchema>;

export const tagAppliedEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  tagId: tagIdSchema,
  entityType: z.string().min(1),
  entityId: z.string().min(1),
  appliedByUserId: userIdSchema.optional(),
  appliedAt: z.string().datetime().optional(),
}).describe('Payload for TAG_APPLIED');

export type TagAppliedEventPayload = z.infer<typeof tagAppliedEventPayloadSchema>;

export const tagRemovedEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  tagId: tagIdSchema,
  entityType: z.string().min(1),
  entityId: z.string().min(1),
  removedByUserId: userIdSchema.optional(),
  removedAt: z.string().datetime().optional(),
}).describe('Payload for TAG_REMOVED');

export type TagRemovedEventPayload = z.infer<typeof tagRemovedEventPayloadSchema>;
