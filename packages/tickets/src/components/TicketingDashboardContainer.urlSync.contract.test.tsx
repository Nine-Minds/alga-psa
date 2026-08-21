/* @vitest-environment jsdom */
import React from 'react';
import { act, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ITicketListFilters, IUser } from '@alga-psa/types';
import type { TicketFilterChangeOptions } from '../lib/ticketFilterChange';

/**
 * The regression guard for "click the first ticket, it opens for a beat and
 * snaps back to the list on a different board".
 *
 * The list mirrors its filter state into the address bar with
 * `history.replaceState`. `router.push` is asynchronous, so the dashboard is
 * still mounted — and its debounced writers still armed — while the detail route
 * resolves. Any write that lands in that window replaces the entry the router
 * just pushed, and Next reconciles back to the list URL it finds.
 *
 * So: once the dashboard reports a navigation, the container must not touch
 * history again, and the pending filter fetch must not fire either.
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
}));

vi.mock('react-hot-toast', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
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

describe('ticket list URL sync after navigating away', () => {
  beforeEach(() => {
    dashboardProps = null;
    currentPathname = '/msp/tickets';
    fetchTicketsWithPagination.mockClear();
    window.history.replaceState(null, '', '/msp/tickets');
  });

  it('mirrors a filter change into the URL while the list is still the page', () => {
    const { props } = renderContainer();
    const replaceState = vi.spyOn(window.history, 'replaceState').mockImplementation(() => {});
    const pushState = vi.spyOn(window.history, 'pushState').mockImplementation(() => {});

    act(() => {
      props.onFilterChange({ priorityId: 'priority-1' });
    });

    expect(replaceState).toHaveBeenCalledTimes(1);
    expect(pushState).not.toHaveBeenCalled();

    replaceState.mockRestore();
    pushState.mockRestore();
  });

  it('writes no history entry once the dashboard reports a navigation', () => {
    const { props } = renderContainer();
    const replaceState = vi.spyOn(window.history, 'replaceState').mockImplementation(() => {});
    const pushState = vi.spyOn(window.history, 'pushState').mockImplementation(() => {});

    act(() => {
      props.onNavigateAway?.();
    });

    // Everything that can still reach updateURLWithFilters: a filter edit, a
    // board tab move (which normally pushes), a page change, a page-size change.
    act(() => {
      props.onFilterChange({ priorityId: 'priority-2' });
      props.onFilterChange({ boardIds: ['board-1'] }, { activeBoardTab: 'board-1', pushHistory: true });
    });

    expect(replaceState).not.toHaveBeenCalled();
    expect(pushState).not.toHaveBeenCalled();

    replaceState.mockRestore();
    pushState.mockRestore();
  });

  it('resumes writing once an intercepted modal route closes', () => {
    // Export, Import and the bulk actions render *over* the list, so the
    // container is never unmounted. A one-way flag would leave the address bar
    // ignoring filter changes for the rest of the session after one dialog.
    const { props, view } = renderContainer();

    act(() => {
      props.onNavigateAway?.();
    });

    currentPathname = '/msp/tickets/export';
    view.rerender(
      <TicketingDashboardContainer consolidatedData={consolidatedData} currentUser={currentUser} />,
    );

    currentPathname = '/msp/tickets';
    view.rerender(
      <TicketingDashboardContainer consolidatedData={consolidatedData} currentUser={currentUser} />,
    );

    const replaceState = vi.spyOn(window.history, 'replaceState').mockImplementation(() => {});
    act(() => {
      props.onFilterChange({ priorityId: 'priority-4' });
    });

    expect(replaceState).toHaveBeenCalledTimes(1);
    replaceState.mockRestore();
  });

  it('exposes the navigation hook to the dashboard', () => {
    // Without this wiring every router.push out of the list is still a race.
    const { props } = renderContainer();
    expect(typeof props.onNavigateAway).toBe('function');
  });

  it('cancels the debounced filter fetch on the way out', async () => {
    const { props } = renderContainer();

    act(() => {
      props.onFilterChange({ priorityId: 'priority-3' });
      props.onNavigateAway?.();
    });

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 400));
    });

    expect(fetchTicketsWithPagination).not.toHaveBeenCalled();
  });
});
