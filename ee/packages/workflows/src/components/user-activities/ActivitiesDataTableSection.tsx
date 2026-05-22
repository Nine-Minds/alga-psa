'use client';


import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  Activity,
  ActivityFilters,
  ActivitySortBy,
  ActivityType,
  IClient,
  IPriority,
  IStatus,
  ITag,
  ItemType,
  ProjectWithPhases,
  TaggedEntityType,
} from '@alga-psa/types';
import { Card, CardContent, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import { Button } from '@alga-psa/ui/components/Button';
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
import { fetchActivities, getUserActivityGroups, type ActivityGroup } from '@alga-psa/workflows/actions';
import { ActivitiesDataTable } from './ActivitiesDataTable';
import { GroupedActivitiesView } from './GroupedActivitiesView';
import { PrintableActivitiesView } from './PrintableActivitiesView';
import { ActivitiesTableFilters } from './filters/ActivitiesTableFilters';
import { useActivityDrawer } from './ActivityDrawerProvider';
import { useActivityCrossFeature } from '@alga-psa/ui/context';
import { useActivitiesCache } from '../../hooks/useActivitiesCache';
import { useUserPreference } from '@alga-psa/user-composition/hooks';
import { ScheduleActivity } from '@alga-psa/types';

import { ActivitiesTableSkeleton } from './ActivitiesTableSkeleton';
import { getAllPriorities, getStatuses } from '@alga-psa/reference-data/actions';
import { getAllBoards } from '@alga-psa/reference-data/actions';
import { findAllTagsByType } from '@alga-psa/tags/actions';
import { isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { DEFAULT_TABLE_TYPES } from './constants';

interface ActivitiesDataTableSectionProps {
  title?: string;
  initialFilters?: ActivityFilters;
  id?: string;
}

const DEFAULT_FILTERS: ActivityFilters = {
  types: DEFAULT_TABLE_TYPES,
  isClosed: false,
};

type ListViewMode = 'flat' | 'grouped';

const PRINT_FALLBACK_PAGE_SIZE = 500;

function dedupeRecurringActivities(activities: Activity[]): Activity[] {
  const uniqueUpcomingActivities: Activity[] = [];
  const addedRecurringSeriesOnPage = new Set<string>();

  for (const activity of activities) {
    if (activity.type === ActivityType.SCHEDULE) {
      const scheduleActivity = activity as ScheduleActivity;
      if (scheduleActivity.isRecurring) {
        const seriesIdentifier = `${scheduleActivity.title}-${scheduleActivity.workItemId || 'no-item'}-${scheduleActivity.workItemType || 'no-type'}`;
        if (!addedRecurringSeriesOnPage.has(seriesIdentifier)) {
          uniqueUpcomingActivities.push(scheduleActivity);
          addedRecurringSeriesOnPage.add(seriesIdentifier);
        }
      } else {
        uniqueUpcomingActivities.push(activity);
      }
    } else {
      uniqueUpcomingActivities.push(activity);
    }
  }

  return uniqueUpcomingActivities;
}

export function ActivitiesDataTableSection({
  title,
  initialFilters = {},
  id = "activities-data-table-section"
}: ActivitiesDataTableSectionProps) {
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
  const { openActivityDrawer } = useActivityDrawer();
  const ctx = useActivityCrossFeature();

  // Flat vs grouped mode (persisted per user)
  const { value: listViewMode, setValue: setListViewMode } = useUserPreference<ListViewMode>(
    'activitiesListViewMode',
    {
      defaultValue: 'flat',
      localStorageKey: 'activitiesListViewMode',
      debounceMs: 300,
    }
  );

  // Determine if explicit filters were passed (e.g., from "View All" in cards view)
  const hasExplicitFilters = initialFilters.types && initialFilters.types.length > 0;

  // Persist filters to user preferences
  const {
    value: savedFilters,
    setValue: setSavedFilters,
    hasLoadedInitial: filtersLoaded,
  } = useUserPreference<ActivityFilters>(
    'activitiesTableFilters',
    {
      defaultValue: DEFAULT_FILTERS,
      localStorageKey: 'activitiesTableFilters',
      debounceMs: 1000,
    }
  );

  // Use explicit filters if provided, otherwise saved preferences
  const [filters, setFilters] = useState<ActivityFilters>(
    hasExplicitFilters ? initialFilters : DEFAULT_FILTERS
  );
  const [filtersInitialized, setFiltersInitialized] = useState(hasExplicitFilters);

  // Once saved preferences load, apply them (unless explicit filters were provided)
  useEffect(() => {
    if (filtersLoaded && !hasExplicitFilters && !filtersInitialized) {
      setFilters(savedFilters);
      setFiltersInitialized(true);
    }
  }, [filtersLoaded, hasExplicitFilters, filtersInitialized, savedFilters]);
  
  // Use the enhanced cache hook with loading state
  const {
    getActivities,
    invalidateCache,
    isLoading,
    isInitialLoad
  } = useActivitiesCache();

  // Priorities for the filter dropdown
  const [priorities, setPriorities] = useState<IPriority[]>([]);

  // Clients for the shared client filter
  const [clients, setClients] = useState<IClient[]>([]);

  // Projects (with phases + statuses) for the filter tree-select
  const [projects, setProjects] = useState<ProjectWithPhases[]>([]);

  // Boards and ticket statuses for ticket-specific filters
  const [boards, setBoards] = useState<Array<{ board_id?: string; board_name?: string }>>([]);
  const [ticketStatuses, setTicketStatuses] = useState<IStatus[]>([]);

  // Tags for ticket and project task filters
  const [ticketTags, setTicketTags] = useState<ITag[]>([]);
  const [projectTaskTags, setProjectTaskTags] = useState<ITag[]>([]);

  // Ungrouped collapse state (read here for print view, owned by UngroupedSection)
  const { value: ungroupedCollapsed } = useUserPreference<boolean>(
    'activitiesUngroupedCollapsed',
    { defaultValue: false, localStorageKey: 'activitiesUngroupedCollapsed' }
  );

  // User-defined activity groups (shared between GroupedActivitiesView + PrintableActivitiesView)
  const [activityGroups, setActivityGroups] = useState<ActivityGroup[]>([]);

  // Print section selection: which groups and whether to include ungrouped
  const {
    value: savedPrintGroupIds,
    setValue: setSavedPrintGroupIds,
  } = useUserPreference<string[] | null>(
    'activitiesPrintGroupIds',
    {
      defaultValue: null,
      localStorageKey: 'activitiesPrintGroupIds',
      debounceMs: 500,
    }
  );
  const {
    value: savedPrintUngrouped,
    setValue: setSavedPrintUngrouped,
  } = useUserPreference<boolean | null>(
    'activitiesPrintUngrouped',
    {
      defaultValue: null,
      localStorageKey: 'activitiesPrintUngrouped',
      debounceMs: 500,
    }
  );
  const effectivePrintUngrouped = savedPrintUngrouped ?? !ungroupedCollapsed;
  // Derive the effective selected group IDs, sanitized against current activityGroups
  const selectedPrintGroupIds = useMemo(() => {
    if (listViewMode !== 'grouped' || activityGroups.length === 0) return undefined;
    const validIds = new Set(activityGroups.map((g) => g.groupId));
    // Default: all non-collapsed groups. Once saved, preserve even an intentionally empty selection.
    const defaults = activityGroups.filter((g) => !g.isCollapsed).map((g) => g.groupId);
    const saved = savedPrintGroupIds?.filter((id) => validIds.has(id));
    return new Set(savedPrintGroupIds === null ? defaults : saved);
  }, [listViewMode, activityGroups, savedPrintGroupIds]);
  const [printActivities, setPrintActivities] = useState<Activity[] | null>(null);

  const loadActivityGroups = useCallback(async (): Promise<ActivityGroup[]> => {
    try {
      const groups = await getUserActivityGroups();
      setActivityGroups(groups);
      return groups;
    } catch (err) {
      console.error('Error loading activity groups:', err);
      return [];
    }
  }, []);

  // Load groups when grouped mode is active
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

  // Load priorities when a single prioritized activity type is selected
  useEffect(() => {
    const types = filters.types;
    if (types?.length === 1) {
      const type = types[0];
      if (type === ActivityType.TICKET || type === ActivityType.PROJECT_TASK) {
        const itemType = type === ActivityType.TICKET ? 'ticket' : 'project_task';
        getAllPriorities(itemType)
          .then(setPriorities)
          .catch(err => console.error('Error loading priorities:', err));
        return;
      }
    }
    setPriorities([]);
  }, [filters.types]);

  // Load clients for the shared client filter on mount
  useEffect(() => {
    ctx.getAllClients(false)
      .then((data: unknown) => {
        if (!isActionPermissionError(data)) {
          setClients(data as IClient[]);
        }
      })
      .catch((err: unknown) => console.error('Error loading clients:', err));
  }, [ctx]);

  // Load projects with phases + statuses for the filter tree on mount
  useEffect(() => {
    ctx.getProjectsWithPhases()
      .then((data: unknown) => {
        if (!isActionPermissionError(data)) {
          setProjects(data as ProjectWithPhases[]);
        }
      })
      .catch((err: unknown) => console.error('Error loading projects with phases:', err));
  }, [ctx]);

  // Load boards and ticket statuses on mount
  useEffect(() => {
    Promise.all([
      getAllBoards(true),
      getStatuses('ticket' as ItemType),
    ])
      .then(([boardsData, statusesData]) => {
        setBoards(boardsData || []);
        setTicketStatuses(statusesData || []);
      })
      .catch((err) => console.error('Error loading boards/statuses:', err));
  }, []);

  // Load tags on mount (for both ticket and project task filters)
  useEffect(() => {
    Promise.all([
      findAllTagsByType('ticket' as TaggedEntityType),
      findAllTagsByType('project_task' as TaggedEntityType),
    ])
      .then(([tt, pt]) => {
        setTicketTags(tt || []);
        setProjectTaskTags(pt || []);
      })
      .catch((err) => console.error('Error loading tags:', err));
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
  }), [filters, sortBy, sortDirection]);

  const loadActivities = useCallback(async () => {
    try {
      const effectiveFilters = getEffectiveFilters();

      const effectivePage = listViewMode === 'grouped' ? 1 : currentPage;
      const effectivePageSize = listViewMode === 'grouped' ? 500 : pageSize;

      const result = await getActivities(
        effectiveFilters,
        effectivePage,
        effectivePageSize
      );

      setActivities(result.activities);
      setTotalItems(result.totalCount);
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

  const handleFilterChange = useCallback((newFilters: ActivityFilters) => {
    setFilters(newFilters);
    setSavedFilters(newFilters);
    setCurrentPage(1);
  }, [setSavedFilters]);

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
    setPrintActivities(dedupeRecurringActivities(result.activities));
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

  const filteredActivitiesForTable = useMemo(() => (
    dedupeRecurringActivities(activities)
  ), [activities]);

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

  const handleResetPrintOptions = useCallback(() => {
    resetSelectedActivityPrintColumnKeys();
    setSavedPrintGroupIds(null);
    setSavedPrintUngrouped(null);
  }, [resetSelectedActivityPrintColumnKeys, setSavedPrintGroupIds, setSavedPrintUngrouped]);

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
            onChange={(v) => setListViewMode(v)}
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
        <ActivitiesTableFilters
          filters={filters}
          onChange={handleFilterChange}
          priorities={priorities}
          clients={clients}
          projects={projects}
          boards={boards}
          ticketStatuses={ticketStatuses}
          ticketTags={ticketTags}
          projectTaskTags={projectTaskTags}
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
            activities={filteredActivitiesForTable}
            serverGroups={activityGroups}
            onGroupsChange={async () => {
              await loadActivityGroups();
            }}
            onActionComplete={handleRefresh}
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
      </CardContent>
    </Card>
    <PrintableActivitiesView
      activities={printActivities ?? filteredActivitiesForTable}
      grouped={listViewMode === 'grouped'}
      serverGroups={activityGroups}
      ungroupedCollapsed={ungroupedCollapsed}
      title={effectiveTitle}
      columns={selectedActivityPrintColumns}
      selectedGroupIds={selectedPrintGroupIds}
      printUngrouped={effectivePrintUngrouped}
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
      onReset={handleResetPrintOptions}
      onPrint={() => triggerPrintActivities()}
      isPrinting={isPreparingActivityPrint}
      childrenSectionLabel={listViewMode === 'grouped' && activityGroups.length > 0
        ? t('table.print.optionsDialog.groupsLabel', { defaultValue: 'Sections to print' })
        : undefined}
    >
      {listViewMode === 'grouped' && activityGroups.length > 0 && (
        <div className="space-y-2 px-1">
          <div className="space-y-1.5">
            {activityGroups.map((group) => {
              const checked = selectedPrintGroupIds?.has(group.groupId) ?? false;
              return (
                <Checkbox
                  key={group.groupId}
                  id={`${id}-print-group-${group.groupId}`}
                  label={group.groupName}
                  checked={checked}
                  onChange={() => {
                    const next = new Set(selectedPrintGroupIds);
                    if (checked) {
                      next.delete(group.groupId);
                    } else {
                      next.add(group.groupId);
                    }
                    setSavedPrintGroupIds(Array.from(next));
                  }}
                  containerClassName="mb-0"
                  skipRegistration
                />
              );
            })}
          </div>
          <hr className="border-[rgb(var(--color-border-200))]" />
          <Checkbox
            id={`${id}-print-ungrouped`}
            label={t('table.print.optionsDialog.printUngrouped', { defaultValue: 'Ungrouped items' })}
            checked={effectivePrintUngrouped}
            onChange={() => setSavedPrintUngrouped(!effectivePrintUngrouped)}
            containerClassName="mb-0"
            skipRegistration
          />
        </div>
      )}
    </PrintOptionsDialog>
    </>
  );
}
