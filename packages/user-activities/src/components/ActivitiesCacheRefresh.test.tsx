/* @vitest-environment jsdom */
/**
 * Drawer edits must refresh the activities list: the list and the drawer provider share one
 * ActivitiesCacheProvider, and handleActionComplete bumps its invalidation version, which the
 * list turns into its normal handleRefresh() path (no remount, no second refresh path).
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, renderHook, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  setListViewMode: vi.fn(),
  setSavedFilters: vi.fn(),
  getActivities: vi.fn(),
  myGroups: { groups: [] as any[], status: 'ready', refresh: vi.fn(async () => []) } as any,
  groupedProps: null as any,
  prefs: { filtersLoaded: true },
  openDrawer: vi.fn(),
  closeDrawer: vi.fn(),
}));

// Stable `t`, like the real hook: the section's loader depends on it.
const stableT = (k: string, o: any) => o?.defaultValue ?? k;
vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({ t: stableT }),
}));
vi.mock('@alga-psa/user-composition/hooks', () => ({
  useUserPreference: (key: string, opts: any) => {
    if (key === 'activitiesListViewMode') {
      return { value: 'flat', setValue: mocks.setListViewMode, hasLoadedInitial: true };
    }
    if (key === 'activitiesTableFilters') {
      return { value: opts.defaultValue, setValue: mocks.setSavedFilters, hasLoadedInitial: mocks.prefs.filtersLoaded };
    }
    return { value: opts.defaultValue, setValue: vi.fn(), hasLoadedInitial: true };
  },
}));
vi.mock('../actions/activityServerActions', () => ({ fetchActivities: mocks.getActivities }));
vi.mock('./MyActivityGroupsProvider', () => ({ useMyActivityGroups: () => mocks.myGroups }));
// Stable ctx: the section's mount effects depend on it, so a fresh object per render would
// loop once the provider re-renders the section.
const stableCrossFeature = {
  getAllClients: async () => [],
  getProjectsWithPhases: async () => [],
};
vi.mock('@alga-psa/ui/context', () => ({
  useActivityCrossFeature: () => stableCrossFeature,
}));
vi.mock('@alga-psa/user-activities/actions', () => ({
  fetchActivities: mocks.getActivities,
  getUserActivityGroups: vi.fn(async () => []),
  createAdHocActivity: vi.fn(),
  getActivityViewableUsers: vi.fn(async () => ({ canViewOthers: false, users: [] })),
}));
vi.mock('@alga-psa/user-composition/actions', () => ({ getUserAvatarUrlsBatchAction: vi.fn() }));
vi.mock('@alga-psa/reference-data/actions', () => ({
  getAllPriorities: vi.fn(async () => []),
  getStatuses: vi.fn(async () => []),
  getAllBoards: vi.fn(async () => []),
}));
vi.mock('@alga-psa/tags/actions', () => ({
  findAllTagsByType: vi.fn(async () => []),
  isTagActionError: () => false,
}));
vi.mock('@alga-psa/ui/lib/errorHandling', () => ({ isActionPermissionError: () => false }));
vi.mock('./userActivitiesPrint.css', () => ({}));
vi.mock('@alga-psa/ui/components/Card', () => ({
  Card: ({ children }: any) => <div>{children}</div>,
  CardContent: ({ children }: any) => <div>{children}</div>,
  CardHeader: ({ children }: any) => <div>{children}</div>,
  CardTitle: ({ children }: any) => <h2>{children}</h2>,
}));
vi.mock('@alga-psa/ui/components/Button', () => ({ Button: ({ children, ...p }: any) => <button {...p}>{children}</button> }));
vi.mock('@alga-psa/ui/components/Alert', () => ({
  Alert: ({ children, id }: any) => <div id={id} role="alert">{children}</div>,
  AlertDescription: ({ children }: any) => <div>{children}</div>,
}));
vi.mock('@alga-psa/ui/components/PrintButton', () => ({ usePrintAction: () => ({ triggerPrint: vi.fn(), isPreparing: false }) }));
vi.mock('@alga-psa/ui/components/PrintOptionsDialog', () => ({
  PrintOptionsDialog: () => null,
  usePrintColumnSelection: () => ({ selectedColumns: [], toggleColumn: vi.fn(), columns: [], selectedKeys: [], setSelectedKeys: vi.fn(), resetColumns: vi.fn() }),
}));
vi.mock('@alga-psa/ui/components/ShareActionsMenu', () => ({ ShareActionsMenu: () => null }));
vi.mock('@alga-psa/ui/components/ViewSwitcher', () => ({ default: () => <div data-testid="view-switcher" /> }));
vi.mock('@alga-psa/ui/components/Input', () => ({ Input: (p: any) => <input {...p} /> }));
vi.mock('@alga-psa/ui/components/Label', () => ({ Label: ({ children }: any) => <label>{children}</label> }));
vi.mock('@alga-psa/ui/components/UserPicker', () => ({ default: () => null }));
vi.mock('./ActivitiesDataTable', () => ({ ActivitiesDataTable: () => <div data-testid="flat-table" /> }));
vi.mock('./InlineStatusPicker', () => ({ InlineStatusPicker: () => null }));
vi.mock('./InlinePriorityPicker', () => ({ InlinePriorityPicker: () => null }));
vi.mock('./ActivityActionMenu', () => ({ ActivityActionMenu: () => null }));
vi.mock('./PrintableActivitiesView', () => ({ PrintableActivitiesView: () => null }));
vi.mock('./filters/ActivitiesTableFilters', () => ({ ActivitiesTableFilters: () => null }));
vi.mock('./ActivitiesTableSkeleton', () => ({ ActivitiesTableSkeleton: () => <div data-testid="skeleton" /> }));
vi.mock('@alga-psa/ui', () => ({
  useDrawer: () => ({ openDrawer: mocks.openDrawer, closeDrawer: mocks.closeDrawer }),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('./ActivityDetailViewerDrawer', () => ({ ActivityDetailViewerDrawer: () => null }));

import { ActivitiesDataTableSection } from './ActivitiesDataTableSection';
import { ActivityDrawerProvider, useActivityDrawer } from './ActivityDrawerProvider';
import { ActivitiesCacheProvider } from '../hooks/ActivitiesCacheProvider';
import { useActivitiesCache } from '../hooks/useActivitiesCache';

const ticket = { type: 'ticket', id: 't1', title: 'T1', status: 'open', priority: 'low' } as any;

function Opener({ activity }: { activity: any }) {
  const { openActivityDrawer } = useActivityDrawer();
  return <button id="open" onClick={() => openActivityDrawer(activity)}>open</button>;
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  mocks.openDrawer.mockReset();
  mocks.closeDrawer.mockReset();
  mocks.getActivities.mockReset().mockResolvedValue({ activities: [ticket], totalCount: 1 });
});
afterEach(cleanup);

describe('drawer completion refreshes the activities list', () => {
  it('refetches (without remount) when the drawer reports completion, and still closes the drawer', async () => {
    const { container } = render(
      <ActivityDrawerProvider>
        <Opener activity={ticket} />
        <ActivitiesDataTableSection initialFilters={{ isClosed: false } as any} />
      </ActivityDrawerProvider>
    );
    await waitFor(() => expect(mocks.getActivities).toHaveBeenCalledTimes(1));

    act(() => { (container.querySelector('#open') as HTMLButtonElement).click(); });
    expect(mocks.openDrawer).toHaveBeenCalledTimes(1);
    const drawerElement = mocks.openDrawer.mock.calls[0][0] as React.ReactElement<any>;
    expect(typeof drawerElement.props.onActionComplete).toBe('function');

    await act(async () => { drawerElement.props.onActionComplete(); });

    await waitFor(() => expect(mocks.getActivities).toHaveBeenCalledTimes(2));
    expect(mocks.closeDrawer).toHaveBeenCalled();
  });

  it('does not refetch on mount beyond the initial load', async () => {
    render(
      <ActivityDrawerProvider>
        <ActivitiesDataTableSection initialFilters={{ isClosed: false } as any} />
      </ActivityDrawerProvider>
    );
    await waitFor(() => expect(mocks.getActivities).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 50));
    expect(mocks.getActivities).toHaveBeenCalledTimes(1);
  });
});

describe('shared activities cache', () => {
  const filters = { types: ['ticket'] } as any;

  it('invalidation from one consumer clears entries the other consumer reads', async () => {
    const { result } = renderHook(
      () => ({ a: useActivitiesCache(), b: useActivitiesCache() }),
      { wrapper: ({ children }) => <ActivitiesCacheProvider>{children}</ActivitiesCacheProvider> }
    );

    await act(async () => { await result.current.a.getActivities(filters, 1, 10); });
    await act(async () => { await result.current.b.getActivities(filters, 1, 10); });
    expect(mocks.getActivities).toHaveBeenCalledTimes(1); // b hit a's entry

    act(() => { result.current.a.invalidateCache('ticket'); });
    await act(async () => { await result.current.b.getActivities(filters, 1, 10); });
    expect(mocks.getActivities).toHaveBeenCalledTimes(2);
  });

  it('degrades to a private cache per hook when no provider is mounted', async () => {
    const { result } = renderHook(() => ({ a: useActivitiesCache(), b: useActivitiesCache() }));
    await act(async () => { await result.current.a.getActivities(filters, 1, 10); });
    await act(async () => { await result.current.b.getActivities(filters, 1, 10); });
    expect(mocks.getActivities).toHaveBeenCalledTimes(2);
  });
});

describe('remounting the table section under a surviving shared cache (Cards -> Table toggle)', () => {
  it('leaves the skeleton and renders rows when the remounted first load is a cache hit', async () => {
    function Toggle() {
      const [show, setShow] = React.useState(true);
      return (
        <>
          <button id="toggle" onClick={() => setShow((s) => !s)}>toggle</button>
          {show && <ActivitiesDataTableSection initialFilters={{ isClosed: false } as any} />}
        </>
      );
    }
    const { container, queryByTestId, findByTestId } = render(
      <ActivityDrawerProvider>
        <Toggle />
      </ActivityDrawerProvider>
    );
    const toggle = () => act(() => { (container.querySelector('#toggle') as HTMLButtonElement).click(); });

    expect(await findByTestId('flat-table')).toBeTruthy();
    expect(queryByTestId('skeleton')).toBeNull();
    expect(mocks.getActivities).toHaveBeenCalledTimes(1);

    toggle(); // unmount only the section; provider (and its cache) stays
    expect(queryByTestId('flat-table')).toBeNull();
    toggle(); // remount

    expect(await findByTestId('flat-table')).toBeTruthy();
    expect(queryByTestId('skeleton')).toBeNull();
    expect(mocks.getActivities).toHaveBeenCalledTimes(1); // second load came from the cache
  });
});
