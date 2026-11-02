import { z } from 'zod';
import { uuidSchema } from './common';

/** Entities a document can be attached to through `POST /api/v1/documents`. One adapter each. */
export const ATTACHABLE_ENTITY_TYPES = ['ticket', 'project_task', 'client', 'contact', 'asset'] as const;

export const attachDocumentSchema = z.object({
  entity_type: z.enum(ATTACHABLE_ENTITY_TYPES),
  entity_id: uuidSchema,
  source: z.discriminatedUnion('type', [
    z.object({ type: z.literal('url'), url: z.string().min(1).max(8192) }),
    z.object({ type: z.literal('base64'), content: z.string().min(1) }),
  ]),
  file_name: z.string().min(1).max(1024).optional(),
  mime_type: z.string().min(1).max(255).optional(),
});

export type AttachDocumentRequest = z.infer<typeof attachDocumentSchema>;
