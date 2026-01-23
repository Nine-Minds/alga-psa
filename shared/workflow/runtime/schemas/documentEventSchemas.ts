import { z } from 'zod';
import { BaseDomainEventPayloadSchema, uuidSchema } from './commonEventPayloadSchemas';

const documentIdSchema = uuidSchema('Document ID');
const userIdSchema = uuidSchema('User ID');

export const documentUploadedEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  documentId: documentIdSchema,
  uploadedByUserId: userIdSchema.optional(),
  uploadedAt: z.string().datetime().optional(),
  fileName: z.string().min(1),
  contentType: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
  storageKey: z.string().min(1),
}).describe('Payload for DOCUMENT_UPLOADED');

export type DocumentUploadedEventPayload = z.infer<typeof documentUploadedEventPayloadSchema>;

export const documentDeletedEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  documentId: documentIdSchema,
  deletedByUserId: userIdSchema.optional(),
  deletedAt: z.string().datetime().optional(),
  reason: z.string().optional(),
}).describe('Payload for DOCUMENT_DELETED');

export type DocumentDeletedEventPayload = z.infer<typeof documentDeletedEventPayloadSchema>;

export const documentAssociatedEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  documentId: documentIdSchema,
  entityType: z.string().min(1),
  entityId: z.string().min(1),
  associatedByUserId: userIdSchema.optional(),
  associatedAt: z.string().datetime().optional(),
}).describe('Payload for DOCUMENT_ASSOCIATED');

export type DocumentAssociatedEventPayload = z.infer<typeof documentAssociatedEventPayloadSchema>;

export const documentDetachedEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  documentId: documentIdSchema,
  entityType: z.string().min(1),
  entityId: z.string().min(1),
  detachedByUserId: userIdSchema.optional(),
  detachedAt: z.string().datetime().optional(),
  reason: z.string().optional(),
}).describe('Payload for DOCUMENT_DETACHED');

export type DocumentDetachedEventPayload = z.infer<typeof documentDetachedEventPayloadSchema>;

export const documentGeneratedEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  documentId: documentIdSchema,
  sourceType: z.string().min(1),
  sourceId: z.string().min(1),
  generatedByUserId: userIdSchema.optional(),
  generatedAt: z.string().datetime().optional(),
  fileName: z.string().min(1),
}).describe('Payload for DOCUMENT_GENERATED');

export type DocumentGeneratedEventPayload = z.infer<typeof documentGeneratedEventPayloadSchema>;

export const documentSignatureRequestedEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  documentId: documentIdSchema,
  requestId: z.string().uuid(),
  requestedByUserId: userIdSchema.optional(),
  requestedAt: z.string().datetime().optional(),
  signers: z
    .array(
      z.object({
        email: z.string().email(),
        name: z.string().optional(),
      })
    )
    .min(1),
  expiresAt: z.string().datetime().optional(),
}).describe('Payload for DOCUMENT_SIGNATURE_REQUESTED');

export type DocumentSignatureRequestedEventPayload = z.infer<
  typeof documentSignatureRequestedEventPayloadSchema
>;

export const documentSignedEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  documentId: documentIdSchema,
  requestId: z.string().uuid(),
  signedAt: z.string().datetime().optional(),
  signerEmail: z.string().email().optional(),
  signerId: z.string().uuid().optional(),
}).describe('Payload for DOCUMENT_SIGNED');

export type DocumentSignedEventPayload = z.infer<typeof documentSignedEventPayloadSchema>;

export const documentSignatureExpiredEventPayloadSchema = BaseDomainEventPayloadSchema.extend({
  documentId: documentIdSchema,
  requestId: z.string().uuid(),
  expiredAt: z.string().datetime().optional(),
}).describe('Payload for DOCUMENT_SIGNATURE_EXPIRED');

export type DocumentSignatureExpiredEventPayload = z.infer<typeof documentSignatureExpiredEventPayloadSchema>;
