import { describe, expect, it } from 'vitest';
import type { ITicketListFilters } from '@alga-psa/types';
import { ticketListViewFiltersSchema, buildListViewSettingsSchema } from '@alga-psa/list-views';
import {
  captureTicketListView,
  createTicketListViewAdapter,
  type TicketListLiveState,
  type TicketListViewContext,
} from '../ticketListViewAdapter';
import { resolveTicketViewSettings } from '../ticketViewSettings';
import { TICKET_STATUS_FILTER_OPEN } from '../ticketStatusFilter';

const BOARD_SERVICE_DESK = 'b0000000-0000-4000-8000-000000000001';
const BOARD_PROJECTS = 'b0000000-0000-4000-8000-000000000002';
const STATUS_NEW = 's0000000-0000-4000-8000-000000000001';
const USER_ANA = 'u0000000-0000-4000-8000-000000000001';

const neutral = (): Partial<ITicketListFilters> => ({
  statusId: TICKET_STATUS_FILTER_OPEN,
  priorityId: 'all',
  showOpenOnly: true,
  boardFilterState: 'active',
  bundleView: 'bundled',
  searchQuery: '',
  sortBy: 'entered_at',
  sortDirection: 'desc',
});

const context: TicketListViewContext = {
  neutralFilters: neutral,
  resolveBaselineForBoard: () => resolveTicketViewSettings({}),
  baseline: (live) => ({
    filters: { ...neutral(), boardIds: live.filters.boardIds },
    presentation: resolveTicketViewSettings({}),
    pageSize: live.pageSize,
    columnSizing: undefined,
  }),
  known: {
    boardIds: new Set([BOARD_SERVICE_DESK, BOARD_PROJECTS]),
    statusIds: new Set([STATUS_NEW]),
    userIds: new Set([USER_ANA]),
    tags: new Set(['vip']),
  },
};

const adapter = createTicketListViewAdapter(context);
const envelopeSchema = buildListViewSettingsSchema(ticketListViewFiltersSchema);

function liveState(overrides: Partial<TicketListLiveState> = {}): TicketListLiveState {
  const presentation = resolveTicketViewSettings({});
  return {
    filters: {
      ...neutral(),
      boardIds: [BOARD_SERVICE_DESK],
      statusId: STATUS_NEW,
      showOpenOnly: false,
      assignedToIds: [USER_ANA],
      includeUnassigned: true,
      tags: ['vip'],
      searchQuery: 'printer',
      sortBy: 'due_date',
      sortDirection: 'asc',
    },
    presentation: {
      ...presentation,
      columnVisibility: { ...presentation.columnVisibility, client: false },
      densityLevel: 30,
    },
    pageSize: 25,
    columnSizing: { title: 320 },
    ...overrides,
  };
}

describe('ticket list view adapter', () => {
  it('captures a document the strict write schema accepts, without search text', () => {
    const captured = captureTicketListView(liveState());
    expect(envelopeSchema.safeParse(captured).success).toBe(true);
    expect(captured.filters).not.toHaveProperty('searchQuery');
    expect(captured.filters).not.toHaveProperty('sortBy');
    expect(captured.sort).toEqual({ by: 'due_date', direction: 'asc' });
    expect(captured.filters?.boardIds).toEqual([BOARD_SERVICE_DESK]);
    expect(captured.density).toBe(30);
    expect(captured.pageSize).toBe(25);
    expect(captured.columns?.sizing).toEqual({ title: 320 });
    expect(captured.columns?.visibility?.client).toBe(false);
  });

  it('round-trips board scope, filters, sort, columns, density and page size', () => {
    const original = liveState();
    const captured = adapter.capture(original);

    const elsewhere = liveState({
      filters: { ...neutral(), boardIds: [BOARD_PROJECTS], searchQuery: 'x' },
      presentation: resolveTicketViewSettings({}),
      pageSize: 10,
      columnSizing: undefined,
    });
    const applied = adapter.apply(captured, elsewhere);

    expect(applied.filters.boardIds).toEqual([BOARD_SERVICE_DESK]);
    expect(applied.filters.statusId).toBe(STATUS_NEW);
    expect(applied.filters.showOpenOnly).toBe(false);
    expect(applied.filters.assignedToIds).toEqual([USER_ANA]);
    expect(applied.filters.searchQuery).toBe('');
    expect(applied.filters.sortBy).toBe('due_date');
    expect(applied.filters.sortDirection).toBe('asc');
    expect(applied.presentation.columnVisibility.client).toBe(false);
    expect(applied.presentation.densityLevel).toBe(30);
    expect(applied.pageSize).toBe(25);
    expect(applied.columnSizing).toEqual({ title: 320 });

    expect(adapter.differs(applied, captured)).toBe(false);
  });

  it('reads as dirty after a filter, sort or column change, but not after a search', () => {
    const captured = adapter.capture(liveState());
    const applied = adapter.apply(captured, liveState());

    expect(adapter.differs({ ...applied, filters: { ...applied.filters, searchQuery: 'router' } }, captured)).toBe(false);
    expect(adapter.differs({ ...applied, filters: { ...applied.filters, priorityId: 'p1' } }, captured)).toBe(true);
    expect(adapter.differs({ ...applied, filters: { ...applied.filters, sortDirection: 'desc' } }, captured)).toBe(true);
    expect(adapter.differs({ ...applied, columnSizing: { title: 200 } }, captured)).toBe(true);
  });

  it('drops references to boards, statuses, users and tags that no longer exist', () => {
    const captured = adapter.capture(liveState({
      filters: {
        ...neutral(),
        boardIds: [BOARD_SERVICE_DESK, 'b-deleted'],
        statusId: 's-deleted',
        assignedToIds: [USER_ANA, 'u-deleted'],
        tags: ['vip', 'retired'],
        priorityId: 'all',
      },
    }));

    const { settings, dropped } = adapter.sanitize(captured);
    expect(settings.filters?.boardIds).toEqual([BOARD_SERVICE_DESK]);
    expect(settings.filters).not.toHaveProperty('statusId');
    expect(settings.filters?.assignedToIds).toEqual([USER_ANA]);
    expect(settings.filters?.tags).toEqual(['vip']);
    // Pseudo-values are not ids and survive.
    expect(settings.filters?.priorityId).toBe('all');
    expect(dropped.map((entry) => entry.field).sort()).toEqual(['assignedToIds', 'boardIds', 'statusId', 'tags']);

    // A dropped status falls back to the open-status baseline on apply.
    expect(adapter.apply(settings, liveState()).filters.statusId).toBe(TICKET_STATUS_FILTER_OPEN);
  });

  it('keeps values whose universe is unknown rather than dropping them', () => {
    const captured = adapter.capture(liveState({
      filters: { ...neutral(), assignedTeamIds: ['t-any'], clientId: 'c-any' },
    }));
    const { settings, dropped } = adapter.sanitize(captured);
    expect(settings.filters?.assignedTeamIds).toEqual(['t-any']);
    expect(settings.filters?.clientId).toBe('c-any');
    expect(dropped).toEqual([]);
  });

  it('returns to the baseline for a null view', () => {
    const baseline = adapter.apply(null, liveState());
    expect(baseline.filters.statusId).toBe(TICKET_STATUS_FILTER_OPEN);
    expect(baseline.filters.boardIds).toEqual([BOARD_SERVICE_DESK]);
    expect(baseline.columnSizing).toBeUndefined();
  });
});
