import { z } from 'zod';
import { BaseDomainEventPayloadSchema, changesSchema, updatedFieldsSchema, uuidSchema } from './commonEventPayloadSchemas';

const assetIdSchema = uuidSchema('Asset ID');
const clientIdSchema = uuidSchema('Client ID');
const userIdSchema = uuidSchema('User ID');
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
