// Client-safe canned response input schema. Imports only zod: the editor component imports this, so it must
// never reach @alga-psa/db, knex or pg.

import { z } from 'zod';
import { CANNED_RESPONSE_SCOPES } from '@alga-psa/types';

const uuid = z.string().guid();

export const CANNED_RESPONSE_NAME_MAX = 200;
export const CANNED_RESPONSE_CATEGORY_MAX = 100;

/** A serialized BlockNote document: a JSON array of blocks with at least some content. */
function isNonEmptyBlockNoteJson(value: string): boolean {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) && parsed.length > 0;
  } catch {
    return false;
  }
}

export const cannedResponseInputSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(CANNED_RESPONSE_NAME_MAX),
    /** Serialized BlockNote JSON (the format `comments.note` uses). */
    body: z.string().refine(isNonEmptyBlockNoteJson, 'Response body is required'),
    category: z
      .string()
      .trim()
      .max(CANNED_RESPONSE_CATEGORY_MAX)
      .nullable()
      .optional()
      .transform((value) => (value ? value : null)),
    scope: z.enum(CANNED_RESPONSE_SCOPES as unknown as [string, ...string[]]),
    team_id: uuid.nullable().optional().transform((value) => value ?? null),
    board_id: uuid.nullable().optional().transform((value) => value ?? null),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.scope === 'team' && !value.team_id) {
      ctx.addIssue({ code: 'custom', path: ['team_id'], message: 'Choose a team for a team response' });
    }
    if (value.scope === 'board' && !value.board_id) {
      ctx.addIssue({ code: 'custom', path: ['board_id'], message: 'Choose a board for a board response' });
    }
  })
  // Only the scope's own target is kept; the others are dropped rather than rejected.
  .transform((value) => ({
    ...value,
    scope: value.scope as (typeof CANNED_RESPONSE_SCOPES)[number],
    team_id: value.scope === 'team' ? value.team_id : null,
    board_id: value.scope === 'board' ? value.board_id : null,
  }));

export type CannedResponseInput = z.input<typeof cannedResponseInputSchema>;
export type ParsedCannedResponseInput = z.output<typeof cannedResponseInputSchema>;
