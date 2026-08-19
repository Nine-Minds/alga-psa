import { z } from 'zod';
import { TICKET_COLUMNS } from '../../lib/ticketColumnCatalog';
import type { TicketViewSettings } from '../../lib/ticketViewSettings';

/**
 * Write-side validation for boards.list_view_settings.
 *
 * JSONB accepts anything, so the integrity that a column type would have given
 * us has to be asserted somewhere. The split is deliberate:
 *
 *   - on **write**, this schema is strict. Unknown keys are *rejected*, not
 *     silently stored, so a typo or a stale client cannot deposit a key that
 *     nothing will ever read and that the next reader will mistake for meaning.
 *   - on **read**, ids that no longer resolve are dropped
 *     (validateCapturedFilters), because a board's saved statusId can die at any
 *     time through no fault of the document.
 *
 * Lives outside boardActions.ts because that module is "use server" and may not
 * export non-async values.
 */

const columnKeys = TICKET_COLUMNS.map((column) => column.key) as [string, ...string[]];
const ticketColumnKeySchema = z.enum(columnKeys);

/**
 * Captured filters. Mirrors ITicketListFilters minus CAPTURE_EXCLUDED_FILTER_KEYS
 * — those keys are stripped by capture, so accepting them here would let a
 * hand-rolled write reintroduce exactly the board-scope confusion capture exists
 * to prevent.
 */
const capturedFiltersShape = {
    statusId: z.string(),
    priorityId: z.string(),
    categoryId: z.string(),
    categoryIds: z.array(z.string()),
    excludeCategoryIds: z.array(z.string()),
    clientId: z.string(),
    contactId: z.string(),
    showOpenOnly: z.boolean(),
    tags: z.array(z.string()),
    assignedToIds: z.array(z.string()),
    assignedTeamIds: z.array(z.string()),
    includeUnassigned: z.boolean(),
    assignedToMe: z.boolean(),
    dueDateFilter: z.enum([
      'all',
      'overdue',
      'upcoming',
      'today',
      'no_due_date',
      'before',
      'after',
      'custom',
    ]),
    dueDateFrom: z.string(),
    dueDateTo: z.string(),
    sortBy: z.string(),
    sortDirection: z.enum(['asc', 'desc']),
    responseState: z.enum(['awaiting_client', 'awaiting_internal', 'none', 'all']),
    slaStatusFilter: z.enum(['all', 'has_sla', 'no_sla', 'on_track', 'breached', 'paused']),
    bundleView: z.enum(['bundled', 'individual']),
} as const;

const viewSettingsShape = (filters: z.ZodTypeAny) => ({
  columnVisibility: z.record(ticketColumnKeySchema, z.boolean()),
  columnOrder: z.array(ticketColumnKeySchema),
  tagsInlineUnderTitle: z.boolean(),
  densityLevel: z.number().int().min(0).max(100),
  filters,
});

/** Write-side: unknown keys are an error, at both levels. */
export const ticketViewSettingsSchema = z
  .object(viewSettingsShape(z.object(capturedFiltersShape).partial().strict()))
  .partial()
  .strict();

/** Read-side: unknown keys are dropped rather than fatal, at both levels. */
const storedTicketViewSettingsSchema = z
  .object(viewSettingsShape(z.object(capturedFiltersShape).partial()))
  .partial();

export type ParsedTicketViewSettings = z.infer<typeof ticketViewSettingsSchema>;

/** Throws with a readable message on invalid input; returns the parsed document. */
export function parseTicketViewSettings(value: unknown): TicketViewSettings {
  const result = ticketViewSettingsSchema.safeParse(value);
  if (!result.success) {
    const detail = result.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid board view settings — ${detail}`);
  }
  return result.data as TicketViewSettings;
}

/**
 * Read-side coercion for a stored document. A row written before this schema
 * existed (or by a future version that added a key) must still render the list
 * rather than throw on a settings screen, so unknown keys are dropped here
 * instead of rejecting — the strict rejection belongs on write, where there is a
 * user to tell.
 */
export function coerceStoredTicketViewSettings(value: unknown): TicketViewSettings | null {
  if (value === null || value === undefined) return null;
  const raw = typeof value === 'string' ? safeJsonParse(value) : value;
  if (!raw || typeof raw !== 'object') return null;
  const result = storedTicketViewSettingsSchema.safeParse(raw);
  return result.success ? (result.data as TicketViewSettings) : null;
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
