'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Button } from 'server/src/components/ui/Button';
import { RefreshCw, ChevronDown, History } from 'lucide-react';
import LoadingIndicator from 'server/src/components/ui/LoadingIndicator';
import {
  ITicketActivity,
  TicketActivityFilters,
  ActivityTypeCounts,
  GroupedActivities
} from 'server/src/interfaces/ticketActivity.interfaces';
import {
  getTicketTimeline,
  getActivityTypeCounts,
  getActivitiesGroupedByDate
} from 'server/src/lib/actions/ticketActivityActions';
import { TimelineItem, TimelineDateSeparator } from './TimelineItem';
import { TimelineFilters, TimelineFilterBar } from './TimelineFilters';

interface TicketTimelineProps {
  ticketId: string;
  variant?: 'full' | 'compact';
  maxHeight?: string;
  className?: string;
}

/**
 * Visual timeline showing all ticket activities
 */
export function TicketTimeline({
  ticketId,
  variant = 'full',
  maxHeight = '600px',
  className = ''
}: TicketTimelineProps) {
  const [groupedActivities, setGroupedActivities] = useState<GroupedActivities[]>([]);
  const [activityCounts, setActivityCounts] = useState<ActivityTypeCounts>({});
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<TicketActivityFilters>({});
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [showFilters, setShowFilters] = useState(false);

  const loadActivities = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      // Load grouped activities and counts in parallel
      const [grouped, counts] = await Promise.all([
        getActivitiesGroupedByDate(ticketId, filters),
        getActivityTypeCounts(ticketId)
      ]);

      setGroupedActivities(grouped);
      setActivityCounts(counts);

      // Calculate total
      const totalCount = grouped.reduce((sum, g) => sum + g.activities.length, 0);
      setTotal(totalCount);
      setHasMore(false); // For now, we load all at once

    } catch (err) {
      console.error('Error loading timeline:', err);
      setError(err instanceof Error ? err.message : 'Failed to load timeline');
    } finally {
      setLoading(false);
    }
  }, [ticketId, filters]);

  useEffect(() => {
    loadActivities();
  }, [loadActivities]);

  const handleRefresh = () => {
    loadActivities();
  };

  if (loading) {
    return (
      <div className={`flex items-center justify-center py-12 ${className}`}>
        <LoadingIndicator text="Loading timeline..." />
      </div>
    );
  }

  if (error) {
    return (
      <div className={`text-center py-8 ${className}`}>
        <p className="text-red-600 text-sm mb-4">{error}</p>
        <Button id="retry-timeline" variant="outline" onClick={handleRefresh}>
          <RefreshCw className="w-4 h-4 mr-2" />
          Retry
        </Button>
      </div>
    );
  }

  const totalActivities = Object.values(activityCounts).reduce((sum, count) => sum + (count || 0), 0);

  if (variant === 'compact') {
    // Compact variant for sidebar or embedded view
    const recentActivities = groupedActivities
      .flatMap(g => g.activities)
      .slice(0, 5);

    return (
      <div className={className}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2 text-sm font-medium text-gray-700">
            <History className="w-4 h-4" />
            Recent Activity
          </div>
          <span className="text-xs text-gray-500">{totalActivities} total</span>
        </div>

        <div className="space-y-3">
          {recentActivities.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-4">No activity yet</p>
          ) : (
            recentActivities.map((activity, index) => (
              <TimelineItem
                key={activity.activity_id}
                activity={activity}
                showConnector={index < recentActivities.length - 1}
              />
            ))
          )}
        </div>
      </div>
    );
  }

  // Full variant
  return (
    <div className={className}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <h3 className="text-lg font-medium text-gray-900">Activity Timeline</h3>
          <span className="text-sm text-gray-500">
            {total} {total === 1 ? 'activity' : 'activities'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            id="toggle-timeline-filters"
            variant={showFilters ? 'default' : 'outline'}
            size="sm"
            onClick={() => setShowFilters(!showFilters)}
          >
            Filters
            {filters.activity_types && filters.activity_types.length > 0 && (
              <span className="ml-1 bg-white/20 px-1.5 rounded text-xs">
                {filters.activity_types.length}
              </span>
            )}
          </Button>
          <Button id="refresh-timeline" variant="ghost" size="sm" onClick={handleRefresh}>
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Filter bar (always visible) */}
      <TimelineFilterBar
        filters={filters}
        onFiltersChange={setFilters}
        className="mb-4"
      />

      {/* Expanded filters */}
      {showFilters && (
        <div className="mb-4 p-4 bg-gray-50 rounded-lg">
          <TimelineFilters
            filters={filters}
            onFiltersChange={setFilters}
            activityCounts={activityCounts}
          />
        </div>
      )}

      {/* Timeline content */}
      <div
        className="overflow-y-auto pr-2"
        style={{ maxHeight }}
      >
        {groupedActivities.length === 0 ? (
          <div className="text-center py-12">
            <History className="w-12 h-12 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-500">No activities to show</p>
            {filters.activity_types && filters.activity_types.length > 0 && (
              <p className="text-sm text-gray-400 mt-1">
                Try adjusting your filters
              </p>
            )}
          </div>
        ) : (
          groupedActivities.map((group, groupIndex) => (
            <div key={group.date}>
              <TimelineDateSeparator date={group.date} />
              {group.activities.map((activity, activityIndex) => (
                <TimelineItem
                  key={activity.activity_id}
                  activity={activity}
                  showConnector={
                    activityIndex < group.activities.length - 1 ||
                    groupIndex < groupedActivities.length - 1
                  }
                />
              ))}
            </div>
          ))
        )}

        {/* Load more button */}
        {hasMore && (
          <div className="text-center py-4">
            <Button
              id="load-more-activities"
              variant="outline"
              onClick={() => {/* Load more logic */}}
              disabled={loadingMore}
            >
              {loadingMore ? (
                <LoadingIndicator size={16} />
              ) : (
                <>
                  <ChevronDown className="w-4 h-4 mr-2" />
                  Load More
                </>
              )}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

export default TicketTimeline;
