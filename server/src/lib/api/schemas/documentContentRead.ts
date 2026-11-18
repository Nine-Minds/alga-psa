import { z } from 'zod';

/**
 * Entities `GET /api/v1/documents/content` can read: the adapters that implement `listReadableDocuments`.
 * Kept equal to the entity adapters and to agent-tooling's READ_ATTACHMENT_ENTITY_TYPES by a test.
 */
export const READABLE_ENTITY_TYPES = ['ticket'] as const;

export const readDocumentContentQuerySchema = z.object({
  entity_type: z.enum(READABLE_ENTITY_TYPES),
  /** A UUID, or a human number such as a ticket number (SR000674); the entity adapter resolves it. */
  entity_id: z.string().trim().min(1).max(128),
  document_id: z.string().uuid().optional(),
  cursor: z.string().min(1).max(8192).optional(),
});

export type ReadDocumentContentQuery = z.infer<typeof readDocumentContentQuerySchema>;
