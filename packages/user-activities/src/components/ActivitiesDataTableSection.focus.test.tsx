/* @vitest-environment jsdom */
/**
 * Regression: deep-link focus with the REAL useActivitiesCache and REAL GroupedActivitiesView.
 * Only server actions are mocked. If the cache hook sorts filters.types in place, the section's
 * loaded/current keys diverge and the row is never highlighted.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';

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
vi.mock('../actions/activityServerActions', () => ({ fetchActivities: mocks.getActivities }));
vi.mock('./MyActivityGroupsProvider', () => ({ useMyActivityGroups: () => mocks.myGroups }));
vi.mock('./ActivityDrawerProvider', () => ({ useActivityDrawer: () => ({ openActivityDrawer: vi.fn() }) }));
vi.mock('@alga-psa/ui/context', () => ({
  useActivityCrossFeature: () => ({
    getAllClients: async () => [],
    getProjectsWithPhases: async () => [],
  }),
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

import { ActivitiesDataTableSection } from './ActivitiesDataTableSection';
import { DEFAULT_TABLE_TYPES } from './constants';

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  mocks.getActivities.mockReset().mockResolvedValue({
    activities: [{ type: 'ticket', id: 't1', title: 'T1', status: 'open', priority: 'low' } as any],
    totalCount: 1,
  });
});
afterEach(cleanup);

describe('ActivitiesDataTableSection deep-link focus with the real cache hook', () => {
  it('highlights the row and consumes the param when filter types are in DEFAULT_TABLE_TYPES order', async () => {
    const onFocusConsumed = vi.fn();
    const types = [...DEFAULT_TABLE_TYPES]; // deliberately unsorted
    render(
      <ActivitiesDataTableSection
        focusActivityKey="ticket:t1"
        onFocusConsumed={onFocusConsumed}
        initialFilters={{ types, isClosed: false } as any}
      />
    );
    await waitFor(() => {
      const row = document.querySelector('[data-activity-key="ticket:t1"]');
      expect(row?.getAttribute('data-highlighted')).toBe('true');
    });
    expect(onFocusConsumed).toHaveBeenCalled();
    // the caller's array is never mutated by the cache hook
    expect(types).toEqual(DEFAULT_TABLE_TYPES);
  });
});
