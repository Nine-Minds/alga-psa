import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import {
  Activity,
  ActivityFilters,
  ActivityType,
  ActivityResponse
} from '../../interfaces/activity.interfaces';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/Card';
import { Button } from '../ui/Button';
import { RefreshCw, Filter, XCircleIcon } from 'lucide-react';
import { fetchActivities } from '../../lib/actions/activity-actions/activityServerActions';
import { ActivitiesDataTable } from './ActivitiesDataTable';
import { ActivitiesTableFilters, ActivitiesTableFiltersRef } from './filters/ActivitiesTableFilters';
import { useActivityDrawer } from './ActivityDrawerProvider';
import { useActivitiesCache } from 'server/src/hooks/useActivitiesCache';

interface ActivitiesDataTableSectionProps {
  title?: string;
  initialFilters?: ActivityFilters;
  id?: string;
}

export function ActivitiesDataTableSection({
  title = "All Activities",
  initialFilters = {},
  id = "activities-data-table-section"
}: ActivitiesDataTableSectionProps) {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<ActivityFilters>(initialFilters);
  const filtersRef = useRef<ActivitiesTableFiltersRef>(null); // Create ref for ActivitiesTableFilters
  const { openActivityDrawer } = useActivityDrawer();
  
  // Use the enhanced cache hook with loading state
  const {
    getActivities,
    invalidateCache,
    getCacheStats,
    isLoading,
    isInitialLoad
  } = useActivitiesCache();

  // Pagination State
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [totalItems, setTotalItems] = useState(0);

  // Check if any filters are active - memoized
  const isFiltersActive = useCallback(() => {
    // Check if any filter has a non-default value
    const hasTypes = filters.types && filters.types.length > 0;
    const hasStatus = filters.status && filters.status.length > 0;
    const hasPriority = filters.priority && filters.priority.length > 0;
    const hasAssignedTo = filters.assignedTo && filters.assignedTo.length > 0;
    const hasDateRange = filters.dueDateStart || filters.dueDateEnd;
    const isClosed = filters.isClosed === true; // Default is false
    
    return hasTypes || hasStatus || hasPriority || hasAssignedTo || hasDateRange || isClosed;
  }, [filters]);

  // Handle reset filters - memoized
  const handleResetFilters = useCallback(() => {
    // Reset to default filters
    setFilters({});
    setCurrentPage(1); // Reset to first page
  }, []);

  // Use useCallback to memoize loadActivities with cache
  const loadActivities = useCallback(async () => {
    try {
      // Prepare filter
      const effectiveFilters = {
        ...filters,
        // If types array is empty, explicitly request all activity types
        types: filters.types && filters.types.length > 0
          ? filters.types
          : Object.values(ActivityType).filter(type => type !== ActivityType.WORKFLOW_TASK)
      };

      console.log(`Loading activities page ${currentPage} with filters:`, effectiveFilters);

      // Use the cache to fetch activities
      const result = await getActivities(
        effectiveFilters,
        currentPage,
        pageSize
      );

      console.log(`Loaded ${result.activities.length} activities, total: ${result.totalCount}`);
      setActivities(result.activities);
      setTotalItems(result.totalCount); // Set total items count from response
      setError(null);
    } catch (err) {
      console.error(`Error loading activities (page ${currentPage}):`, err);
      setError('Failed to load activities. Please try again later.');
    }
  }, [filters, currentPage, pageSize, getActivities]); // Add getActivities to dependencies

  // useEffect to trigger loadActivities when filters or pagination changes
  useEffect(() => {
    loadActivities();
  }, [loadActivities]); // Dependency is the memoized function itself

  // Memoize event handlers to prevent unnecessary re-renders
  const handleViewDetails = useCallback((activity: Activity) => {
    openActivityDrawer(activity);
  }, [openActivityDrawer]);

  const handleRefresh = useCallback(() => {
    // Invalidate cache for current filters to ensure fresh data
    invalidateCache({
      filters,
      page: currentPage,
      pageSize
    });
    loadActivities();
  }, [loadActivities, invalidateCache, filters, currentPage, pageSize]);

  const handleFilterChange = useCallback((newFilters: ActivityFilters) => {
    setFilters(prev => ({
      ...prev,
      ...newFilters
    }));
    setCurrentPage(1);
  }, []);

  const handlePageChange = useCallback((newPage: number) => {
    setCurrentPage(newPage);
  }, []);

  return (
    <Card id={id}>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle>{title}</CardTitle>
        <div className="flex items-center gap-2">
          {isFiltersActive() ? (
            <Button
              id={`${id}-reset-filters-button`}
              variant="outline"
              size="sm"
              onClick={handleResetFilters}
              disabled={isLoading}
            >
              <XCircleIcon className="h-4 w-4 mr-2" />
              Reset Filters
            </Button>
          ) : (
            <Button
              id={`${id}-filter-button`}
              variant="outline"
              size="sm"
              onClick={() => filtersRef.current?.openDialog()}
              disabled={isLoading}
            >
              <Filter className="h-4 w-4 mr-2" />
              Filters
            </Button>
          )}
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
        {/* Render ActivitiesTableFilters always, pass the ref */}
        {/* Visibility is handled internally by its Dialog */}
        <ActivitiesTableFilters
          ref={filtersRef}
          filters={filters}
          onChange={handleFilterChange}
        />
        {isLoading ? (
          <div className="flex justify-center items-center h-40">
            <div className="flex flex-col items-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 mb-2"></div>
              <p className="text-gray-500">Loading activities...</p>
            </div>
          </div>
        ) : error ? (
          <div className="flex justify-center items-center h-40">
            <p className="text-red-500">{error}</p>
          </div>
        ) : activities.length === 0 ? (
          <div className="flex justify-center items-center h-40">
            <p className="text-gray-500">No activities found</p>
          </div>
        ) : (
          <ActivitiesDataTable
            activities={activities}
            onViewDetails={handleViewDetails}
            onActionComplete={handleRefresh}
            isLoading={isLoading}
            // Pass pagination props
            currentPage={currentPage}
            pageSize={pageSize}
            totalItems={totalItems}
            onPageChange={handlePageChange}
          />
        )}
      </CardContent>

    </Card>
  );
}
