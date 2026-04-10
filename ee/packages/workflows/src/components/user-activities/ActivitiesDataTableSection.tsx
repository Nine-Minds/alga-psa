'use client';


import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  Activity,
  ActivityFilters,
  ActivityType,
  ActivityResponse,
  IPriority
} from '@alga-psa/types';
import { Card, CardContent, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { Button } from '@alga-psa/ui/components/Button';
import { RefreshCw } from 'lucide-react';
import { fetchActivities } from '@alga-psa/workflows/actions';
import { ActivitiesDataTable } from './ActivitiesDataTable';
import { ActivitiesTableFilters } from './filters/ActivitiesTableFilters';
import { useActivityDrawer } from './ActivityDrawerProvider';
import { useActivityCrossFeature } from '@alga-psa/ui/context';
import { useActivitiesCache } from '../../hooks/useActivitiesCache';
import { useUserPreference } from '@alga-psa/user-composition/hooks';
import { ScheduleActivity } from '@alga-psa/types';

// Lightweight shape for the project filter tree — matches getProjectsWithPhases
export interface ProjectWithPhasesForFilter {
  project_id: string;
  project_name: string;
  is_inactive: boolean;
  phases: Array<{ phase_id: string; phase_name: string; wbs_code: string }>;
}
import { ActivitiesTableSkeleton } from './ActivitiesTableSkeleton';
import { getAllPriorities } from '@alga-psa/reference-data/actions';
import { isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
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

export function ActivitiesDataTableSection({
  title = "All Activities",
  initialFilters = {},
  id = "activities-data-table-section"
}: ActivitiesDataTableSectionProps) {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [error, setError] = useState<string | null>(null);
  const { openActivityDrawer } = useActivityDrawer();
  const ctx = useActivityCrossFeature();

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

  // Projects (with phases) for the filter tree-select
  const [projects, setProjects] = useState<ProjectWithPhasesForFilter[]>([]);

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

  // Load projects with phases for the filter tree on mount
  useEffect(() => {
    ctx.getProjectsWithPhases()
      .then((data: any) => {
        if (!isActionPermissionError(data)) {
          setProjects(data);
        }
      })
      .catch((err: any) => console.error('Error loading projects with phases:', err));
  }, [ctx]);

  // Use useCallback to memoize loadActivities with cache
  const loadActivities = useCallback(async () => {
    try {
      // Prepare filter
      const effectiveFilters: ActivityFilters = {
        ...filters,
        // If types array is empty, explicitly request all activity types
        types: filters.types && filters.types.length > 0
          ? filters.types
          : Object.values(ActivityType),
        sortBy: sortBy as any,
        sortDirection,
      };

      // Use the cache to fetch activities
      const result = await getActivities(
        effectiveFilters,
        currentPage,
        pageSize
      );

      setActivities(result.activities);
      setTotalItems(result.totalCount);
      setError(null);
    } catch (err) {
      console.error(`Error loading activities (page ${currentPage}):`, err);
      setError('Failed to load activities. Please try again later.');
    }
  }, [filters, currentPage, pageSize, getActivities, sortBy, sortDirection]);

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
    <Card id={id}>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle>{title}</CardTitle>
        <div className="flex items-center gap-2">
          <Button
            id={`${id}-refresh-button`}
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={isLoading}
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <ActivitiesTableFilters
          filters={filters}
          onChange={handleFilterChange}
          priorities={priorities}
          projects={projects}
        />
        {isInitialLoad || (isLoading && activities.length === 0) ? (
          <ActivitiesTableSkeleton rowCount={pageSize} />
        ) : error ? (
          <div className="flex justify-center items-center h-40">
            <p className="text-destructive">{error}</p>
          </div>
        ) : activities.length === 0 ? (
          <div className="flex justify-center items-center h-40">
            <p className="text-gray-500">No activities found</p>
          </div>
        ) : filteredActivitiesForTable.length === 0 ? (
          <div className="flex justify-center items-center h-40">
            <p className="text-gray-500">No activities found matching filters</p>
          </div>
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
  );
}
