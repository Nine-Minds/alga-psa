import type {
  ITicketListFilters,
  ListViewAdapter,
  ListViewSanitizeResult,
  ListViewSettings,
} from '@alga-psa/types';
import {
  DroppedReferenceCollector,
  TICKET_NAMED_VIEW_EXCLUDED_FILTER_KEYS,
  compactFilters,
  differsByCapture,
  withoutUndefined,
  type TicketListViewFilters,
} from '@alga-psa/list-views';
import { isTicketStatusOpenFilter, TICKET_STATUS_FILTER_OPEN } from './ticketStatusFilter';
import { NO_BOARD_VALUE } from './boardFilterValues';
import {
  TICKET_VIEW_DENSITY_STEP,
  type ResolvedTicketViewSettings,
} from './ticketViewSettings';
import { resolveTicketColumnOrder, resolveTicketColumnVisibility } from './ticketColumnCatalog';

/**
 * Named views for the ticket list.
 *
 * Tickets carry three layers of view state: the URL (live filters), the board /
 * tenant default (admin-authored baseline) and now a named view on top. A named
 * view is a full snapshot that replaces the baseline group by group — the same
 * semantics as resolveTicketViewSettings — and, unlike a board default, it
 * carries board scope, so applying "Unassigned in Service Desk" moves to the
 * Service Desk tab.
 */

export interface TicketListLiveState {
  /** The container's activeFilters, including sortBy / sortDirection. */
  filters: Partial<ITicketListFilters>;
  presentation: ResolvedTicketViewSettings;
  pageSize: number;
  /** Controlled column widths; undefined leaves them to the table. */
  columnSizing?: Record<string, number>;
}

export interface TicketListViewContext {
  /** Filters of the list's neutral state (open status, all priorities, …). */
  neutralFilters: () => Partial<ITicketListFilters>;
  /** The board/tenant/catalog view a board tab arrives at (null = All tickets). */
  resolveBaselineForBoard: (boardId: string | null) => ResolvedTicketViewSettings;
  /** Where the list returns to when no named view applies (board default, current board). */
  baseline: (live: TicketListLiveState) => TicketListLiveState;
  /** Universes for sanitize; an absent universe means "cannot validate", never "drop". */
  known: {
    boardIds?: ReadonlySet<string>;
    statusIds?: ReadonlySet<string>;
    priorityIds?: ReadonlySet<string>;
    categoryIds?: ReadonlySet<string>;
    clientIds?: ReadonlySet<string>;
    userIds?: ReadonlySet<string>;
    teamIds?: ReadonlySet<string>;
    tags?: ReadonlySet<string>;
  };
}

type TicketViewSettingsEnvelope = ListViewSettings<TicketListViewFilters>;

/** Filters whose `false` is the absence of a constraint (see ticketViewSettings.ts). */
const FALSE_IS_NO_OP = ['includeUnassigned', 'assignedToMe'] as const;

/** Keys the envelope stores elsewhere (sort) or derives on apply (showOpenOnly). */
const NOT_STORED_AS_FILTERS = [
  ...TICKET_NAMED_VIEW_EXCLUDED_FILTER_KEYS,
  'sortBy',
  'sortDirection',
  'showOpenOnly',
] as const;

const DEFAULT_SORT = { by: 'entered_at', direction: 'desc' as const };

/** Pseudo-ids the category filters accept alongside real category ids. */
const CATEGORY_SENTINELS = ['no-category', 'all'];

function boardIdOf(filters: Partial<ITicketListFilters>): string | null {
  if (filters.boardIds?.length === 1) {
    return filters.boardIds[0] === NO_BOARD_VALUE ? null : filters.boardIds[0];
  }
  return filters.boardId ?? null;
}

function normalizeDensity(value: number | undefined): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  const clamped = Math.min(100, Math.max(0, value));
  return Math.round(clamped / TICKET_VIEW_DENSITY_STEP) * TICKET_VIEW_DENSITY_STEP;
}

export function captureTicketListView(live: TicketListLiveState): TicketViewSettingsEnvelope {
  const filters = compactFilters(live.filters, {
    exclude: NOT_STORED_AS_FILTERS,
    falseIsNoOp: FALSE_IS_NO_OP,
  }) as TicketListViewFilters;

  const settings: TicketViewSettingsEnvelope = {
    filters,
    sort: {
      by: live.filters.sortBy ?? DEFAULT_SORT.by,
      direction: live.filters.sortDirection ?? DEFAULT_SORT.direction,
    },
    columns: withoutUndefined({
      visibility: { ...live.presentation.columnVisibility },
      order: [...live.presentation.columnOrder],
      sizing: live.columnSizing && Object.keys(live.columnSizing).length > 0
        ? { ...live.columnSizing }
        : undefined,
    }),
    density: live.presentation.densityLevel,
    pageSize: live.pageSize,
  };
  return settings;
}

export function applyTicketListView(
  settings: TicketViewSettingsEnvelope | null,
  live: TicketListLiveState,
  context: TicketListViewContext,
): TicketListLiveState {
  if (!settings) {
    return context.baseline(live);
  }

  const storedFilters = (settings.filters ?? {}) as Partial<ITicketListFilters>;
  const sort = settings.sort ?? DEFAULT_SORT;
  const statusId = storedFilters.statusId ?? TICKET_STATUS_FILTER_OPEN;
  const filters: Partial<ITicketListFilters> = {
    ...context.neutralFilters(),
    ...storedFilters,
    statusId,
    showOpenOnly: isTicketStatusOpenFilter(statusId),
    // Search is transient: a view never carries it, and applying one clears it.
    searchQuery: '',
    sortBy: sort.by,
    sortDirection: sort.direction,
  };

  // Groups the view does not define fall through to the board it lands on —
  // the same per-group replacement resolveTicketViewSettings uses.
  const baseline = context.resolveBaselineForBoard(boardIdOf(filters));
  const presentation: ResolvedTicketViewSettings = {
    columnVisibility: settings.columns?.visibility
      ? resolveTicketColumnVisibility(settings.columns.visibility as Record<string, boolean>)
      : baseline.columnVisibility,
    columnOrder: settings.columns?.order
      ? resolveTicketColumnOrder(settings.columns.order)
      : baseline.columnOrder,
    tagsInlineUnderTitle: baseline.tagsInlineUnderTitle,
    densityLevel: normalizeDensity(settings.density) ?? baseline.densityLevel,
    filters: baseline.filters,
  };

  return {
    filters,
    presentation,
    pageSize: settings.pageSize ?? live.pageSize,
    // A view without widths hands them back to the table (which keeps whatever
    // is on screen); resizing afterwards then reads as a change to the view.
    columnSizing: settings.columns?.sizing ? { ...settings.columns.sizing } : undefined,
  };
}

export function sanitizeTicketListView(
  settings: TicketViewSettingsEnvelope,
  known: TicketListViewContext['known'],
): ListViewSanitizeResult<TicketListViewFilters> {
  const collector = new DroppedReferenceCollector();
  const filters = { ...(settings.filters ?? {}) } as Partial<ITicketListFilters>;
  const pseudoStatuses = [TICKET_STATUS_FILTER_OPEN, 'all'];

  const next: Partial<ITicketListFilters> = withoutUndefined({
    ...filters,
    boardId: collector.keepScalar('boardId', filters.boardId, known.boardIds),
    boardIds: collector.keepList('boardIds', filters.boardIds, known.boardIds, [NO_BOARD_VALUE]),
    excludeBoardIds: collector.keepList('excludeBoardIds', filters.excludeBoardIds, known.boardIds, [NO_BOARD_VALUE]),
    statusId: collector.keepScalar('statusId', filters.statusId, known.statusIds, pseudoStatuses),
    priorityId: collector.keepScalar('priorityId', filters.priorityId, known.priorityIds, ['all']),
    categoryId: collector.keepScalar('categoryId', filters.categoryId, known.categoryIds, CATEGORY_SENTINELS),
    categoryIds: collector.keepList('categoryIds', filters.categoryIds, known.categoryIds, CATEGORY_SENTINELS),
    excludeCategoryIds: collector.keepList('excludeCategoryIds', filters.excludeCategoryIds, known.categoryIds, CATEGORY_SENTINELS),
    clientId: collector.keepScalar('clientId', filters.clientId, known.clientIds),
    assignedToIds: collector.keepList('assignedToIds', filters.assignedToIds, known.userIds),
    assignedTeamIds: collector.keepList('assignedTeamIds', filters.assignedTeamIds, known.teamIds),
    tags: collector.keepList('tags', filters.tags, known.tags),
  });

  return {
    settings: { ...settings, filters: next as TicketListViewFilters },
    dropped: collector.dropped,
  };
}

// LEVERAGE: pattern list-view-adapter — every list's adapter is capture/apply/
// sanitize plus differsByCapture over a context the screen owns; if a sixth list
// adopts, a createListViewAdapter({ capture, apply, sanitize }) factory would
// remove the remaining boilerplate.
export function createTicketListViewAdapter(
  context: TicketListViewContext,
): ListViewAdapter<TicketListLiveState, TicketListViewFilters> {
  const apply = (settings: TicketViewSettingsEnvelope | null, live: TicketListLiveState) =>
    applyTicketListView(settings, live, context);
  return {
    listKey: 'tickets',
    capture: captureTicketListView,
    apply,
    sanitize: (settings) => sanitizeTicketListView(settings, context.known),
    differs: (live, settings) => differsByCapture(captureTicketListView, apply, live, settings),
  };
}
