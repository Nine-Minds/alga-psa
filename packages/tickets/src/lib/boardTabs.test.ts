// @vitest-environment node

import { describe, expect, it } from 'vitest';
import type { IBoard } from '@alga-psa/types';
import {
  ALL_BOARDS_TAB_ID,
  boardIdFromTabId,
  boardTabId,
  boardTabSelection,
  buildBoardSelectionFilterUpdate,
  buildBoardTabs,
  hasBoardFilterParam,
  resolveActiveBoardId,
  resolveInitialBoardTab,
} from './boardTabs';
import { NO_BOARD_VALUE } from './boardFilterValues';
import {
  createTicketStatusNameFilterValue,
  TICKET_STATUS_FILTER_ALL,
  TICKET_STATUS_FILTER_OPEN,
  type TicketStatusFilterOption,
} from './ticketStatusFilter';

const BOARD_A = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const BOARD_B = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
const BOARD_C = 'cccccccc-cccc-4ccc-cccc-cccccccccccc';

function board(overrides: Partial<IBoard> & { board_id: string }): IBoard {
  return {
    tenant: 'tenant-1',
    is_inactive: false,
    // Pinned by default: these fixtures predate pinning and exercise ordering,
    // counts and labels, so they should keep exercising exactly that. Pinning
    // has its own cases below.
    is_pinned: true,
    ...overrides,
  } as IBoard;
}

// Statuses as getTicketFormOptions supplies them: board-scoped rows, plus the
// two sentinel entries that buildTicketStatusFilterOptions always re-adds.
const STATUS_OPTIONS: TicketStatusFilterOption[] = [
  { value: TICKET_STATUS_FILTER_OPEN, label: 'All open statuses' },
  { value: TICKET_STATUS_FILTER_ALL, label: 'All Statuses' },
  { value: 'status-a-triage', label: 'Triage', statusName: 'Triage', boardId: BOARD_A, isClosed: false },
  { value: 'status-a-done', label: 'Done', statusName: 'Done', boardId: BOARD_A, isClosed: true },
  { value: 'status-b-waiting', label: 'Waiting on vendor', statusName: 'Waiting on vendor', boardId: BOARD_B, isClosed: false },
];

const TRIAGE = createTicketStatusNameFilterValue('Triage');
const WAITING_ON_VENDOR = createTicketStatusNameFilterValue('Waiting on vendor');

describe('board tab ids', () => {
  it('round-trips a board id through its tab id', () => {
    expect(boardTabId(BOARD_A)).not.toBe(ALL_BOARDS_TAB_ID);
    expect(boardIdFromTabId(boardTabId(BOARD_A))).toBe(BOARD_A);
  });

  it('maps the All tickets tab to a null board id in both directions', () => {
    expect(boardTabId(null)).toBe(ALL_BOARDS_TAB_ID);
    expect(boardIdFromTabId(ALL_BOARDS_TAB_ID)).toBeNull();
  });
});

describe('resolveActiveBoardId', () => {
  it('activates a board tab only for exactly one real board', () => {
    expect(resolveActiveBoardId([BOARD_A])).toBe(BOARD_A);
    expect(resolveActiveBoardId([])).toBeNull();
    expect(resolveActiveBoardId([BOARD_A, BOARD_B])).toBeNull();
  });

  it('treats the "no board" sentinel as the All tickets tab, not a board tab', () => {
    expect(resolveActiveBoardId([NO_BOARD_VALUE])).toBeNull();
  });
});

describe('tab selection -> filter state', () => {
  it('scopes the filter to a single board when a board tab is clicked', () => {
    const selection = boardTabSelection(BOARD_A);
    const update = buildBoardSelectionFilterUpdate({
      selectedBoards: selection.selectedBoards,
      excludedBoards: selection.excludedBoards,
      statusOptions: STATUS_OPTIONS,
      currentStatusId: TICKET_STATUS_FILTER_OPEN,
    });

    expect(update.boardIds).toEqual([BOARD_A]);
    expect(update.boardId).toBeUndefined();
    expect(update.excludeBoardIds).toBeUndefined();
    // Single-board scope is what makes the status dropdown board-scoped.
    expect(resolveActiveBoardId(update.boardIds!)).toBe(BOARD_A);
  });

  it('clears every board dimension when the All tickets tab is clicked', () => {
    const selection = boardTabSelection(null);
    const update = buildBoardSelectionFilterUpdate({
      selectedBoards: selection.selectedBoards,
      excludedBoards: selection.excludedBoards,
      statusOptions: STATUS_OPTIONS,
      currentStatusId: TICKET_STATUS_FILTER_OPEN,
    });

    expect(update.boardIds).toBeUndefined();
    expect(update.boardId).toBeUndefined();
    expect(update.excludeBoardIds).toBeUndefined();
  });

  it('keeps a status that still exists on the newly selected board', () => {
    const update = buildBoardSelectionFilterUpdate({
      selectedBoards: [BOARD_A],
      excludedBoards: [],
      statusOptions: STATUS_OPTIONS,
      currentStatusId: TRIAGE,
    });

    expect(update.statusId).toBe(TRIAGE);
    expect(update.showOpenOnly).toBe(false);
  });

  it('falls back to all-open when the current status does not exist on the new board', () => {
    const update = buildBoardSelectionFilterUpdate({
      selectedBoards: [BOARD_B],
      excludedBoards: [],
      statusOptions: STATUS_OPTIONS,
      currentStatusId: TRIAGE,
    });

    expect(update.statusId).toBe(TICKET_STATUS_FILTER_OPEN);
    expect(update.showOpenOnly).toBe(true);
  });

  it('keeps a board-specific status when switching back to All tickets', () => {
    // Unscoped options include every board's statuses, so nothing is dropped.
    const update = buildBoardSelectionFilterUpdate({
      selectedBoards: [],
      excludedBoards: [],
      statusOptions: STATUS_OPTIONS,
      currentStatusId: WAITING_ON_VENDOR,
    });

    expect(update.statusId).toBe(WAITING_ON_VENDOR);
  });

  it('preserves multi-select include/exclude sets from the picker', () => {
    const update = buildBoardSelectionFilterUpdate({
      selectedBoards: [BOARD_A, BOARD_B],
      excludedBoards: [BOARD_C],
      statusOptions: STATUS_OPTIONS,
      currentStatusId: TICKET_STATUS_FILTER_OPEN,
    });

    expect(update.boardIds).toEqual([BOARD_A, BOARD_B]);
    expect(update.excludeBoardIds).toEqual([BOARD_C]);
  });
});

describe('buildBoardTabs', () => {
  const boards = [
    board({ board_id: BOARD_B, board_name: 'Support', display_order: 2 }),
    board({ board_id: BOARD_A, board_name: 'Escalations', display_order: 1 }),
    board({ board_id: BOARD_C, board_name: 'Archived', is_inactive: true, display_order: 3 }),
  ];

  const buildWith = (activeBoardId: string | null, stats?: Record<string, { openTicketCount: number }> | null) =>
    buildBoardTabs({
      boards,
      activeBoardId,
      stats,
      allTabLabel: 'All tickets',
      unnamedBoardLabel: 'Unnamed board',
    });

  it('leads with All tickets and lists active boards in display order', () => {
    const tabs = buildWith(null);
    expect(tabs.map(tab => tab.label)).toEqual(['All tickets', 'Escalations', 'Support']);
    expect(tabs[0].id).toBe(ALL_BOARDS_TAB_ID);
    expect(tabs[0].boardId).toBeNull();
  });

  it('hides inactive boards unless one is currently selected', () => {
    expect(buildWith(null).some(tab => tab.boardId === BOARD_C)).toBe(false);

    const withArchived = buildWith(BOARD_C);
    const archivedTab = withArchived.find(tab => tab.boardId === BOARD_C);
    expect(archivedTab).toBeDefined();
    expect(archivedTab!.isInactive).toBe(true);
  });

  it('renders open-ticket counts when stats are available', () => {
    const tabs = buildWith(null, { [BOARD_A]: { openTicketCount: 7 } });
    expect(tabs.find(tab => tab.boardId === BOARD_A)!.openTicketCount).toBe(7);
    // A board missing from the stats map gets no pill rather than a fake zero.
    expect(tabs.find(tab => tab.boardId === BOARD_B)!.openTicketCount).toBeNull();
  });

  it('renders tabs without counts when the stats call failed or has not landed', () => {
    expect(buildWith(null, null).every(tab => tab.openTicketCount === null)).toBe(true);
    // getBoardListStats returns {} on error.
    expect(buildWith(null, {}).every(tab => tab.openTicketCount === null)).toBe(true);
  });

  it('never renders a count pill on All tickets', () => {
    const tabs = buildWith(null, { [BOARD_A]: { openTicketCount: 7 }, [BOARD_B]: { openTicketCount: 3 } });
    expect(tabs[0].openTicketCount).toBeNull();
  });

  it('excludes boards that are not pinned', () => {
    const tabs = buildBoardTabs({
      boards: [
        board({ board_id: BOARD_A, board_name: 'Escalations', display_order: 1 }),
        board({ board_id: BOARD_B, board_name: 'Support', display_order: 2, is_pinned: false }),
      ],
      activeBoardId: null,
      stats: null,
      allTabLabel: 'All tickets',
      unnamedBoardLabel: 'Unnamed board',
    });
    expect(tabs.map(tab => tab.label)).toEqual(['All tickets', 'Escalations']);
  });

  it('renders a transient tab for an unpinned board that is deep-linked to', () => {
    // The same escape-hatch clause that keeps a selected inactive board
    // representable: no new branch, and the tab disappears when you leave.
    const boardsWithUnpinned = [
      board({ board_id: BOARD_A, board_name: 'Escalations', display_order: 1 }),
      board({ board_id: BOARD_B, board_name: 'Support', display_order: 2, is_pinned: false }),
    ];
    const tabs = buildBoardTabs({
      boards: boardsWithUnpinned,
      activeBoardId: BOARD_B,
      stats: null,
      allTabLabel: 'All tickets',
      unnamedBoardLabel: 'Unnamed board',
    });
    expect(tabs.map(tab => tab.boardId)).toEqual([null, BOARD_A, BOARD_B]);
  });

  it('treats a board with no pinning decision as unpinned', () => {
    const tabs = buildBoardTabs({
      boards: [{ tenant: 'tenant-1', is_inactive: false, board_id: BOARD_A, board_name: 'Escalations' } as IBoard],
      activeBoardId: null,
      stats: null,
      allTabLabel: 'All tickets',
      unnamedBoardLabel: 'Unnamed board',
    });
    expect(tabs.map(tab => tab.label)).toEqual(['All tickets']);
  });

  it('renders All tickets alone when nothing is pinned, rather than hiding', () => {
    // A legitimate state: an admin unpinned everything. The screen must not lose
    // its navigation as a result.
    const tabs = buildBoardTabs({
      boards: [
        board({ board_id: BOARD_A, board_name: 'Escalations', is_pinned: false }),
        board({ board_id: BOARD_B, board_name: 'Support', is_pinned: false }),
      ],
      activeBoardId: null,
      stats: null,
      allTabLabel: 'All tickets',
      unnamedBoardLabel: 'Unnamed board',
    });
    expect(tabs).toHaveLength(1);
    expect(tabs[0].id).toBe(ALL_BOARDS_TAB_ID);
  });

  it('falls back to a placeholder label for an unnamed board', () => {
    const tabs = buildBoardTabs({
      boards: [board({ board_id: BOARD_A })],
      activeBoardId: null,
      stats: null,
      allTabLabel: 'All tickets',
      unnamedBoardLabel: 'Unnamed board',
    });
    expect(tabs[1].label).toBe('Unnamed board');
  });
});

describe('hasBoardFilterParam', () => {
  it.each([
    ['?boardId=x', true],
    ['?boardIds=x,y', true],
    ['?excludeBoardIds=x', true],
    ['', false],
    ['?statusId=x&page=2', false],
    ['?boardId=', false],
  ])('%s -> %s', (search, expected) => {
    expect(hasBoardFilterParam(search)).toBe(expected);
  });
});

describe('resolveInitialBoardTab (URL beats preference)', () => {
  it('does not apply the preference when the URL names a board', () => {
    expect(resolveInitialBoardTab({
      urlHasBoardFilter: true,
      storedBoardId: BOARD_A,
      availableBoardIds: [BOARD_A, BOARD_B],
    })).toEqual({ apply: false, reason: 'url-wins' });
  });

  it('applies the stored board on a bare URL', () => {
    expect(resolveInitialBoardTab({
      urlHasBoardFilter: false,
      storedBoardId: BOARD_A,
      availableBoardIds: [BOARD_A, BOARD_B],
    })).toEqual({ apply: true, boardId: BOARD_A });
  });

  it.each([
    ['a fresh user', undefined],
    ['a null preference', null],
    ['an explicit All tickets preference', ''],
    ['a whitespace-only value', '   '],
  ])('lands on All tickets for %s', (_label, storedBoardId) => {
    expect(resolveInitialBoardTab({
      urlHasBoardFilter: false,
      storedBoardId: storedBoardId as string | null | undefined,
      availableBoardIds: [BOARD_A],
    })).toEqual({ apply: false, reason: 'no-preference' });
  });

  it('ignores a stored board that no longer exists', () => {
    expect(resolveInitialBoardTab({
      urlHasBoardFilter: false,
      storedBoardId: BOARD_C,
      availableBoardIds: [BOARD_A, BOARD_B],
    })).toEqual({ apply: false, reason: 'board-unavailable' });
  });
});
