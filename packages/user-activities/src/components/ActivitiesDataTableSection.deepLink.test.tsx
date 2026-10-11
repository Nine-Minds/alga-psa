/* @vitest-environment jsdom */
/**
 * Deep link `?activity=<type>:<id>` handling in ActivitiesDataTableSection:
 *  - forces grouped mode for this visit only (no preference is ever written),
 *  - waits for activities / saved filters / my groups before resolving,
 *  - hands the key to the grouped view only when the item is in the loaded set,
 *  - otherwise shows a "not in your current view" alert (with Clear filters) and consumes the param,
 *  - Clear filters retries without writing saved filters.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  setListViewMode: vi.fn(),
  setSavedFilters: vi.fn(),
  getActivities: vi.fn(),
  myGroups: { groups: [] as any[], status: 'ready', refresh: vi.fn(async () => []) } as any,
  groupedProps: null as any,
  prefs: { filtersLoaded: true },
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
vi.mock('../hooks/useActivitiesCache', () => ({
  useActivitiesCache: () => ({
    getActivities: mocks.getActivities,
    invalidateCache: vi.fn(),
    isLoading: false,
    isInitialLoad: false,
  }),
}));
vi.mock('./MyActivityGroupsProvider', () => ({ useMyActivityGroups: () => mocks.myGroups }));
vi.mock('./ActivityDrawerProvider', () => ({ useActivityDrawer: () => ({ openActivityDrawer: vi.fn() }) }));
vi.mock('@alga-psa/ui/context', () => ({
  useActivityCrossFeature: () => ({
    getAllClients: async () => [],
    getProjectsWithPhases: async () => [],
  }),
}));
vi.mock('@alga-psa/user-activities/actions', () => ({
  fetchActivities: vi.fn(),
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
vi.mock('./GroupedActivitiesView', () => ({
  GroupedActivitiesView: (props: any) => {
    mocks.groupedProps = props;
    return <div data-testid="grouped-view" data-focus={props.focusActivityKey ?? ''} />;
  },
}));
vi.mock('./PrintableActivitiesView', () => ({ PrintableActivitiesView: () => null }));
vi.mock('./filters/ActivitiesTableFilters', () => ({ ActivitiesTableFilters: () => null }));
vi.mock('./ActivitiesTableSkeleton', () => ({ ActivitiesTableSkeleton: () => <div data-testid="skeleton" /> }));

import { ActivitiesDataTableSection } from './ActivitiesDataTableSection';

const activity = (type: string, id: string) => ({ type, id, title: id, status: 'open', priority: 'low' } as any);

beforeEach(() => {
  mocks.setListViewMode.mockReset();
  mocks.setSavedFilters.mockReset();
  mocks.groupedProps = null;
  mocks.prefs.filtersLoaded = true;
  mocks.myGroups = { groups: [], status: 'ready', refresh: vi.fn(async () => []) };
  mocks.getActivities.mockReset().mockResolvedValue({ activities: [activity('ticket', 't1'), activity('projectTask', 'p1')], totalCount: 2 });
});
afterEach(cleanup);

describe('ActivitiesDataTableSection deep link', () => {
  it('without a deep link: flat mode, no grouped view', async () => {
    render(<ActivitiesDataTableSection />);
    expect(await screen.findByTestId('flat-table')).toBeTruthy();
    expect(screen.queryByTestId('grouped-view')).toBeNull();
  });

  it('forces grouped mode and hands the key to the grouped view when the item is loaded — without writing preferences', async () => {
    render(<ActivitiesDataTableSection focusActivityKey="ticket:t1" onFocusConsumed={vi.fn()} />);
    const grouped = await screen.findByTestId('grouped-view');
    await waitFor(() => expect(grouped.getAttribute('data-focus')).toBe('ticket:t1'));
    expect(mocks.setListViewMode).not.toHaveBeenCalled();
    expect(mocks.setSavedFilters).not.toHaveBeenCalled();
    // the viewing target is myself
    expect(mocks.getActivities.mock.calls.every(([f]) => !f.targetUserId)).toBe(true);
  });

  it('consumes the param once the grouped view has handled the focus', async () => {
    const onFocusConsumed = vi.fn();
    render(<ActivitiesDataTableSection focusActivityKey="ticket:t1" onFocusConsumed={onFocusConsumed} />);
    await waitFor(() => expect(mocks.groupedProps?.focusActivityKey).toBe('ticket:t1'));
    expect(onFocusConsumed).not.toHaveBeenCalled();
    act(() => { mocks.groupedProps.onFocusHandled(); });
    expect(onFocusConsumed).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByTestId('grouped-view').getAttribute('data-focus')).toBe(''));
  });

  it('does not resolve until my groups have loaded', async () => {
    mocks.myGroups = { groups: null, status: 'loading', refresh: vi.fn(async () => []) };
    const onFocusConsumed = vi.fn();
    render(<ActivitiesDataTableSection focusActivityKey="ticket:missing" onFocusConsumed={onFocusConsumed} />);
    await screen.findByTestId('grouped-view');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(onFocusConsumed).not.toHaveBeenCalled();
  });

  it('does not resolve until saved filters have loaded', async () => {
    mocks.prefs.filtersLoaded = false;
    const onFocusConsumed = vi.fn();
    render(<ActivitiesDataTableSection focusActivityKey="ticket:missing" onFocusConsumed={onFocusConsumed} />);
    await screen.findByTestId('grouped-view');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(onFocusConsumed).not.toHaveBeenCalled();
  });

  it('shows the not-in-view alert and consumes the param when the item is not in the loaded set', async () => {
    const onFocusConsumed = vi.fn();
    render(<ActivitiesDataTableSection focusActivityKey="ticket:missing" onFocusConsumed={onFocusConsumed} />);
    expect((await screen.findByRole('alert')).textContent).toContain("This item isn't in your current view.");
    expect(onFocusConsumed).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('grouped-view').getAttribute('data-focus')).toBe('');
  });

  it('Clear filters retries for this visit only: refetches, finds the item, and writes no saved filters', async () => {
    const onFocusConsumed = vi.fn();
    // First load (filtered) lacks the item; after clearing, the broader fetch contains it.
    mocks.getActivities.mockImplementation(async (filters: any) => {
      const broad = (filters.types?.length ?? 0) > 3;
      return { activities: broad ? [activity('ticket', 'late')] : [activity('ticket', 't1')], totalCount: 1 };
    });
    render(<ActivitiesDataTableSection focusActivityKey="ticket:late" onFocusConsumed={onFocusConsumed} initialFilters={{ types: ['ticket'] } as any} />);
    await screen.findByRole('alert');
    fireEvent.click(document.getElementById('activities-data-table-section-deep-link-clear-filters')!);
    await waitFor(() => expect(screen.getByTestId('grouped-view').getAttribute('data-focus')).toBe('ticket:late'));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(mocks.setSavedFilters).not.toHaveBeenCalled();
    expect(mocks.setListViewMode).not.toHaveBeenCalled();
  });

  it('after clearing, an item still missing reports "no longer on your list" with no retry', async () => {
    render(<ActivitiesDataTableSection focusActivityKey="ticket:gone" onFocusConsumed={vi.fn()} />);
    await screen.findByRole('alert');
    mocks.getActivities.mockClear();
    fireEvent.click(document.getElementById('activities-data-table-section-deep-link-clear-filters')!);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('no longer on your activities list'));
    expect(document.getElementById('activities-data-table-section-deep-link-clear-filters')).toBeNull();
    // one refetch, not a loop
    expect(mocks.getActivities.mock.calls.length).toBeLessThan(5);
  });
});
