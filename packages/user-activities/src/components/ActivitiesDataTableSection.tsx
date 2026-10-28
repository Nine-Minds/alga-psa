'use client';


import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import {
  Activity,
  ActivityFilters,
  ActivitySortBy,
  ActivityType,
} from '@alga-psa/types';
import { Card, CardContent, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Button } from '@alga-psa/ui/components/Button';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { usePrintAction } from '@alga-psa/ui/components/PrintButton';
import {
  PrintOptionsDialog,
  type PrintColumnOption,
  usePrintColumnSelection,
} from '@alga-psa/ui/components/PrintOptionsDialog';
import { ShareActionsMenu, type ShareAction } from '@alga-psa/ui/components/ShareActionsMenu';
import { RefreshCw, List, LayoutList, Printer, Settings2 } from 'lucide-react';
import ViewSwitcher, { ViewSwitcherOption } from '@alga-psa/ui/components/ViewSwitcher';
import './userActivitiesPrint.css';
import {
  fetchActivities,
  getUserActivityGroups,
  createAdHocActivity,
  type ActivityGroup,
} from '@alga-psa/user-activities/actions';
import { Input } from '@alga-psa/ui/components/Input';
import { Plus } from 'lucide-react';
import { ActivitiesDataTable } from './ActivitiesDataTable';
import { GroupedActivitiesView } from './GroupedActivitiesView';
import { PrintableActivitiesView } from './PrintableActivitiesView';
import { ActivitiesTableFilters } from './filters/ActivitiesTableFilters';
import { ViewingUserPicker } from './ViewingUserPicker';
import { useActivityFilterState, type ActivityFilterState } from '../hooks/useActivityFilterState';
import { useActivityFilterOptions, type ActivityFilterOptions } from '../hooks/useActivityFilterOptions';
import { useViewableUsers } from '../hooks/useViewableUsers';
import { useActivityDrawer } from './ActivityDrawerProvider';
import { useMyActivityGroups } from './MyActivityGroupsProvider';
import { ActivityGroupMenuScope } from './ActivityGroupMenuScope';
import { useActivitiesCache } from '../hooks/useActivitiesCache';
import { useActivitiesInvalidationSignal } from '../hooks/ActivitiesCacheProvider';
import { useUserPreference } from '@alga-psa/user-composition/hooks';

import { ActivitiesTableSkeleton } from './ActivitiesTableSkeleton';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { DEFAULT_TABLE_TYPES } from './constants';
import { collapseRecurringSeries } from '../lib/recurringSeries';

interface ActivitiesDataTableSectionProps {
  title?: string;
  initialFilters?: ActivityFilters;
  id?: string;
  /**
   * Deep link target (`${type}:${id}`, from `?activity=`). Forces myself + grouped mode for THIS
   * VISIT ONLY (nothing is written to saved preferences), then scrolls to and highlights the
   * item. See `onFocusConsumed`.
   */
  focusActivityKey?: string | null;
  /** Called once the deep link has been resolved (found + highlighted, or reported not found). */
  onFocusConsumed?: () => void;
  /**
   * Lifted filter state (the dashboard owns it so the cards and table views share one model).
   * When omitted — together with `filterOptions` — the section manages its own.
   */
  filterState?: ActivityFilterState;
  /** Lifted filter option data. See `filterState`. */
  filterOptions?: ActivityFilterOptions;
}

type ListViewMode = 'flat' | 'grouped';

const PRINT_FALLBACK_PAGE_SIZE = 500;

// Single source for the loaded/current key comparison that gates deep-link focus.
function buildLoadedKey(filters: ActivityFilters, viewMode: string): string {
  return JSON.stringify([filters, viewMode]);
}
const NO_GROUPS: ActivityGroup[] = [];

type ControlledProps = Omit<ActivitiesDataTableSectionProps, 'filterState' | 'filterOptions'> & {
  filterState: ActivityFilterState;
  filterOptions: ActivityFilterOptions;
};

/** Standalone use: owns its filter state and option data. */
function SelfManagedActivitiesDataTableSection(props: ActivitiesDataTableSectionProps) {
  const { initialFilters = {} } = props;
  // Explicit "View All"-style filters count as an override for this visit.
  const hasExplicitFilters = !!initialFilters.types && initialFilters.types.length > 0;
  const ownState = useActivityFilterState({
    initialOverride: hasExplicitFilters ? initialFilters : undefined,
  });
  const filterState = props.filterState ?? ownState;
  const ownOptions = useActivityFilterOptions(filterState.filters.types);
  return (
    <ControlledActivitiesDataTableSection
      {...props}
      filterState={filterState}
      filterOptions={props.filterOptions ?? ownOptions}
    />
  );
}

export function ActivitiesDataTableSection(props: ActivitiesDataTableSectionProps) {
  if (props.filterState && props.filterOptions) {
    return <ControlledActivitiesDataTableSection {...(props as ControlledProps)} />;
  }
  return <SelfManagedActivitiesDataTableSection {...props} />;
}

function ControlledActivitiesDataTableSection({
  title,
  id = "activities-data-table-section",
  focusActivityKey = null,
  onFocusConsumed,
  filterState,
  filterOptions,
}: ControlledProps) {
  const { t } = useTranslation('msp/user-activities');
  const effectiveTitle = title ?? t('table.title.all', { defaultValue: 'All Activities' });
const LIST_VIEW_OPTIONS: ViewSwitcherOption<ListViewMode>[] = [
    { value: 'flat', label: t('table.viewSwitcher.flat', { defaultValue: 'Flat' }), icon: List },
    { value: 'grouped', label: t('table.viewSwitcher.grouped', { defaultValue: 'Grouped' }), icon: LayoutList },
];

function formatActivityPrintDate(dateString?: string): string {
  if (!dateString) return '';
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString();
}
  const [activities, setActivities] = useState<Activity[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [adHocTitle, setAdHocTitle] = useState('');
  const [isAddingAdHoc, setIsAddingAdHoc] = useState(false);
  const { openActivityDrawer } = useActivityDrawer();
  const myGroups = useMyActivityGroups();
  const { refresh: refreshMyGroups } = myGroups;

  // "Viewing": whose activities to show. Empty string = the current user. Other values
  // require the caller to hold the schedule "view others" permission (resolved server-side).
  const { filters, targetUserId, setTargetUserId } = filterState;
  const { viewableUsers, canViewOthers } = useViewableUsers();

  const viewingOther = canViewOthers && targetUserId !== '';

  // Flat vs grouped mode (persisted per user)
  const { value: savedListViewMode, setValue: setListViewMode } = useUserPreference<ListViewMode>(
    'activitiesListViewMode',
    {
      defaultValue: 'flat',
      localStorageKey: 'activitiesListViewMode',
      debounceMs: 300,
    }
  );
  // Deep link: grouped mode for this visit only. Never written to the saved preference; an
  // explicit ViewSwitcher choice replaces it.
  const [ephemeralListViewMode, setEphemeralListViewMode] = useState<ListViewMode | null>(
    focusActivityKey ? 'grouped' : null
  );
  const listViewMode: ListViewMode = ephemeralListViewMode ?? savedListViewMode;

  // Deep-link focus: the key waiting to be scrolled to, and the "not in view" alert state.
  const [pendingFocusKey, setPendingFocusKey] = useState<string | null>(focusActivityKey);
  const [focusAlert, setFocusAlert] = useState<'notInView' | 'notOnList' | null>(null);
  const [focusFiltersCleared, setFocusFiltersCleared] = useState(false);
  // The effective filters/mode the current `activities` were loaded for.
  const [loadedKey, setLoadedKey] = useState<string | null>(null);

  // A new deep link (re)targets myself in grouped mode, for this visit only.
  useEffect(() => {
    if (!focusActivityKey) return;
    setPendingFocusKey(focusActivityKey);
    setEphemeralListViewMode('grouped');
    setTargetUserId('');
    setFocusAlert(null);
    setFocusFiltersCleared(false);
  }, [focusActivityKey, setTargetUserId]);

  // Use the enhanced cache hook with loading state
  const {
    getActivities,
    invalidateCache,
    isLoading,
    isInitialLoad
  } = useActivitiesCache();

  // Ungrouped collapse state (read here for print view, owned by UngroupedSection)
  const { value: ungroupedCollapsed } = useUserPreference<boolean>(
    'activitiesUngroupedCollapsed',
    { defaultValue: false, localStorageKey: 'activitiesUngroupedCollapsed' }
  );

  // User-defined activity groups (shared between GroupedActivitiesView + PrintableActivitiesView).
  // Myself: the workspace-wide store (shared with the ticket/task "My group" control and the
  // action menu, so changes made anywhere show here immediately). Another user: a read-only
  // direct fetch that never touches the store.
  const [otherUserGroups, setOtherUserGroups] = useState<ActivityGroup[]>([]);
  const activityGroups = viewingOther ? otherUserGroups : (myGroups.groups ?? NO_GROUPS);
  const [printActivities, setPrintActivities] = useState<Activity[] | null>(null);

  // Groups belong to whoever is being viewed (self by default). Passing the
  // selected user id makes the grouped view show that user's groups instead of
  // the caller's. Depends on targetUserId so switching users reloads groups.
  const loadActivityGroups = useCallback(async (): Promise<ActivityGroup[]> => {
    if (!viewingOther) {
      return refreshMyGroups();
    }
    try {
      const groups = await getUserActivityGroups(targetUserId || undefined);
      setOtherUserGroups(groups);
      return groups;
    } catch (err) {
      console.error('Error loading activity groups:', err);
      setOtherUserGroups([]);
      return [];
    }
  }, [viewingOther, targetUserId, refreshMyGroups]);

  // Load groups when grouped mode is active (and reload when the viewed user changes)
  useEffect(() => {
    if (listViewMode === 'grouped') {
      loadActivityGroups();
    }
  }, [listViewMode, loadActivityGroups]);

  // Pagination State
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [totalItems, setTotalItems] = useState(0);

  // Sort state (server-side)
  const [sortBy, setSortBy] = useState<ActivitySortBy | undefined>(undefined);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  const handleSortChange = useCallback((nextSortBy: string, nextDirection: 'asc' | 'desc') => {
    setSortBy(nextSortBy as ActivitySortBy);
    setSortDirection(nextDirection);
    setCurrentPage(1); // reset to first page on sort change
  }, []);

  // Use useCallback to memoize loadActivities with cache.
  // In grouped mode, we load ALL activities (no pagination) so DnD works across
  // the full set. Uses a large page size as a practical upper bound.
  const getEffectiveFilters = useCallback((): ActivityFilters => ({
    ...filters,
    types: filters.types && filters.types.length > 0
      ? filters.types
      : Object.values(ActivityType),
    sortBy,
    sortDirection,
    targetUserId: targetUserId || undefined,
  }), [filters, sortBy, sortDirection, targetUserId]);

  const loadActivities = useCallback(async () => {
    try {
      const effectiveFilters = getEffectiveFilters();

      const effectivePage = listViewMode === 'grouped' ? 1 : currentPage;
      const effectivePageSize = listViewMode === 'grouped' ? 500 : pageSize;

      // Compute the key before awaiting so it reflects exactly what was requested.
      const requestKey = buildLoadedKey(effectiveFilters, listViewMode);

      const result = await getActivities(
        effectiveFilters,
        effectivePage,
        effectivePageSize
      );

      setActivities(result.activities);
      setTotalItems(result.totalCount);
      setLoadedKey(requestKey);
      setError(null);
    } catch (err) {
      console.error(`Error loading activities:`, err);
      setError(t('table.errors.loadFailed', { defaultValue: 'Failed to load activities. Please try again later.' }));
    }
  }, [currentPage, pageSize, getActivities, getEffectiveFilters, listViewMode, t]);

  // useEffect to trigger loadActivities when filters or pagination changes
  useEffect(() => {
    loadActivities();
  }, [loadActivities]); // Dependency is the memoized function itself

  // Memoize event handlers to prevent unnecessary re-renders
  const handleViewDetails = useCallback((activity: Activity) => {
    openActivityDrawer(activity);
  }, [openActivityDrawer]);

  const handleRefresh = useCallback(() => {
    // Invalidate cache to ensure fresh data
    invalidateCache();
    loadActivities();
  }, [loadActivities, invalidateCache]);

  // Refetch when another consumer of the shared cache (the activity drawer) reports a change.
  // Skip the initial value so mounting doesn't trigger a duplicate load.
  const { version: invalidationVersion } = useActivitiesInvalidationSignal();
  const lastHandledInvalidationVersion = useRef(invalidationVersion);
  useEffect(() => {
    if (invalidationVersion === lastHandledInvalidationVersion.current) return;
    lastHandledInvalidationVersion.current = invalidationVersion;
    handleRefresh();
  }, [invalidationVersion, handleRefresh]);

  const handleAddAdHoc = useCallback(async () => {
    const title = adHocTitle.trim();
    if (!title || isAddingAdHoc) return;
    setIsAddingAdHoc(true);
    try {
      await createAdHocActivity({ title });
      setAdHocTitle('');
      invalidateCache();
      await loadActivities();
    } catch (err) {
      console.error('Error creating ad-hoc item:', err);
      setError(t('table.errors.addAdHocFailed', { defaultValue: 'Failed to add ad-hoc item. Please try again.' }));
    } finally {
      setIsAddingAdHoc(false);
    }
  }, [adHocTitle, isAddingAdHoc, invalidateCache, loadActivities, t]);

  const handleFilterChange = useCallback((newFilters: ActivityFilters) => {
    filterState.setFilters(newFilters);
    setCurrentPage(1);
  }, [filterState]);

  const currentKey = useMemo(
    () => buildLoadedKey(getEffectiveFilters(), listViewMode),
    [getEffectiveFilters, listViewMode]
  );

  const handleTargetUserChange = useCallback((value: string) => {
    setTargetUserId(value);
    setCurrentPage(1);
  }, [setTargetUserId]);

  const preparePrintActivities = useCallback(async () => {
    if (listViewMode === 'grouped') {
      await loadActivityGroups();
    }

    const effectiveFilters = getEffectiveFilters();
    const printPageSize = Math.max(
      totalItems,
      activities.length,
      pageSize,
      PRINT_FALLBACK_PAGE_SIZE
    );

    const result = await fetchActivities(effectiveFilters, 1, printPageSize);
    setPrintActivities(collapseRecurringSeries(result.activities));
  }, [activities.length, getEffectiveFilters, listViewMode, loadActivityGroups, pageSize, totalItems]);

  const cleanupPrintActivities = useCallback(() => {
    setPrintActivities(null);
  }, []);

  const handlePageChange = useCallback((newPage: number) => {
    setCurrentPage(newPage);
  }, []);

  const handlePageSizeChange = useCallback((newPageSize: number) => {
    setPageSize(newPageSize);
    setCurrentPage(1); // Reset to first page when changing page size
  }, []);

  // LEVERAGE: friction recurring-collapse-per-page — the table collapses recurring series
  // client-side per page, so totalCount counts occurrences and pages can come up short; the
  // server-side `collapseRecurringSeries` filter key fixes both but changes table pagination.
  const filteredActivitiesForTable = useMemo(() => (
    collapseRecurringSeries(activities)
  ), [activities]);

  // ---- Deep-link focus ------------------------------------------------------------------
  // Resolve only once everything the answer depends on is current: the activities for the
  // present filters/mode, the (late-arriving) saved filters, and my groups.
  const groupsReady = viewingOther || myGroups.status === 'ready' || myGroups.status === 'error';
  const focusReady =
    pendingFocusKey !== null &&
    listViewMode === 'grouped' &&
    !viewingOther &&
    !error &&
    (filterState.isReady || focusFiltersCleared) &&
    groupsReady &&
    loadedKey === currentKey;
  const focusFound = focusReady && filteredActivitiesForTable.some((a) => `${a.type}:${a.id}` === pendingFocusKey);

  useEffect(() => {
    if (!focusReady) return;
    if (focusFound) {
      setFocusAlert(null);
      return;
    }
    setFocusAlert(focusFiltersCleared ? 'notOnList' : 'notInView');
    // Reported: drop the URL param so a refresh doesn't repeat this. The alert's retry button
    // keeps working off the section's own pending key.
    onFocusConsumed?.();
  }, [focusReady, focusFound, focusFiltersCleared, onFocusConsumed]);

  const handleFocusHandled = useCallback(() => {
    setPendingFocusKey(null);
    setFocusAlert(null);
    onFocusConsumed?.();
  }, [onFocusConsumed]);

  // "Clear filters": for this visit only (saved filters are NOT written), show every table type
  // and drop the closed restriction, then retry the focus.
  const handleClearFiltersForFocus = useCallback(() => {
    filterState.setOverrideFilters({ types: DEFAULT_TABLE_TYPES });
    setCurrentPage(1);
    setFocusFiltersCleared(true);
    setFocusAlert(null);
  }, [filterState]);

  const activityPrintColumns = useMemo<PrintColumnOption<Activity>[]>(() => [
    {
      key: 'type',
      label: t('table.columns.type', { defaultValue: 'Type' }),
      header: t('table.columns.type', { defaultValue: 'Type' }),
      render: (activity) => t(`table.activityTypes.${activity.type}`, {
        defaultValue: activity.type,
      }),
      className: 'ua-print-type-column',
    },
    {
      key: 'title',
      label: t('table.columns.title', { defaultValue: 'Title' }),
      header: t('table.columns.title', { defaultValue: 'Title' }),
      render: (activity) => activity.title,
      className: 'ua-print-title-column',
    },
    {
      key: 'status',
      label: t('table.columns.status', { defaultValue: 'Status' }),
      header: t('table.columns.status', { defaultValue: 'Status' }),
      render: (activity) => activity.status || t('table.values.emDash', { defaultValue: '—' }),
    },
    {
      key: 'priority',
      label: t('table.columns.priority', { defaultValue: 'Priority' }),
      header: t('table.columns.priority', { defaultValue: 'Priority' }),
      render: (activity) => activity.priorityName || activity.priority || t('table.values.emDash', { defaultValue: '—' }),
    },
    {
      key: 'dueDate',
      label: t('table.columns.dueDate', { defaultValue: 'Due Date' }),
      header: t('table.columns.dueDate', { defaultValue: 'Due Date' }),
      render: (activity) => formatActivityPrintDate(activity.dueDate) || t('table.values.noDueDate', { defaultValue: 'No due date' }),
      className: 'ua-print-date-column',
    },
  ], [t]);
  const {
    selectedColumnKeys: selectedActivityPrintColumnKeys,
    selectedColumns: selectedActivityPrintColumns,
    setSelectedColumnKeys: setSelectedActivityPrintColumnKeys,
    resetSelectedColumnKeys: resetSelectedActivityPrintColumnKeys,
  } = usePrintColumnSelection('print-columns:user-activities', activityPrintColumns);

  const [isPrintOptionsOpen, setIsPrintOptionsOpen] = useState(false);

  const { triggerPrint: triggerPrintActivities, isPreparing: isPreparingActivityPrint } = usePrintAction({
    onBeforePrint: preparePrintActivities,
    onAfterPrint: cleanupPrintActivities,
  });

  return (
    <>
    <Card id={id} className="ua-print-hide">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle>{effectiveTitle}</CardTitle>
        <div className="flex items-center gap-2">
          <ViewSwitcher<ListViewMode>
            options={LIST_VIEW_OPTIONS}
            currentView={listViewMode}
            onChange={(v) => {
              // An explicit choice wins over the deep-link override and is the only thing that
              // writes the saved preference.
              setEphemeralListViewMode(v);
              setListViewMode(v);
            }}
          />
          <Button
            id={`${id}-refresh-button`}
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={isLoading}
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            {t('table.actions.refresh', { defaultValue: 'Refresh' })}
          </Button>
          <div className="w-px h-6 bg-border" />
          <ShareActionsMenu
            id={`${id}-share-actions`}
            triggerSize="sm"
            tooltip={t('actions.print', { defaultValue: 'Print' })}
            disabled={isLoading || activities.length === 0}
            actions={[
              {
                id: `${id}-share-print`,
                icon: Printer,
                label: t('table.actions.print', { defaultValue: 'Print' }),
                onSelect: () => { void triggerPrintActivities(); },
                disabled: isPreparingActivityPrint,
              },
              {
                id: `${id}-share-print-options`,
                icon: Settings2,
                label: t('actions.printOptions', { defaultValue: 'Print options' }),
                onSelect: () => setIsPrintOptionsOpen(true),
              },
            ] satisfies ShareAction[]}
          />
        </div>
      </CardHeader>
      <CardContent>
        <ActivityGroupMenuScope enabled={!viewingOther}>
        {(canViewOthers || !viewingOther) && (
          <div className="mb-4 flex flex-wrap items-center gap-2">
            {!viewingOther && (
              <>
                <Input
                  id={`${id}-add-adhoc-input`}
                  value={adHocTitle}
                  onChange={(e) => setAdHocTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void handleAddAdHoc();
                    }
                  }}
                  placeholder={t('table.adHoc.addPlaceholder', { defaultValue: 'Add Activity' })}
                  className="h-9 max-w-sm text-sm"
                  disabled={isAddingAdHoc}
                />
                <Button
                  id={`${id}-add-adhoc-button`}
                  variant="default"
                  size="sm"
                  onClick={() => void handleAddAdHoc()}
                  disabled={isAddingAdHoc || adHocTitle.trim().length === 0}
                >
                  <Plus className="h-4 w-4 mr-1" />
                  {t('table.adHoc.addButton', { defaultValue: 'Add' })}
                </Button>
              </>
            )}
            {canViewOthers && (
              <ViewingUserPicker
                id={`${id}-viewing-user`}
                className="ml-auto flex items-center gap-2"
                value={targetUserId}
                onChange={handleTargetUserChange}
                users={viewableUsers}
              />
            )}
          </div>
        )}
        {focusAlert && (
          <Alert id={`${id}-deep-link-alert`} variant="info" className="mb-4">
            <AlertDescription className="flex flex-wrap items-center gap-3">
              <span>
                {focusAlert === 'notInView'
                  ? t('deepLink.notInView', { defaultValue: "This item isn't in your current view." })
                  : t('deepLink.notOnList', { defaultValue: 'This item is no longer on your activities list.' })}
              </span>
              {focusAlert === 'notInView' && (
                <Button
                  id={`${id}-deep-link-clear-filters`}
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={handleClearFiltersForFocus}
                >
                  {t('deepLink.clearFilters', { defaultValue: 'Clear filters' })}
                </Button>
              )}
            </AlertDescription>
          </Alert>
        )}
        <ActivitiesTableFilters
          filters={filters}
          onChange={handleFilterChange}
          {...filterOptions}
        />
        {isInitialLoad || (isLoading && activities.length === 0) ? (
          <ActivitiesTableSkeleton rowCount={pageSize} />
        ) : error ? (
          <div className="flex justify-center items-center h-40">
            <p className="text-destructive">{error}</p>
          </div>
        ) : activities.length === 0 ? (
          <div className="flex justify-center items-center h-40">
            <p className="text-gray-500">{t('table.states.noActivities', { defaultValue: 'No activities found' })}</p>
          </div>
        ) : filteredActivitiesForTable.length === 0 ? (
          <div className="flex justify-center items-center h-40">
            <p className="text-gray-500">{t('table.states.noMatching', { defaultValue: 'No activities found matching filters' })}</p>
          </div>
        ) : listViewMode === 'grouped' ? (
          <GroupedActivitiesView
            focusActivityKey={focusFound ? pendingFocusKey : null}
            onFocusHandled={handleFocusHandled}
            activities={filteredActivitiesForTable}
            serverGroups={activityGroups}
            onGroupsChange={async () => {
              await loadActivityGroups();
            }}
            onActionComplete={handleRefresh}
            readOnly={viewingOther}
          />
        ) : (
          <ActivitiesDataTable
            activities={filteredActivitiesForTable}
            onViewDetails={handleViewDetails}
            onActionComplete={handleRefresh}
            isLoading={isLoading}
            currentPage={currentPage}
            pageSize={pageSize}
            totalItems={totalItems}
            onPageChange={handlePageChange}
            onItemsPerPageChange={handlePageSizeChange}
            sortBy={sortBy}
            sortDirection={sortDirection}
            onSortChange={handleSortChange}
          />
        )}
        </ActivityGroupMenuScope>
      </CardContent>
    </Card>
    <PrintableActivitiesView
      activities={printActivities ?? filteredActivitiesForTable}
      grouped={listViewMode === 'grouped'}
      serverGroups={activityGroups}
      ungroupedCollapsed={ungroupedCollapsed}
      title={effectiveTitle}
      columns={selectedActivityPrintColumns}
    />
    <PrintOptionsDialog
      id={`${id}-print-options-dialog`}
      open={isPrintOptionsOpen}
      onOpenChange={setIsPrintOptionsOpen}
      title={t('table.print.optionsDialog.title', { defaultValue: 'Print options' })}
      description={t('table.print.optionsDialog.description', {
        defaultValue: 'Choose which columns to include when printing activities.',
      })}
      columns={activityPrintColumns}
      selectedColumnKeys={selectedActivityPrintColumnKeys}
      onSelectedColumnKeysChange={setSelectedActivityPrintColumnKeys}
      onReset={resetSelectedActivityPrintColumnKeys}
      onPrint={() => triggerPrintActivities()}
      isPrinting={isPreparingActivityPrint}
    />
    </>
  );
}
