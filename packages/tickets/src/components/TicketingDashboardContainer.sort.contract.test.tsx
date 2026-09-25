/* @vitest-environment jsdom */
import React from 'react';
import { act, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ITicketListFilters, IUser } from '@alga-psa/types';

/**
 * Contract guard for the "click Assigned To and the list errors" defect.
 *
 * `DataTable` emits a column's `dataIndex` as the sort key, so the Assigned To
 * column sends `assigned_to_name`. The server schema and the URL parsers must
 * accept the same set the board emits — and an unknown key must not be smuggled
 * through as if it were supported.
 */

const fetchTicketsWithPagination = vi.fn(
  async (_filters: ITicketListFilters, _page: number, _pageSize: number) => ({
    tickets: [],
    totalCount: 0,
  }),
);

let currentPathname = '/msp/tickets';

vi.mock('next/navigation', () => ({
  usePathname: () => currentPathname,
}));

type DashboardProps = {
  onFilterChange: (update: Partial<ITicketListFilters>, options?: unknown) => void;
  onSortChange: (columnId: string, direction: 'asc' | 'desc') => void | Promise<void>;
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
  fetchTicketsWithPagination: (...args: Parameters<typeof fetchTicketsWithPagination>) =>
    fetchTicketsWithPagination(...args),
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

// The real hook calls a `'use server'` action (createTenantKnex) that isn't
// mocked here. `TicketingDashboard` is mocked to `null` below, so the picker
// this hook feeds is never actually rendered — but the hook itself still runs
// as part of `TicketingDashboardContainer`, and its unmocked DB round trip can
// settle after the test (and jsdom) tear down, throwing an unhandled
// "window is not defined" rejection unrelated to the sort contract under test.
vi.mock('@alga-psa/list-views/hooks', () => ({
  useListViews: () => ({
    isLoading: false,
    views: [],
    myViews: [],
    sharedViews: [],
    activeView: null,
    defaultViewId: null,
    canShare: false,
    isDirty: false,
    isSaving: false,
    applyView: vi.fn(),
    discardChanges: vi.fn(),
    saveChanges: vi.fn(async () => false),
    saveAsNew: vi.fn(async () => false),
    updateView: vi.fn(async () => false),
    deleteView: vi.fn(async () => false),
    setDefault: vi.fn(async () => false),
    linkFor: vi.fn(() => ''),
  }),
  writeViewParam: vi.fn(),
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

function lastFetchFilters(): ITicketListFilters {
  const calls = fetchTicketsWithPagination.mock.calls;
  return calls[calls.length - 1]?.[0] as ITicketListFilters;
}

async function deliverHistoryStep(url: string) {
  window.history.replaceState(null, '', url);
  await act(async () => {
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
}

describe('ticket list sort contract', () => {
  beforeEach(() => {
    dashboardProps = null;
    currentPathname = '/msp/tickets';
    fetchTicketsWithPagination.mockClear();
    window.history.replaceState(null, '', '/msp/tickets');
  });

  it('forwards the Assigned To column id to the paginated fetch', async () => {
    const { props } = renderContainer();

    await act(async () => {
      await props.onSortChange('assigned_to_name', 'asc');
    });

    expect(fetchTicketsWithPagination).toHaveBeenCalled();
    expect(lastFetchFilters().sortBy).toBe('assigned_to_name');
    expect(lastFetchFilters().sortDirection).toBe('asc');
  });

  for (const sortBy of ['assigned_to_name', 'assigned_team_name', 'updated_at'] as const) {
    it(`restores ${sortBy} from the address bar`, async () => {
      renderContainer();

      await deliverHistoryStep(`/msp/tickets?sortBy=${sortBy}&sortDirection=asc`);

      expect(fetchTicketsWithPagination).toHaveBeenCalled();
      expect(lastFetchFilters().sortBy).toBe(sortBy);
      expect(lastFetchFilters().sortDirection).toBe('asc');
    });
  }

  it('rejects an unknown sort key from the address bar', async () => {
    renderContainer();

    await deliverHistoryStep('/msp/tickets?sortBy=definitely-not-a-key');

    expect(fetchTicketsWithPagination).toHaveBeenCalled();
    expect(lastFetchFilters().sortBy).toBe('entered_at');
  });
});
