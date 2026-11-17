/* @vitest-environment jsdom */
import React from 'react';
import { act, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ITicketListFilters, IUser } from '@alga-psa/types';
import { decodeTicketWhere } from '../lib/ticketWhereUrl';
import type { TicketFilterChangeOptions } from '../lib/ticketFilterChange';

/**
 * Live-change focus held by the container (T007 container half, T008, T009): the overlay is the only
 * scope of the focused request, never reaches activeFilters, the URL or saved views, and every way back
 * to the full list uses the full list's own filters.
 */

const fetchTicketsWithPagination = vi.fn(async (): Promise<any> => ({ tickets: [], totalCount: 0, loadedAt: 100 }));

let currentPathname = '/msp/tickets';

vi.mock('next/navigation', () => ({
  usePathname: () => currentPathname,
}));

type DashboardProps = {
  onFocusOnChanges: (kind: 'new' | 'updated', ids: string[], capped?: boolean) => Promise<boolean>;
  focus: { kind: string; ticketIds: string[]; capped: boolean } | null;
  filterValues: Partial<ITicketListFilters>;
  totalCount: number;
  loadedFilters: Partial<ITicketListFilters>;
  onFilterChange: (update: Partial<ITicketListFilters>, options?: TicketFilterChangeOptions) => void;
  onNavigateAway?: () => void;
  onRefreshListForChanges: () => Promise<unknown>;
  loadedAt: number;
  initialTickets: unknown[];
};

let dashboardProps: DashboardProps | null = null;

vi.mock('./TicketingDashboard', () => ({
  default: (props: DashboardProps) => {
    dashboardProps = props;
    return null;
  },
}));

vi.mock('../actions/optimizedTicketActions', () => ({
  fetchTicketsWithPagination: (...args: unknown[]) => fetchTicketsWithPagination(...(args as [])),
  loadTicketListItemsByIds: vi.fn(),
}));

// The container's saved-views hook loads views on mount. Left real, that server
// action settles after jsdom is torn down and its state update throws an
// unhandled `window is not defined` that fails the whole shard.
const listViewActions = vi.hoisted(() => ({
  listListViews: vi.fn(async () => ({ views: [], defaultViewId: null, canShare: false })),
  getListView: vi.fn(async () => ({ actionError: 'View not found.' })),
  createListView: vi.fn(),
  updateListView: vi.fn(),
  deleteListView: vi.fn(),
  setMyDefaultListView: vi.fn(),
}));
vi.mock('@alga-psa/list-views/actions/listViewActions', () => listViewActions);

const toastMock = vi.hoisted(() => Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }));
vi.mock('react-hot-toast', () => ({
  toast: toastMock,
}));

// Stable `t`: the container's effects re-run when it changes identity, which would cancel the debounced fetch.
const translation = vi.hoisted(() => ({
  t: (_key: string, fallback?: string) => (typeof fallback === 'string' ? fallback : _key),
}));
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => translation,
}));

vi.mock('@alga-psa/user-composition/hooks', () => ({
  useUserPreference: () => ({
    value: null,
    setValue: vi.fn(),
    isLoading: false,
    hasLoadedInitial: true,
  }),
}));

vi.mock('../hooks/useTicketFormOptions', () => ({
  useTicketFormOptions: () => ({ options: null }),
}));

const { default: TicketingDashboardContainer } = await import('./TicketingDashboardContainer');

const consolidatedData = {
  tickets: [],
  totalCount: 0,
  options: {
    boardOptions: [],
    statusOptions: [],
    priorityOptions: [],
    categories: [],
    clients: [],
    users: [],
    tags: [],
  },
} as unknown as React.ComponentProps<typeof TicketingDashboardContainer>['consolidatedData'];

const currentUser = { user_id: 'user-1', tenant: 'tenant-1' } as IUser;

function renderContainer() {
  const view = render(
    <TicketingDashboardContainer
      consolidatedData={consolidatedData}
      currentUser={currentUser}
    />,
  );
  if (!dashboardProps) {
    throw new Error('TicketingDashboard was not rendered');
  }
  return { props: dashboardProps, view };
}


const FOCUS_IDS = ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002'];
const FULL_ROWS = [{ ticket_id: 'full-1' }, { ticket_id: 'full-2' }];
const FOCUSED_ROWS = [{ ticket_id: FOCUS_IDS[0] }, { ticket_id: FOCUS_IDS[1] }];

const lastRequest = () => {
  const calls = fetchTicketsWithPagination.mock.calls as unknown as Array<[ITicketListFilters, number, number]>;
  return calls[calls.length - 1];
};

describe('ticket list live-change focus overlay', () => {
  beforeEach(() => {
    dashboardProps = null;
    fetchTicketsWithPagination.mockReset();
    fetchTicketsWithPagination.mockResolvedValue({ tickets: FULL_ROWS, totalCount: 2, loadedAt: 100 });
    listViewActions.listListViews.mockClear();
    listViewActions.getListView.mockClear();
    window.history.replaceState(null, '', '/msp/tickets?boardIds=board-a&statusId=closed-x&sortBy=title&sortDirection=asc');
  });

  afterEach(async () => {
    await act(async () => {
      await Promise.all(listViewActions.listListViews.mock.results.map((r) => r.value));
      await Promise.all(listViewActions.getListView.mock.results.map((r) => r.value));
    });
  });

  const renderFocusable = () => render(
    <TicketingDashboardContainer
      consolidatedData={{ ...consolidatedData, tickets: FULL_ROWS as any, totalCount: 2, loadedAt: 50 }}
      currentUser={currentUser}
      initialFilters={{ boardIds: ['board-a'], statusId: 'closed-x', sortBy: 'title', sortDirection: 'asc' }}
    />,
  );

  async function enterFocus(kind: 'new' | 'updated' = 'new') {
    fetchTicketsWithPagination.mockResolvedValueOnce({ tickets: FOCUSED_ROWS, totalCount: 2, loadedAt: 200 });
    await act(async () => { await dashboardProps!.onFocusOnChanges(kind, FOCUS_IDS); });
  }

  it('T007: focus fetches with only the ticket_id clause, keeps sort and page size, and leaves filters, URL and saved views alone', async () => {
    renderFocusable();
    const urlBefore = window.location.search;
    const filterValuesBefore = dashboardProps!.filterValues;
    const replaceState = vi.spyOn(window.history, 'replaceState');
    const pushState = vi.spyOn(window.history, 'pushState');

    await enterFocus();

    const [request, page, size] = lastRequest();
    expect(request.where).toEqual({ join: 'and', clauses: [{ path: 'ticket_id', operator: 'in', value: FOCUS_IDS }] });
    expect(request.boardFilterState).toBe('all');
    expect(request.bundleView).toBe('individual');
    expect(request.boardIds).toBeUndefined();
    expect(request.searchQuery).toBe('');
    expect(request.sortBy).toBe('title');
    expect(request.sortDirection).toBe('asc');
    expect([page, size]).toEqual([1, 10]);

    expect(dashboardProps!.focus).toEqual({ kind: 'new', ticketIds: FOCUS_IDS, capped: false });
    expect(dashboardProps!.initialTickets).toEqual(FOCUSED_ROWS);
    expect(dashboardProps!.loadedAt).toBe(200);
    // The overlay is not a filter edit.
    expect(dashboardProps!.filterValues).toBe(filterValuesBefore);
    expect(dashboardProps!.filterValues.where).toBeUndefined();
    expect(window.location.search).toBe(urlBefore);
    expect(replaceState).not.toHaveBeenCalled();
    expect(pushState).not.toHaveBeenCalled();
    replaceState.mockRestore();
    pushState.mockRestore();
  });

  it('T007: paging while focused stays focused and does not write the page to the URL', async () => {
    renderFocusable();
    await enterFocus();
    const urlBefore = window.location.search;
    await act(async () => { await (dashboardProps as any).onPageChange(2); });
    expect(lastRequest()[0].where?.clauses[0]).toMatchObject({ path: 'ticket_id' });
    expect(lastRequest()[1]).toBe(2);
    expect(window.location.search).toBe(urlBefore);
  });

  it('T007: "Show all tickets" restores the original request and page', async () => {
    renderFocusable();
    await enterFocus();
    fetchTicketsWithPagination.mockResolvedValueOnce({ tickets: FULL_ROWS, totalCount: 2, loadedAt: 300 });
    await act(async () => { await dashboardProps!.onRefreshListForChanges(); });

    const [request] = lastRequest();
    expect(request.where).toBeUndefined();
    expect(request.boardIds).toEqual(['board-a']);
    expect(request.statusId).toBe('closed-x');
    expect(request.sortBy).toBe('title');
    expect(dashboardProps!.focus).toBeNull();
    expect(dashboardProps!.initialTickets).toEqual(FULL_ROWS);
    expect(dashboardProps!.loadedAt).toBe(300);
  });

  it('T007: a failed focus request leaves the list and the full-list refresh intact', async () => {
    renderFocusable();
    fetchTicketsWithPagination.mockResolvedValueOnce({ actionError: 'nope' });
    await act(async () => { await dashboardProps!.onFocusOnChanges('new', FOCUS_IDS); });
    expect(dashboardProps!.focus).toBeNull();
    expect(dashboardProps!.initialTickets).toEqual(FULL_ROWS);
    await act(async () => { await dashboardProps!.onRefreshListForChanges(); });
    expect(lastRequest()[0].where).toBeUndefined();
  });

  it('T008: "Refresh list" while focused refetches the full list with the full list\'s filters', async () => {
    renderFocusable();
    await enterFocus('updated');
    expect(dashboardProps!.focus?.kind).toBe('updated');
    fetchTicketsWithPagination.mockResolvedValueOnce({ tickets: FULL_ROWS, totalCount: 2, loadedAt: 400 });
    await act(async () => { await dashboardProps!.onRefreshListForChanges(); });
    const [request, page] = lastRequest();
    expect(request.where).toBeUndefined();
    expect(request.boardIds).toEqual(['board-a']);
    expect(request.statusId).toBe('closed-x');
    expect(page).toBe(1);
    expect(dashboardProps!.focus).toBeNull();
    expect(dashboardProps!.loadedFilters.where).toBeUndefined();
  });

  it('T009: changing a filter while focused leaves focus and applies the edit to the original filters', async () => {
    renderFocusable();
    await enterFocus();
    fetchTicketsWithPagination.mockResolvedValueOnce({ tickets: FULL_ROWS, totalCount: 2, loadedAt: 500 });
    act(() => { dashboardProps!.onFilterChange({ priorityId: 'p-high' }); });
    // The edit is debounced; focus is left from the moment of the edit, so nothing else can be built from it.
    await waitFor(() => expect(fetchTicketsWithPagination).toHaveBeenCalledTimes(2), { timeout: 2000 });

    const [request] = lastRequest();
    expect(request.where).toBeUndefined();
    expect(request.priorityId).toBe('p-high');
    expect(request.boardIds).toEqual(['board-a']);
    expect(request.statusId).toBe('closed-x');
    await waitFor(() => expect(dashboardProps!.focus).toBeNull());
    expect(dashboardProps!.filterValues.priorityId).toBe('p-high');
    expect(dashboardProps!.filterValues.where).toBeUndefined();
    expect(new URLSearchParams(window.location.search).get('priorityId')).toBe('p-high');
  });

  it('T009: the list view popstate leaves focus too', async () => {
    renderFocusable();
    await enterFocus();
    fetchTicketsWithPagination.mockResolvedValueOnce({ tickets: FULL_ROWS, totalCount: 2, loadedAt: 600 });
    window.history.replaceState(null, '', '/msp/tickets?boardIds=board-b');
    await act(async () => { window.dispatchEvent(new PopStateEvent('popstate')); });
    await waitFor(() => expect(dashboardProps!.focus).toBeNull());
    expect(lastRequest()[0].where).toBeUndefined();
    expect(lastRequest()[0].boardIds).toEqual(['board-b']);
  });
});
