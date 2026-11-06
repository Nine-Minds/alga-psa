import { z } from 'zod';
import type { ITicketListFilters } from '@alga-psa/types';
import { predicateClauseSchema } from '@alga-psa/predicates';

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

/**
 * Structural shape of `where`: one flat `and` group of predicate clauses. Which paths and operators
 * are allowed is the ticket query schema's business (packages/tickets ticketWhereSchema validates
 * that); this layer only guarantees the envelope so a stored document cannot carry nested groups.
 */
export const TICKET_WHERE_MAX_CLAUSES = 50;
export const ticketWhereShapeSchema = z
  .object({
    join: z.literal('and'),
    clauses: z.array(predicateClauseSchema).max(TICKET_WHERE_MAX_CLAUSES),
  })
  .strict();

/** Board-scope keys: a named view stores them, a board's default view never does. */
export const TICKET_BOARD_SCOPE_FILTER_KEYS = ['boardId', 'boardIds', 'excludeBoardIds', 'boardFilterState'] as const;

/**
 * The ticket filter schema, declared once. The named-view schema is built from it directly; the
 * board default view schema (packages/tickets boardViewSettingsSchema.ts) omits the board-scope keys.
 */
export const ticketFiltersShape: { [K in TicketNamedViewFilterKey]: z.ZodTypeAny } = {
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
  assignedToIds: z.array(z.string().guid()),
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
  where: ticketWhereShapeSchema,
};

export const ticketListViewFiltersSchema = z.object(ticketFiltersShape).partial().strict();

export type TicketListViewFilters = Partial<Pick<ITicketListFilters, TicketNamedViewFilterKey>>;
