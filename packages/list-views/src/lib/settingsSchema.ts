import { z } from 'zod';

/** Name rules shared by the dialog (client) and the actions (server). */
export const LIST_VIEW_NAME_MAX_LENGTH = 100;

/** Widest a stored column may be; anything wider is a corrupt document, not a preference. */
const MAX_COLUMN_WIDTH_PX = 4000;

/**
 * The write-side envelope every list shares, parameterized by that list's
 * filter schema.
 *
 * Strict at every level: an unknown key is rejected rather than stored, so a
 * typo or a stale client cannot deposit a key nothing will ever read. The read
 * side is deliberately lenient instead — each list's adapter sanitizes stored
 * documents, key by key, because a view can outlive the code that wrote it.
 */
export function buildListViewSettingsSchema(filtersSchema: z.ZodTypeAny) {
  return z
    .object({
      filters: filtersSchema.optional(),
      sort: z
        .object({
          by: z.string().min(1).max(100),
          direction: z.enum(['asc', 'desc']),
        })
        .strict()
        .optional(),
      columns: z
        .object({
          visibility: z.record(z.string().min(1).max(100), z.boolean()).optional(),
          order: z.array(z.string().min(1).max(100)).max(200).optional(),
          sizing: z
            .record(z.string().min(1).max(100), z.number().finite().min(0).max(MAX_COLUMN_WIDTH_PX))
            .optional(),
        })
        .strict()
        .optional(),
      density: z.number().int().min(0).max(100).optional(),
      pageSize: z.number().int().min(1).max(1000).optional(),
    })
    .strict();
}

/** Trimmed display name; `null` when it breaks the 1–100 character rule. */
export function normalizeListViewName(raw: unknown): string | null {
  if (typeof raw !== 'string') {
    return null;
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > LIST_VIEW_NAME_MAX_LENGTH) {
    return null;
  }
  return trimmed;
}
