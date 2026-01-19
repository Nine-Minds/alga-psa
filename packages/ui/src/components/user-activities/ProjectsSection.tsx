'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { ProjectTaskActivity, ActivityFilters } from '@alga-psa/types';
import { Button } from '@alga-psa/ui/components/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { ProjectTaskCard } from './ActivityCard';
import { fetchProjectActivities } from '@alga-psa/workflows/actions';
import { ProjectSectionFiltersDialog } from './filters/ProjectSectionFiltersDialog';
import { Filter, XCircleIcon } from 'lucide-react';
import type { IProject, IProjectPhase } from '@alga-psa/types';
import { getProjects } from '@alga-psa/projects/actions/projectActions';
import { useActivityDrawer } from './ActivityDrawerProvider';

interface ProjectsSectionProps {
  limit?: number;
  onViewAll?: () => void;
}

export function ProjectsSection({ limit = 5, onViewAll }: ProjectsSectionProps) {
  const [activities, setActivities] = useState<ProjectTaskActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const { openActivityDrawer } = useActivityDrawer();
  const [error, setError] = useState<string | null>(null);
  const [isFilterDialogOpen, setIsFilterDialogOpen] = useState(false);
  const [projectTaskFilters, setProjectTaskFilters] = useState<Partial<ActivityFilters>>({ isClosed: false });
  const [projects, setProjects] = useState<IProject[]>([]);
  const [filterDataLoading, setFilterDataLoading] = useState(true);

  // Fetch initial activities and filter data
  const loadActivities = useCallback(async (filters: Partial<ActivityFilters>) => {
    try {
      setLoading(true);
      setError(null);
      // Fetch project activities using current filters
      const result = await fetchProjectActivities(filters);
      
      // Sort by priority (high to low) and then by due date (ascending)
      const sortedActivities = result.sort((a: ProjectTaskActivity, b: ProjectTaskActivity) => { // Added types
        // First sort by priority (high to low)
        const priorityOrder = {
          'high': 0,
          'medium': 1,
          'low': 2
        };
        const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
        if (priorityDiff !== 0) return priorityDiff;
        
        // Then sort by due date (closest first)
        if (a.dueDate && b.dueDate) {
          return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
        } else if (a.dueDate) {
          return -1; // a has due date, b doesn't
        } else if (b.dueDate) {
          return 1; // b has due date, a doesn't
        }
        
        return 0;
      });
      
      setActivities(sortedActivities.slice(0, limit));
    } catch (err) {
      console.error('Error loading project activities:', err);
      setError('Failed to load project activities. Please try again later.');
    } finally {
      setLoading(false);
    }
  }, [limit]); // Removed dependency on projectTaskFilters to avoid loop, loadActivities is called explicitly

  // Fetch filter options (projects) on mount
  useEffect(() => {
    async function loadFilterData() {
      try {
        setFilterDataLoading(true);
        const projectsData = await getProjects();
        setProjects(projectsData);
      } catch (err) {
        console.error('Error loading filter data:', err);
        // Optionally set an error state for filter data loading
      } finally {
        setFilterDataLoading(false);
      }
    }
    loadFilterData();
  }, []);

  // Load activities initially and when filters change
  useEffect(() => {
    loadActivities(projectTaskFilters);
  }, [projectTaskFilters, loadActivities]); // Depend on projectTaskFilters and the loadActivities function itself


  const handleRefresh = () => {
    // Reload activities with the current filters
    loadActivities(projectTaskFilters);
  };

  const handleApplyFilters = (newFilters: Partial<ActivityFilters>) => {
    setProjectTaskFilters(prevFilters => ({
      ...prevFilters, // Keep existing non-project filters if any
      ...newFilters, // Apply new project-specific filters
    }));
    // loadActivities will be triggered by the useEffect watching projectTaskFilters
  };

  // Function to check if filters are active (beyond the default)
  const isFiltersActive = useCallback(() => {
    const defaultFilters: Partial<ActivityFilters> = { isClosed: false };
    // Check if any filter key exists beyond the default 'isClosed'
    const hasExtraKeys = Object.keys(projectTaskFilters).some(key => !(key in defaultFilters));
    // Check if 'isClosed' is different from the default
    const isClosedChanged = projectTaskFilters.isClosed !== defaultFilters.isClosed;
    // Check if any filter value is actually set (not undefined or empty array for array types)
    const hasSetValues = Object.entries(projectTaskFilters).some(([key, value]) => {
        if (key === 'isClosed') return value !== false; // Check if isClosed is true
        if (Array.isArray(value)) return value.length > 0; // Check array filters
        return value !== undefined && value !== null && value !== ''; // Check other filters
    });

    // Consider filters active if they have extra keys, isClosed is true, or any value is set meaningfully
    return hasExtraKeys || isClosedChanged || hasSetValues;
  }, [projectTaskFilters]);

  const handleResetFilters = () => {
    setProjectTaskFilters({ isClosed: false }); // Reset to default filters
    // loadActivities will be triggered by the useEffect watching projectTaskFilters
  };

  return (
    <Card id="projects-activities-card">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle>Project Tasks</CardTitle>
        <div className="flex items-center gap-2">
          <Button
            id="refresh-projects-button"
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={loading}
            aria-label="Refresh Project Tasks"
          >
            Refresh
          </Button>
          {isFiltersActive() ? (
             <Button
               id="reset-project-filters-button"
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
               id="filter-projects-button"
               variant="outline"
               size="sm"
               onClick={() => setIsFilterDialogOpen(true)}
               disabled={filterDataLoading || loading}
               aria-label="Filter Project Tasks"
             >
               <Filter size={16} className="mr-1" /> Filter
             </Button>
           )}
          <Button
            id="view-all-projects-button"
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
            <p className="text-gray-500">Loading project activities...</p>
          </div>
        ) : error ? (
          <div className="flex justify-center items-center h-40">
            <p className="text-red-500">{error}</p>
          </div>
        ) : activities.length === 0 ? (
          <div className="flex justify-center items-center h-40">
            <p className="text-gray-500">No project activities found</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4">
            {activities.map(activity => (
              <ProjectTaskCard
                key={activity.id}
                activity={activity}
                onViewDetails={() => openActivityDrawer(activity)}
              />
            ))}
          </div>
        )}
      </CardContent>

      {isFilterDialogOpen && (
        <ProjectSectionFiltersDialog
          isOpen={isFilterDialogOpen}
          onOpenChange={setIsFilterDialogOpen}
          initialFilters={projectTaskFilters}
          onApplyFilters={handleApplyFilters}
          projects={projects}
          phases={[]}
        />
      )}
    </Card>
  );
}
