import { z } from 'zod';
import type { ITicketListFilters } from '@alga-psa/types';
import { TICKET_COLUMNS } from '../../lib/ticketColumnCatalog';
import type { CaptureExcludedFilterKey, TicketViewSettings } from '../../lib/ticketViewSettings';

/**
 * Write-side validation for boards.list_view_settings.
 *
 * JSONB accepts anything, so the integrity that a column type would have given
 * us has to be asserted somewhere. The split is deliberate:
 *
 *   - on **write**, this schema is strict. Unknown keys are *rejected*, not
 *     silently stored, so a typo or a stale client cannot deposit a key that
 *     nothing will ever read and that the next reader will mistake for meaning.
 *   - on **read**, nothing here applies. Stored documents are coerced by
 *     sanitizeStoredTicketView (key-dropping, no Zod — z.record(z.enum) errors
 *     on an unknown key rather than dropping it) and their ids are checked by
 *     validateCapturedFilters, because a board's saved statusId can die at any
 *     time through no fault of the document.
 *
 * Lives outside boardActions.ts because that module is "use server" and may not
 * export non-async values.
 */

const columnKeys = TICKET_COLUMNS.map((column) => column.key) as [string, ...string[]];
const ticketColumnKeySchema = z.enum(columnKeys);

/**
 * Captured filters: every ITicketListFilters key that capture can produce, i.e. all of them minus
 * the excluded ones.
 *
 * Typing the shape below against this is what keeps "every new filter is
 * defaultable for free" honest. Capture is a deny-list (a new key is captured
 * unless someone excludes it) while this schema is an allow-list, so without a
 * link between them the next key added to ITicketListFilters would be captured
 * from the live list and then rejected on save — a failure that would surface
 * only at runtime, to a user, as a save that mysteriously does not work.
 * Declared as a mapped type instead, TypeScript fails the build at this file
 * with the missing key named.
 *
 * The excluded keys are absent for a second reason too: accepting them would let
 * a hand-rolled write reintroduce exactly the board-scope confusion capture
 * exists to prevent.
 */
type CapturableFilterKey = Exclude<keyof ITicketListFilters, CaptureExcludedFilterKey>;

const capturedFiltersShape: { [K in CapturableFilterKey]: z.ZodTypeAny } = {
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
