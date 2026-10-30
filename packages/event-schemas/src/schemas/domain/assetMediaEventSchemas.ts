import { z } from 'zod';
import { BaseDomainEventPayloadSchema, changesSchema, updatedFieldsSchema, uuidSchema, entityIdSchema } from './commonEventPayloadSchemas';

const assetIdSchema = uuidSchema('Asset ID');
const clientIdSchema = entityIdSchema('Client ID', 'client');
const userIdSchema = entityIdSchema('User ID', 'user');
const fileIdSchema = uuidSchema('File ID');

export const assetCreatedEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  assetId: assetIdSchema,
  clientId: clientIdSchema.optional(),
  createdByUserId: userIdSchema.optional(),
  createdAt: z.string().datetime().optional(),
  assetType: z.string().optional(),
  serialNumber: z.string().optional(),
}).describe('Payload for ASSET_CREATED');

export type AssetCreatedEventPayload = z.infer<typeof assetCreatedEventPayloadSchema>;

export const assetUpdatedEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  assetId: assetIdSchema,
  updatedByUserId: userIdSchema.optional(),
  updatedAt: z.string().datetime().optional(),
  updatedFields: updatedFieldsSchema,
  changes: changesSchema,
}).describe('Payload for ASSET_UPDATED');

export type AssetUpdatedEventPayload = z.infer<typeof assetUpdatedEventPayloadSchema>;

const ownerTypeSchema = z.string().min(1).describe('Owner type (client/contact/site/etc)');

export const assetAssignedEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  assetId: assetIdSchema,
  previousOwnerType: ownerTypeSchema.optional(),
  previousOwnerId: z.string().optional(),
  newOwnerType: ownerTypeSchema,
  newOwnerId: z.string().min(1),
  assignedAt: z.string().datetime().optional(),
}).describe('Payload for ASSET_ASSIGNED');

export type AssetAssignedEventPayload = z.infer<typeof assetAssignedEventPayloadSchema>;

export const assetUnassignedEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  assetId: assetIdSchema,
  previousOwnerType: ownerTypeSchema,
  previousOwnerId: z.string().min(1),
  unassignedAt: z.string().datetime().optional(),
  reason: z.string().optional(),
}).describe('Payload for ASSET_UNASSIGNED');

export type AssetUnassignedEventPayload = z.infer<typeof assetUnassignedEventPayloadSchema>;

export const assetWarrantyExpiringEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  assetId: assetIdSchema,
  expiresAt: z.string().datetime(),
  daysUntilExpiry: z.number().int().nonnegative(),
  clientId: clientIdSchema.optional(),
}).describe('Payload for ASSET_WARRANTY_EXPIRING');

export type AssetWarrantyExpiringEventPayload = z.infer<typeof assetWarrantyExpiringEventPayloadSchema>;

export const ASSET_CUSTODY_EVENT_TYPES = ['received', 'moved', 'handed_off', 'shipped', 'returned'] as const;

export const assetCustodyChangedEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  assetId: assetIdSchema,
  custodyId: uuidSchema('Custody ID'),
  clientId: clientIdSchema.optional(),
  ticketId: entityIdSchema('Ticket ID', 'ticket').optional(),
  /** The physical step, or 'updated' for a non-physical edit (purpose, next action, follow-up, condition, accessories). */
  eventType: z.enum([...ASSET_CUSTODY_EVENT_TYPES, 'updated']),
  state: z.enum(['in_office', 'with_vendor', 'closed']),
  purpose: z.enum(['repair', 'warranty_evaluation', 'loaner_prep', 'staging']),
  nextActionParty: z.enum(['msp', 'client', 'vendor']),
  followUpOn: z.string().optional().describe('Calendar date YYYY-MM-DD'),
  locationId: uuidSchema('Stock location ID').optional(),
  bin: z.string().optional(),
  holderUserId: entityIdSchema('Holder user ID', 'user').optional(),
  actorUserId: entityIdSchema('Actor user ID', 'user').optional(),
  occurredAt: z.string().datetime(),
}).describe('Payload for ASSET_CUSTODY_CHANGED');

export type AssetCustodyChangedEventPayload = z.infer<typeof assetCustodyChangedEventPayloadSchema>;

export const fileUploadedEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  fileId: fileIdSchema,
  uploadedByUserId: userIdSchema.optional(),
  uploadedAt: z.string().datetime().optional(),
  fileName: z.string().min(1),
  contentType: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
  storageKey: z.string().min(1),
}).describe('Payload for FILE_UPLOADED');

export type FileUploadedEventPayload = z.infer<typeof fileUploadedEventPayloadSchema>;

export const mediaProcessingSucceededEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  fileId: fileIdSchema,
  processedAt: z.string().datetime().optional(),
  outputs: z.array(z.unknown()).optional(),
  durationMs: z.number().int().nonnegative().optional(),
}).describe('Payload for MEDIA_PROCESSING_SUCCEEDED');

export type MediaProcessingSucceededEventPayload = z.infer<typeof mediaProcessingSucceededEventPayloadSchema>;

export const mediaProcessingFailedEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  fileId: fileIdSchema,
  failedAt: z.string().datetime().optional(),
  errorCode: z.string().optional(),
  errorMessage: z.string().min(1),
  retryable: z.boolean().optional(),
}).describe('Payload for MEDIA_PROCESSING_FAILED');

export type MediaProcessingFailedEventPayload = z.infer<typeof mediaProcessingFailedEventPayloadSchema>;
