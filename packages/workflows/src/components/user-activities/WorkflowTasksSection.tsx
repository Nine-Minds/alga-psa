'use client';


import React, { useEffect, useState, useCallback } from 'react';
import { WorkflowTaskActivity, ActivityType, ActivityFilters } from '@alga-psa/types';
import { Button } from '@alga-psa/ui/components/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { WorkflowTaskCard } from './ActivityCard';
import { fetchDashboardWorkflowTasks } from '../../actions';
import { WorkflowTaskListDrawer } from './WorkflowTaskListDrawer';
import { useDrawer } from '@alga-psa/ui';
import { WorkflowTasksSectionFiltersDialog } from './filters/WorkflowTasksSectionFiltersDialog';
import { Filter, XCircleIcon } from 'lucide-react';
import { useActivityDrawer } from './ActivityDrawerProvider';

interface WorkflowTasksSectionProps {
  limit?: number;
  onViewAll?: () => void;
}

export function WorkflowTasksSection({ limit = 5, onViewAll }: WorkflowTasksSectionProps) {
  const [activities, setActivities] = useState<WorkflowTaskActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const drawer = useDrawer();
  const { openActivityDrawer } = useActivityDrawer();
  const [isFilterDialogOpen, setIsFilterDialogOpen] = useState(false);
  const [workflowFilters, setWorkflowFilters] = useState<Partial<ActivityFilters>>({ isClosed: false });
  const [workflowExecutions, setWorkflowExecutions] = useState<Array<{ execution_id: string; workflow_name: string }>>([]);
  const [filterDataLoading, setFilterDataLoading] = useState(true);

  // Fetch initial activities and filter data
  const loadActivities = useCallback(async (filters: Partial<ActivityFilters> = { isClosed: false }) => {
    try {
      setLoading(true);
      setError(null);
      // Fetch workflow task activities using current filters
      const result = await fetchDashboardWorkflowTasks(limit, filters);
      setActivities(result);
    } catch (err) {
      console.error('Error loading workflow task activities:', err);
      setError('Failed to load workflow task activities. Please try again later.');
    } finally {
      setLoading(false);
    }
  }, [limit]);

  // Fetch workflow executions for filter dropdown
  useEffect(() => {
    async function loadFilterData() {
      try {
        setFilterDataLoading(true);
        // In a real implementation, you would fetch workflow executions from the server
        // For now, we'll use a placeholder empty array that will be populated when tasks are loaded
        const uniqueExecutions = new Map<string, { execution_id: string; workflow_name: string }>();
        
        // Get executions from current activities
        activities.forEach(activity => {
          if (activity.executionId && !uniqueExecutions.has(activity.executionId)) {
            uniqueExecutions.set(activity.executionId, {
              execution_id: activity.executionId,
              workflow_name: activity.contextData?.workflowName || `Workflow ${activity.executionId.substring(0, 8)}`
            });
          }
        });
        
        setWorkflowExecutions(Array.from(uniqueExecutions.values()));
      } catch (err) {
        console.error('Error loading filter data:', err);
      } finally {
        setFilterDataLoading(false);
      }
    }
    loadFilterData();
  }, [activities]);

  // Load activities initially and when filters change
  useEffect(() => {
    loadActivities(workflowFilters);
  }, [workflowFilters, loadActivities]);

  const handleApplyFilters = (newFilters: Partial<ActivityFilters>) => {
    setWorkflowFilters(prevFilters => ({
      ...prevFilters, // Keep existing non-workflow filters if any
      ...newFilters, // Apply new workflow-specific filters
    }));
    // loadActivities will be triggered by the useEffect watching workflowFilters
  };

  // Function to check if filters are active (beyond the default)
  const isFiltersActive = useCallback(() => {
    const defaultFilters: Partial<ActivityFilters> = { isClosed: false };
    // Check if any filter key exists beyond the default 'isClosed'
    const hasExtraKeys = Object.keys(workflowFilters).some(key => !(key in defaultFilters));
    // Check if 'isClosed' is different from the default
    const isClosedChanged = workflowFilters.isClosed !== defaultFilters.isClosed;
    // Check if any filter value is actually set (not undefined or empty array for array types)
    const hasSetValues = Object.entries(workflowFilters).some(([key, value]) => {
      if (key === 'isClosed') return value !== false; // Check if isClosed is true
      if (Array.isArray(value)) return value.length > 0; // Check array filters
      return value !== undefined && value !== null && value !== ''; // Check other filters
    });

    // Consider filters active if they have extra keys, isClosed is true, or any value is set meaningfully
    return hasExtraKeys || isClosedChanged || hasSetValues;
  }, [workflowFilters]);

  const handleResetFilters = () => {
    setWorkflowFilters({ isClosed: false }); // Reset to default filters
    // loadActivities will be triggered by the useEffect watching workflowFilters
  };

  const handleRefresh = () => {
    // Reload activities with the current filters
    loadActivities(workflowFilters);
  };

  const handleViewDetails = (activity: WorkflowTaskActivity) => {
    openActivityDrawer(activity);
  };

  const handleViewAll = () => {
    if (onViewAll) {
      onViewAll();
      return;
    }

    drawer.openListDrawer(
      ActivityType.WORKFLOW_TASK,
      'Workflow Tasks',
      <WorkflowTaskListDrawer
        onSelectTask={(task) => {
          // First close the list drawer
          drawer.closeDrawer();
          
          // Then open the detail drawer after a short delay
          setTimeout(() => {
            handleViewDetails(task);
          }, 100);
        }}
      />
    );
  };

  return (
    <Card id="workflow-tasks-activities-card" className="col-span-1 md:col-span-2">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle>Workflow Tasks</CardTitle>
        <div className="flex items-center gap-2">
          <Button
            id="refresh-workflow-tasks-button"
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={loading}
            aria-label="Refresh Workflow Tasks"
          >
            Refresh
          </Button>
          {isFiltersActive() ? (
            <Button
              id="reset-workflow-task-filters-button"
              variant="outline"
              size="sm"
              onClick={handleResetFilters}
              disabled={loading}
              className="gap-1"
            >
              <XCircleIcon className="h-4 w-4" />
              Reset Filters
            </Button>
          ) : (
            <Button
              id="filter-workflow-tasks-button"
              variant="outline"
              size="sm"
              onClick={() => setIsFilterDialogOpen(true)}
              disabled={filterDataLoading || loading}
              aria-label="Filter Workflow Tasks"
            >
              <Filter size={16} className="mr-1" /> Filter
            </Button>
          )}
          <Button
            id="view-all-workflow-tasks-button"
            variant="outline"
            size="sm"
            onClick={handleViewAll}
          >
            View All
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex justify-center items-center h-40">
            <p className="text-gray-500">Loading workflow task activities...</p>
          </div>
        ) : error ? (
          <div className="flex justify-center items-center h-40">
            <p className="text-red-500">{error}</p>
          </div>
        ) : activities.length === 0 ? (
          <div className="flex justify-center items-center h-40">
            <p className="text-gray-500">No workflow task activities found</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {activities.map(activity => (
              <WorkflowTaskCard
                key={activity.id}
                activity={activity}
                onViewDetails={() => openActivityDrawer(activity)}
                onActionComplete={() => loadActivities(workflowFilters)}
              />
            ))}
          </div>
        )}
      </CardContent>

      {/* Workflow Task Filters Dialog */}
      {isFilterDialogOpen && (
        <WorkflowTasksSectionFiltersDialog
          isOpen={isFilterDialogOpen}
          onOpenChange={setIsFilterDialogOpen}
          initialFilters={workflowFilters}
          onApplyFilters={handleApplyFilters}
          workflowExecutions={workflowExecutions}
        />
      )}
    </Card>
  );
}
