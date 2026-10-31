/* @vitest-environment jsdom */
import React from 'react';
import { act, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ITicketListFilters, IUser } from '@alga-psa/types';
import { decodeTicketWhere } from '../lib/ticketWhereUrl';
import type { TicketFilterChangeOptions } from '../lib/ticketFilterChange';

/**
 * AC12 on a fresh page load: an unknown-version or malformed `where` is dropped
 * with a toast and stripped from the URL (syncFromUrl only covers popstate).
 */

const fetchTicketsWithPagination = vi.fn(async () => ({ tickets: [], totalCount: 0 }));

let currentPathname = '/msp/tickets';

vi.mock('next/navigation', () => ({
  usePathname: () => currentPathname,
}));

type DashboardProps = {
  onFilterChange: (update: Partial<ITicketListFilters>, options?: TicketFilterChangeOptions) => void;
  onNavigateAway?: () => void;
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

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => (typeof fallback === 'string' ? fallback : _key),
  }),
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

const MALFORMED = 'v1:contact.tags:bogus_op:x';
const UNKNOWN_VERSION = 'v9:contact.tags:in:abc';
const DROPPED_TEXT = 'Some filters in this link are not valid and were ignored.';

describe('ticket list initial-load where drop (AC12)', () => {
  beforeEach(() => {
    dashboardProps = null;
    toastMock.mockClear();
    fetchTicketsWithPagination.mockClear();
    listViewActions.listListViews.mockClear();
    listViewActions.getListView.mockClear();
  });

  afterEach(async () => {
    await waitFor(() => expect(listViewActions.listListViews).toHaveBeenCalledWith('tickets'));
    await act(async () => {
      await Promise.all(listViewActions.listListViews.mock.results.map((r) => r.value));
    });
    await act(async () => {
      await Promise.all(listViewActions.getListView.mock.results.map((r) => r.value));
    });
  });

  function renderAt(search: string, strict = false) {
    window.history.replaceState(null, '', `/msp/tickets${search}`);
    const ui = (
      <TicketingDashboardContainer consolidatedData={consolidatedData} currentUser={currentUser} />
    );
    return render(strict ? <React.StrictMode>{ui}</React.StrictMode> : ui);
  }

  it.each([
    ['malformed', MALFORMED],
    ['unknown-version', UNKNOWN_VERSION],
  ])('toasts once and strips a %s where', (_label, where) => {
    const replaceState = vi.spyOn(window.history, 'replaceState');
    renderAt(`?where=${encodeURIComponent(where)}`);
    expect(toastMock).toHaveBeenCalledTimes(1);
    expect(toastMock).toHaveBeenCalledWith(DROPPED_TEXT);
    expect(new URLSearchParams(window.location.search).has('where')).toBe(false);
    expect(replaceState).toHaveBeenCalled();
    expect(fetchTicketsWithPagination).not.toHaveBeenCalled();
    replaceState.mockRestore();
  });

  it('toasts only once under StrictMode and keeps other params', () => {
    renderAt(`?pageSize=25&where=${encodeURIComponent(UNKNOWN_VERSION)}`, true);
    expect(toastMock).toHaveBeenCalledTimes(1);
    expect(window.location.search).toBe('?pageSize=25');
  });

  it('keeps the valid clauses of a partly valid where', () => {
    renderAt(`?where=${encodeURIComponent(`${MALFORMED};contact.tags:is_empty`)}`);
    expect(toastMock).toHaveBeenCalledTimes(1);
    const rewritten = new URLSearchParams(window.location.search).get('where');
    expect(rewritten === null || !rewritten.includes('bogus_op')).toBe(true);
  });

  it('does not toast again on a later popstate to the rewritten URL', () => {
    renderAt(`?where=${encodeURIComponent(MALFORMED)}`);
    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(toastMock).toHaveBeenCalledTimes(1);
    expect(fetchTicketsWithPagination).not.toHaveBeenCalled();
  });

  it('leaves a valid where untouched and silent', () => {
    const valid = 'v1:contact.tags:is_empty';
    const replaceState = vi.spyOn(window.history, 'replaceState');
    renderAt(`?where=${encodeURIComponent(valid)}`);
    expect(decodeTicketWhere(valid).dropped).toBe(0);
    expect(toastMock).not.toHaveBeenCalled();
    expect(new URLSearchParams(window.location.search).get('where')).toBe(valid);
    replaceState.mockRestore();
  });
});
