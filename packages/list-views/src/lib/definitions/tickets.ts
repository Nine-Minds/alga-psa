import { z } from 'zod';
import type { ITicketListFilters } from '@alga-psa/types';

/**
 * Filter keys a named ticket view can store.
 *
 * Unlike a board's default view, a named view *does* carry board scope
 * (`boardId`, `boardIds`, `excludeBoardIds`, `boardFilterState`) — "Unassigned in
 * Service Desk" is a board-scoped view. Only the transient `searchQuery` is left
 * out.
 *
 * Declared as a mapped type over ITicketListFilters so a filter key added there
 * fails the build here, by name, instead of being captured from the live list
 * and then rejected on save at runtime.
 */
export const TICKET_NAMED_VIEW_EXCLUDED_FILTER_KEYS = ['searchQuery'] as const;

type TicketNamedViewFilterKey = Exclude<
  keyof ITicketListFilters,
  (typeof TICKET_NAMED_VIEW_EXCLUDED_FILTER_KEYS)[number]
>;

// LEVERAGE: pattern ticket-filter-schema — this repeats capturedFiltersShape in
// packages/tickets/src/actions/board-actions/boardViewSettingsSchema.ts (plus the
// board-scope keys). A zod schema for ITicketListFilters belongs one layer down
// (types/validation) so both write paths share it.
const ticketFiltersShape: { [K in TicketNamedViewFilterKey]: z.ZodTypeAny } = {
  boardId: z.string(),
  boardIds: z.array(z.string()),
  excludeBoardIds: z.array(z.string()),
  boardFilterState: z.enum(['active', 'inactive', 'all']),
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
  dueDateFilter: z.enum(['all', 'overdue', 'upcoming', 'today', 'no_due_date', 'before', 'after', 'custom']),
  dueDateFrom: z.string(),
  dueDateTo: z.string(),
  sortBy: z.string(),
  sortDirection: z.enum(['asc', 'desc']),
  responseState: z.enum(['awaiting_client', 'awaiting_internal', 'none', 'all']),
  slaStatusFilter: z.enum(['all', 'has_sla', 'no_sla', 'on_track', 'breached', 'paused']),
  bundleView: z.enum(['bundled', 'individual']),
};

export const ticketListViewFiltersSchema = z.object(ticketFiltersShape).partial().strict();

export type TicketListViewFilters = Partial<Pick<ITicketListFilters, TicketNamedViewFilterKey>>;
