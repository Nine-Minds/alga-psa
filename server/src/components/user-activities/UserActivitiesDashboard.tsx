import React, { useState, useEffect, useMemo } from 'react';
import ViewSwitcher, { ViewSwitcherOption } from 'server/src/components/ui/ViewSwitcher';
import { ScheduleSection } from './ScheduleSection';
import { TicketsSection } from './TicketsSection';
import { ProjectsSection } from './ProjectsSection';
import { WorkflowTasksSection } from './WorkflowTasksSection';
import { ActivitiesDataTableSection } from './ActivitiesDataTableSection';
import { Button } from '../ui/Button';
import { LayoutGrid, List } from 'lucide-react';
import { ActivityFilters as ActivityFiltersType, ActivityType } from 'server/src/interfaces/activity.interfaces';
import { CustomTabs } from '../ui/CustomTabs';
import { DrawerProvider } from 'server/src/context/DrawerContext';
import { ActivityDrawerProvider } from './ActivityDrawerProvider';
import { useUserPreference } from 'server/src/hooks/useUserPreference';
import { useFeatureFlag } from 'server/src/hooks/useFeatureFlag';

export function UserActivitiesDashboard() {
  // Define view mode type
  type UserActivitiesViewMode = 'cards' | 'table';
  
  // Check if advanced features are enabled
  const advancedFeatureFlag = useFeatureFlag('advanced-features-enabled');
  const isAdvancedFeaturesEnabled = typeof advancedFeatureFlag === 'boolean' ? advancedFeatureFlag : advancedFeatureFlag?.enabled;
  
  // Use the custom hook for view mode preference
  const { 
    value: viewMode, 
    setValue: setViewModePreference,
    isLoading: isViewModeLoading 
  } = useUserPreference<UserActivitiesViewMode>(
    'activitiesDashboardViewMode',
    {
      defaultValue: 'cards',
      localStorageKey: 'activitiesDashboardViewMode',
      debounceMs: 300
    }
  );
  
  const [tableInitialFilters, setTableInitialFilters] = useState<ActivityFiltersType | null>(null); // State for specific filters

  // Generic handler for "View All" clicks
  const handleViewAll = (types: ActivityType[]) => {
    const filters: ActivityFiltersType = { types, isClosed: false };
    setTableInitialFilters(filters);
    setViewModePreference('table');
  };

  // Specific handlers calling the generic one
  const handleViewAllSchedule = () => handleViewAll([ActivityType.SCHEDULE]); // Corrected Enum Member
  const handleViewAllProjects = () => handleViewAll([ActivityType.PROJECT_TASK]);
  const handleViewAllTickets = () => handleViewAll([ActivityType.TICKET]);
  const handleViewAllWorkflowTasks = () => handleViewAll([ActivityType.WORKFLOW_TASK]);


  // Determine the filters to apply to the table
  const currentTableFilters: ActivityFiltersType = tableInitialFilters || {
    types: [], // Default: Load all activity types
    isClosed: false // Default: Only show open activities
  };

  // Table view content - Defined before use and memoized to prevent unnecessary re-renders
  const tableViewContent = useMemo(() => (
    <ActivitiesDataTableSection
      title={tableInitialFilters ? `Filtered Activities` : "All Activities"} // Dynamic title
      initialFilters={currentTableFilters}
      id="all-activities-table-section"
    />
  ), [currentTableFilters, tableInitialFilters]
  );

  // Card view content - Defined before use and memoized to prevent unnecessary re-renders
  const cardViewContent = useMemo(() => (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      {/* Schedule Section */}
      <ScheduleSection
        limit={5}
        onViewAll={handleViewAllSchedule}
      />

      {/* Tickets Section */}
      <TicketsSection
        limit={5}
        onViewAll={handleViewAllTickets}
      />

      {/* Projects Section */}
      <ProjectsSection
        limit={5}
        onViewAll={handleViewAllProjects}
      />

      {/* Workflow Tasks Section - Only show if advanced features are enabled */}
      {isAdvancedFeaturesEnabled && (
        <WorkflowTasksSection
          limit={5}
          onViewAll={handleViewAllWorkflowTasks}
        />
      )}
    </div>
  ), [handleViewAllSchedule, handleViewAllTickets, handleViewAllProjects, handleViewAllWorkflowTasks, isAdvancedFeaturesEnabled]
  );

  // Define options for the ViewSwitcher with explicit type
  const viewOptions: ViewSwitcherOption<UserActivitiesViewMode>[] = [
    { value: 'cards', label: 'Cards', icon: LayoutGrid },
    { value: 'table', label: 'Table', icon: List },
  ];

  // Handler for view change
  const handleViewChange = (newView: UserActivitiesViewMode) => {
    setViewModePreference(newView);
    if (newView === 'table') {
      setTableInitialFilters(null); // Reset specific filters when switching to table view
    }
  };

  return (
    <DrawerProvider>
      <ActivityDrawerProvider>
        <div className="container mx-auto p-6">
          <div className="flex items-center justify-between mb-6">
            <h1 className="text-2xl font-bold">User Activities</h1>
            <div className="flex items-center gap-4">
              <ViewSwitcher
                options={viewOptions}
                currentView={viewMode}
                onChange={handleViewChange}
              />
            </div>
          </div>

          {isViewModeLoading ? (
            <div className="flex justify-center items-center h-40">
              <p className="text-gray-500">Loading user preferences...</p>
            </div>
          ) : (
            viewMode === 'cards' ? cardViewContent : tableViewContent
          )}
        </div>
      </ActivityDrawerProvider>
    </DrawerProvider>
  );
}