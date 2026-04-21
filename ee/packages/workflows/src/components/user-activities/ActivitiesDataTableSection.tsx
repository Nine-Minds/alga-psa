'use client';


import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  Activity,
  ActivityFilters,
  ActivityType,
  ActivityResponse,
  IPriority,
  IStatus,
  ITag,
  ProjectWithPhases,
} from '@alga-psa/types';
import { Card, CardContent, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Button } from '@alga-psa/ui/components/Button';
import { RefreshCw, List, LayoutList, Printer } from 'lucide-react';
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
    getCacheStats,
    isLoading,
    isInitialLoad
  } = useActivitiesCache();

  // Priorities for the filter dropdown
  const [priorities, setPriorities] = useState<IPriority[]>([]);

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

  const loadActivityGroups = useCallback(async () => {
    try {
      const groups = await getUserActivityGroups();
      setActivityGroups(groups);
    } catch (err) {
      console.error('Error loading activity groups:', err);
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
  const [sortBy, setSortBy] = useState<string | undefined>(undefined);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  const handleSortChange = useCallback((nextSortBy: string, nextDirection: 'asc' | 'desc') => {
    setSortBy(nextSortBy);
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

  // Load projects with phases + statuses for the filter tree on mount
  useEffect(() => {
    ctx.getProjectsWithPhases()
      .then((data: any) => {
        if (!isActionPermissionError(data)) {
          setProjects(data);
        }
      })
      .catch((err: any) => console.error('Error loading projects with phases:', err));
  }, [ctx]);

  // Load boards and ticket statuses on mount
  useEffect(() => {
    Promise.all([
      getAllBoards(true),
      getStatuses('ticket' as any),
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
      findAllTagsByType('ticket' as any),
      findAllTagsByType('project_task' as any),
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
  const loadActivities = useCallback(async () => {
    try {
      const effectiveFilters: ActivityFilters = {
        ...filters,
        types: filters.types && filters.types.length > 0
          ? filters.types
          : Object.values(ActivityType),
        sortBy: sortBy as any,
        sortDirection,
      };

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
  }, [filters, currentPage, pageSize, getActivities, sortBy, sortDirection, listViewMode, t]);

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

  const handlePrint = useCallback(() => {
    const html = document.documentElement;
    html.classList.add('ua-print-mode');
    const cleanup = () => {
      html.classList.remove('ua-print-mode');
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    // Give the browser a tick to apply the class before opening the dialog
    setTimeout(() => window.print(), 50);
  }, []);

  const handlePageChange = useCallback((newPage: number) => {
    setCurrentPage(newPage);
  }, []);

  const handlePageSizeChange = useCallback((newPageSize: number) => {
    setPageSize(newPageSize);
    setCurrentPage(1); // Reset to first page when changing page size
  }, []);

  const filteredActivitiesForTable = useMemo(() => {
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
          uniqueUpcomingActivities.push(scheduleActivity);
        }
      } else {
        uniqueUpcomingActivities.push(activity);
      }
    }
    return uniqueUpcomingActivities;
  }, [activities]);
 
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
          <Button
            id={`${id}-print-button`}
            variant="outline"
            size="sm"
            onClick={handlePrint}
            disabled={isLoading || activities.length === 0}
          >
            <Printer className="h-4 w-4 mr-2" />
            {t('table.actions.print', { defaultValue: 'Print' })}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <ActivitiesTableFilters
          filters={filters}
          onChange={handleFilterChange}
          priorities={priorities}
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
            onGroupsChange={loadActivityGroups}
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
      activities={filteredActivitiesForTable}
      grouped={listViewMode === 'grouped'}
      serverGroups={activityGroups}
      ungroupedCollapsed={ungroupedCollapsed}
      title={effectiveTitle}
    />
    </>
  );
}
