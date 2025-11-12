import React, { useEffect, useState } from 'react';
import { ActivityFilters, ScheduleActivity, ActivityType } from '../../interfaces/activity.interfaces';
import { Button } from '../ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/Card';
import { ScheduleCard } from './ActivityCard';
import { fetchScheduleActivities } from '../../lib/actions/activity-actions/activityServerActions';
import { ScheduleSectionFiltersDialog } from './filters/ScheduleSectionFiltersDialog';
import { FilterIcon, XCircleIcon } from 'lucide-react';
import { useActivityDrawer } from './ActivityDrawerProvider';

interface ScheduleSectionProps {
  limit?: number;
  onViewAll?: () => void;
  noCard?: boolean;
}

export function ScheduleSection({ limit = 5, onViewAll, noCard = false }: ScheduleSectionProps) {
  const [activities, setActivities] = useState<ScheduleActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const { openActivityDrawer } = useActivityDrawer();
  const [error, setError] = useState<string | null>(null);
  const [scheduleFilters, setScheduleFilters] = useState<Partial<ActivityFilters>>({ 
    isClosed: false,
    dateRangeStart: new Date().toISOString(),
    dateRangeEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
  });
  const [isFilterDialogOpen, setIsFilterDialogOpen] = useState(false);

  useEffect(() => {
    loadActivities();
  }, [limit, scheduleFilters]);

  const isFiltersActive = (): boolean => {
    // Check if any filter is active (different from default)
    if (scheduleFilters.isClosed !== false) return true;
    if (scheduleFilters.search) return true;
    if (scheduleFilters.isRecurring) return true;
    if (scheduleFilters.workItemType) return true;
    
    // For date range, check if it's different from the default 30-day range
    const defaultStart = new Date().toISOString().split('T')[0];
    const defaultEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    
    const currentStart = scheduleFilters.dateRangeStart?.split('T')[0];
    const currentEnd = scheduleFilters.dateRangeEnd?.split('T')[0];
    
    if (currentStart !== defaultStart || currentEnd !== defaultEnd) return true;
    
    return false;
  };

  const handleResetFilters = () => {
    setScheduleFilters({
      isClosed: false,
      dateRangeStart: new Date().toISOString(),
      dateRangeEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    });
  };

  async function loadActivities() {
    try {
      setLoading(true);
      // Fetch schedule activities with current filters
      const result = await fetchScheduleActivities(scheduleFilters);
      
      // Sort by start date (ascending)
      const sortedActivities = result.sort((a, b) => {
        if (a.startDate && b.startDate) {
          return new Date(a.startDate).getTime() - new Date(b.startDate).getTime();
        }
        return 0;
      });

      const uniqueUpcomingActivities: ScheduleActivity[] = [];
      const addedRecurringSeries = new Set<string>();

      for (const activity of sortedActivities) {
        if (activity.type === ActivityType.SCHEDULE) {
          const scheduleActivity = activity as ScheduleActivity;
          if (scheduleActivity.isRecurring) {
            const seriesIdentifier = `${scheduleActivity.title}-${scheduleActivity.workItemId || 'no-item'}-${scheduleActivity.workItemType || 'no-type'}`;
            if (!addedRecurringSeries.has(seriesIdentifier)) {
              uniqueUpcomingActivities.push(scheduleActivity);
              addedRecurringSeries.add(seriesIdentifier);
            }
          } else {
            uniqueUpcomingActivities.push(scheduleActivity);
          }
        }
      }
      
      setActivities(uniqueUpcomingActivities.slice(0, limit));
      setError(null);
    } catch (err) {
      console.error('Error loading schedule activities:', err);
      setError('Failed to load schedule activities. Please try again later.');
    } finally {
      setLoading(false);
    }
  }
  

  const handleRefresh = async () => {
    try {
      setLoading(true);
      const result = await fetchScheduleActivities(scheduleFilters);
      
      const sortedActivities = result.sort((a, b) => {
        if (a.startDate && b.startDate) {
          return new Date(a.startDate).getTime() - new Date(b.startDate).getTime();
        }
        return 0;
      });

      const uniqueUpcomingActivities: ScheduleActivity[] = [];
      const addedRecurringSeries = new Set<string>();

      for (const activity of sortedActivities) {
        if (activity.type === ActivityType.SCHEDULE) {
          const scheduleActivity = activity as ScheduleActivity;
          if (scheduleActivity.isRecurring) {
            const seriesIdentifier = `${scheduleActivity.title}-${scheduleActivity.workItemId || 'no-item'}-${scheduleActivity.workItemType || 'no-type'}`;
            if (!addedRecurringSeries.has(seriesIdentifier)) {
              uniqueUpcomingActivities.push(scheduleActivity);
              addedRecurringSeries.add(seriesIdentifier);
            }
          } else {
            uniqueUpcomingActivities.push(scheduleActivity);
          }
        }
      }
      
      setActivities(uniqueUpcomingActivities.slice(0, limit));
      setError(null);
    } catch (err) {
      console.error('Error refreshing schedule activities:', err);
      setError('Failed to refresh schedule activities. Please try again later.');
    } finally {
      setLoading(false);
    }
  };

  const handleApplyFilters = (filters: Partial<ActivityFilters>) => {
    setScheduleFilters(filters);
  };

  const headerContent = (
    <div className="flex flex-row items-center justify-between pb-2 px-6 pt-6">
      {!noCard && <h3 className="text-lg font-semibold">Schedule</h3>}
      <div className="flex items-center gap-2">
        <Button
          id="refresh-schedule-button"
          variant="outline"
          size="sm"
          onClick={handleRefresh}
          disabled={loading}
        >
          Refresh
        </Button>
        {isFiltersActive() ? (
          <Button
            id="reset-schedule-filters-button"
            variant="outline"
            size="sm"
            onClick={handleResetFilters}
            className="gap-1"
          >
            <XCircleIcon className="h-4 w-4" />
            Reset Filters
          </Button>
        ) : (
          <Button
            id="filter-schedule-button"
            variant="outline"
            size="sm"
            onClick={() => setIsFilterDialogOpen(true)}
            className="gap-1"
          >
            <FilterIcon className="h-4 w-4" />
            Filter
          </Button>
        )}
        <Button
          id="view-all-schedule-button"
          variant="outline"
          size="sm"
          onClick={onViewAll}
        >
          View All
        </Button>
      </div>
    </div>
  );

  const bodyContent = (
    <div className="px-6 pb-6">
      {loading ? (
        <div className="flex justify-center items-center h-40">
          <p className="text-gray-500">Loading schedule activities...</p>
        </div>
      ) : error ? (
        <div className="flex justify-center items-center h-40">
          <p className="text-red-500">{error}</p>
        </div>
      ) : activities.length === 0 ? (
        <div className="flex justify-center items-center h-40">
          <p className="text-gray-500">No schedule activities found</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {activities.map(activity => (
            <ScheduleCard
              key={activity.id}
              activity={activity}
              onViewDetails={() => openActivityDrawer(activity)}
            />
          ))}
        </div>
      )}
      {/* Schedule Filters Dialog */}
      <ScheduleSectionFiltersDialog
        isOpen={isFilterDialogOpen}
        onOpenChange={setIsFilterDialogOpen}
        initialFilters={scheduleFilters}
        onApplyFilters={handleApplyFilters}
      />
    </div>
  );

  if (noCard) {
    return (
      <>
        {headerContent}
        {bodyContent}
      </>
    );
  }

  return (
    <Card id="schedule-activities-card" className="col-span-1 md:col-span-2">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle>Schedule</CardTitle>
        <div className="flex items-center gap-2">
          <Button
            id="refresh-schedule-button"
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={loading}
          >
            Refresh
          </Button>
          {isFiltersActive() ? (
            <Button
              id="reset-schedule-filters-button"
              variant="outline"
              size="sm"
              onClick={handleResetFilters}
              className="gap-1"
            >
              <XCircleIcon className="h-4 w-4" />
              Reset Filters
            </Button>
          ) : (
            <Button
              id="filter-schedule-button"
              variant="outline"
              size="sm"
              onClick={() => setIsFilterDialogOpen(true)}
              className="gap-1"
            >
              <FilterIcon className="h-4 w-4" />
              Filter
            </Button>
          )}
          <Button
            id="view-all-schedule-button"
            variant="outline"
            size="sm"
            onClick={onViewAll}
          >
            View All
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex justify-center items-center h-40">
            <p className="text-gray-500">Loading schedule activities...</p>
          </div>
        ) : error ? (
          <div className="flex justify-center items-center h-40">
            <p className="text-red-500">{error}</p>
          </div>
        ) : activities.length === 0 ? (
          <div className="flex justify-center items-center h-40">
            <p className="text-gray-500">No schedule activities found</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4">
            {activities.map(activity => (
              <ScheduleCard
                key={activity.id}
                activity={activity}
                onViewDetails={() => openActivityDrawer(activity)}
              />
            ))}
          </div>
        )}
      </CardContent>


      {/* Schedule Filters Dialog */}
      <ScheduleSectionFiltersDialog
        isOpen={isFilterDialogOpen}
        onOpenChange={setIsFilterDialogOpen}
        initialFilters={scheduleFilters}
        onApplyFilters={handleApplyFilters}
      />
    </Card>
  );
}