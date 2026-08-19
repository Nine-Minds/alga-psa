import type { IBoard, ITicketListFilters } from '@alga-psa/types';
import { NO_BOARD_VALUE } from './boardFilterValues';
import {
  buildTicketStatusFilterOptions,
  isTicketStatusOpenFilter,
  TICKET_STATUS_FILTER_OPEN,
  type TicketStatusFilterOption,
} from './ticketStatusFilter';

/**
 * Board-centric ticketing: a board is a place you go, not a filter you set.
 *
 * The tab strip is a second face on the *existing* board filter rather than a
 * parallel piece of state — a board tab is exactly "the single-board filter is
 * set to this board", which is what makes the board-scoped status dropdown
 * (buildTicketStatusFilterOptions) light up. Everything here is pure so the
 * tab -> filter-state mapping and the URL-vs-preference precedence rule can be
 * tested without mounting the dashboard.
 */

/** Tab id for the "All tickets" home tab (no single-board scope). */
export const ALL_BOARDS_TAB_ID = '__all_boards__';

const BOARD_TAB_ID_PREFIX = 'board:';

/** URL params that express a board selection; presence means "the URL has an opinion". */
export const BOARD_FILTER_URL_PARAMS = ['boardId', 'boardIds', 'excludeBoardIds'] as const;

/** Preference key holding the board tab the user was last on ('' = All tickets). */
export const TICKETS_LAST_ACTIVE_BOARD_SETTING = 'tickets_last_active_board';

export interface BoardTabDescriptor {
  /** Stable tab id (ALL_BOARDS_TAB_ID or `board:<board_id>`). */
  id: string;
  /** Board this tab scopes to, or null for the "All tickets" tab. */
  boardId: string | null;
  label: string;
  /** Open ticket count for the pill, or null when stats are unavailable. */
  openTicketCount: number | null;
  /** True when the board is inactive and only shown because it is selected. */
  isInactive: boolean;
}

export function boardTabId(boardId: string | null | undefined): string {
  return boardId ? `${BOARD_TAB_ID_PREFIX}${boardId}` : ALL_BOARDS_TAB_ID;
}

export function boardIdFromTabId(tabId: string): string | null {
  return tabId.startsWith(BOARD_TAB_ID_PREFIX)
    ? tabId.slice(BOARD_TAB_ID_PREFIX.length)
    : null;
}

/**
 * The board tab implied by a board-filter selection. Deliberately identical to
 * the dashboard's `selectedBoard` derivation so the highlighted tab and the
 * board-scoped status options can never disagree: a tab is active only when
 * exactly one real board is selected.
 */
export function resolveActiveBoardId(selectedBoards: readonly string[]): string | null {
  return selectedBoards.length === 1 && selectedBoards[0] !== NO_BOARD_VALUE
    ? selectedBoards[0]
    : null;
}

/** Board-filter selection produced by clicking a tab. */
export function boardTabSelection(boardId: string | null): {
  selectedBoards: string[];
  excludedBoards: string[];
} {
  return boardId
    ? { selectedBoards: [boardId], excludedBoards: [] }
    : { selectedBoards: [], excludedBoards: [] };
}

/**
 * The filter update for a board selection, shared by the multi-select picker
 * and the tab strip. Status options are board-scoped, so a status that does not
 * exist on the newly selected board falls back to "all open statuses".
 */
export function buildBoardSelectionFilterUpdate(params: {
  selectedBoards: readonly string[];
  excludedBoards: readonly string[];
  statusOptions: TicketStatusFilterOption[];
  currentStatusId?: string | null;
}): Partial<ITicketListFilters> {
  const { selectedBoards, excludedBoards, statusOptions, currentStatusId } = params;
  const scopedBoardId = resolveActiveBoardId(selectedBoards) ?? undefined;
  const currentStatus = currentStatusId ?? TICKET_STATUS_FILTER_OPEN;
  const nextStatusOptions = buildTicketStatusFilterOptions(statusOptions, scopedBoardId, currentStatus);
  const statusStillAvailable = nextStatusOptions.some(option => option.value === currentStatus);

  return {
    boardId: undefined, // clear legacy single-board field; arrays are the source of truth
    boardIds: selectedBoards.length > 0 ? [...selectedBoards] : undefined,
    excludeBoardIds: excludedBoards.length > 0 ? [...excludedBoards] : undefined,
    statusId: statusStillAvailable ? currentStatus : TICKET_STATUS_FILTER_OPEN,
    showOpenOnly: statusStillAvailable ? isTicketStatusOpenFilter(currentStatus) : true,
  };
}

/**
 * Tabs to render: "All tickets" plus every pinned, active board.
 *
 * Two exclusions with one escape hatch. A board is excluded when it is inactive,
 * or when it is not pinned — pinning is what stops the strip becoming a
 * horizontally scrolling row at 25 boards, and it is the release valve for the
 * vertical space the board header costs. The single "…or it is the active board"
 * clause covers both cases with no extra branch: a deep link to an archived
 * board and a deep link to a merely-unpinned board each render a transient tab
 * that disappears when you leave. Unpinned boards therefore stay fully
 * reachable — via All tickets and the board filter — without an overflow menu.
 *
 * Zero pinned boards is a legitimate state (an admin unpinned everything): the
 * strip renders All tickets alone rather than hiding, so the screen never loses
 * its navigation.
 */
export function buildBoardTabs(params: {
  boards: readonly IBoard[];
  activeBoardId: string | null;
  stats?: Record<string, { openTicketCount: number }> | null;
  allTabLabel: string;
  unnamedBoardLabel: string;
}): BoardTabDescriptor[] {
  const { boards, activeBoardId, stats, allTabLabel, unnamedBoardLabel } = params;

  const boardTabs = boards
    .filter(board => Boolean(board.board_id))
    .filter(board =>
      (board.is_inactive !== true && board.is_pinned === true) ||
      board.board_id === activeBoardId
    )
    .slice()
    .sort((a, b) =>
      (a.display_order || 0) - (b.display_order || 0) ||
      (a.board_name || '').localeCompare(b.board_name || '')
    )
    .map((board): BoardTabDescriptor => {
      const boardId = board.board_id as string;
      const boardStats = stats?.[boardId];
      return {
        id: boardTabId(boardId),
        boardId,
        label: board.board_name || unnamedBoardLabel,
        openTicketCount: boardStats ? boardStats.openTicketCount : null,
        isInactive: board.is_inactive === true,
      };
    });

  return [
    {
      id: ALL_BOARDS_TAB_ID,
      boardId: null,
      // No pill: summing per-board counts would silently drop boardless tickets,
      // and a wrong number is worse than no number.
      label: allTabLabel,
      openTicketCount: null,
      isInactive: false,
    },
    ...boardTabs,
  ];
}

/** True when the URL already expresses a board selection. */
export function hasBoardFilterParam(search: string): boolean {
  const params = new URLSearchParams(search);
  return BOARD_FILTER_URL_PARAMS.some(param => (params.get(param) ?? '').trim().length > 0);
}

/**
 * Non-board filter params. A shared link carrying any of these has an opinion
 * about what the list should show, and that opinion outranks the board's stored
 * default filters — you sent someone a link to *these tickets*, not to the
 * board's usual view of them.
 *
 * Board scope is deliberately excluded: `?boardId=x` says which board, not what
 * to show on it, so it selects the tab and then lets the board's own view apply.
 * Pagination is excluded for the same reason.
 */
export const TICKET_VIEW_URL_FILTER_PARAMS = [
  'clientId',
  'statusId',
  'priorityId',
  'categoryId',
  'categoryIds',
  'excludeCategoryIds',
  'searchQuery',
  'tags',
  'assignedToIds',
  'assignedTeamIds',
  'includeUnassigned',
  'dueDateFilter',
  'dueDateFrom',
  'dueDateTo',
  'responseState',
  'slaStatusFilter',
  'bundleView',
  'sortBy',
  'sortDirection',
] as const;

/** True when the URL expresses filter intent beyond which board to show. */
export function hasTicketViewFilterParams(search: string): boolean {
  const params = new URLSearchParams(search);
  return TICKET_VIEW_URL_FILTER_PARAMS.some(param => (params.get(param) ?? '').trim().length > 0);
}

export type InitialBoardTabDecision =
  | { apply: false; reason: 'url-wins' | 'no-preference' | 'board-unavailable' }
  | { apply: true; boardId: string };

/**
 * URL-vs-preference precedence for the first paint: a shared link always wins,
 * so the stored last-active board only applies to a URL with no board opinion.
 * A stored board that no longer exists is ignored rather than producing an
 * empty list on a tab that cannot be rendered.
 */
export function resolveInitialBoardTab(params: {
  urlHasBoardFilter: boolean;
  storedBoardId: string | null | undefined;
  availableBoardIds: readonly string[];
}): InitialBoardTabDecision {
  const { urlHasBoardFilter, storedBoardId, availableBoardIds } = params;

  if (urlHasBoardFilter) {
    return { apply: false, reason: 'url-wins' };
  }
  const boardId = (storedBoardId ?? '').trim();
  if (!boardId) {
    return { apply: false, reason: 'no-preference' };
  }
  if (!availableBoardIds.includes(boardId)) {
    return { apply: false, reason: 'board-unavailable' };
  }
  return { apply: true, boardId };
}
