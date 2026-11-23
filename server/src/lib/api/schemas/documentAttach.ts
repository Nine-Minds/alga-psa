import { z } from 'zod';
import { uuidSchema } from './common';
import { ValidationError } from '../middleware/apiErrors';

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
  /** Client-visible when true. Optional boolean only (a string is a 400); the default is internal. */
  is_client_visible: z.boolean().optional(),
});

export type AttachDocumentRequest = z.infer<typeof attachDocumentSchema>;

/**
 * Reads the multipart `is_client_visible` field. Absent or empty is internal (false); only the
 * strings `true` and `false` are accepted, anything else is a 400 on path `is_client_visible`.
 */
export function parseClientVisibleFormField(value: FormDataEntryValue | null): boolean {
  if (value === null || value === '') return false;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new ValidationError('Validation failed', [
    { path: ['is_client_visible'], message: 'is_client_visible must be a boolean (true or false)' },
  ]);
}
