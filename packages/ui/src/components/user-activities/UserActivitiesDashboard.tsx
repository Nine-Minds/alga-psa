'use client';

import React, { useState, useEffect, useMemo } from 'react';
import ViewSwitcher, { ViewSwitcherOption } from '@alga-psa/ui/components/ViewSwitcher';
import { ScheduleSection } from './ScheduleSection';
import { TicketsSection } from './TicketsSection';
import { ProjectsSection } from './ProjectsSection';
import { WorkflowTasksSection } from './WorkflowTasksSection';
import { NotificationsSection } from './NotificationsSection';
import { ActivitiesDataTableSection } from './ActivitiesDataTableSection';
import { Button } from '@alga-psa/ui/components/Button';
import { LayoutGrid, List, ChevronDown, ChevronUp } from 'lucide-react';
import { ActivityFilters as ActivityFiltersType, ActivityType } from '@alga-psa/types';
import { CustomTabs } from '@alga-psa/ui/components/CustomTabs';
import { DrawerProvider } from '../../context/DrawerContext';
import { ActivityDrawerProvider } from './ActivityDrawerProvider';
import { useUserPreference } from '../../hooks/useUserPreference';
import { useFeatureFlag } from '../../hooks/useFeatureFlag';
import { Card, CardHeader } from '@alga-psa/ui/components/Card';

export function UserActivitiesDashboard() {
  // Define view mode type
  type UserActivitiesViewMode = 'cards' | 'table';
  
  // Check if advanced features are enabled
  const advancedFeatureFlag = useFeatureFlag('advanced-features-enabled');
  const isAdvancedFeaturesEnabled = typeof advancedFeatureFlag === 'boolean' ? advancedFeatureFlag : advancedFeatureFlag?.enabled;
  
  // Use the custom hook for view mode preference
  const { 
    value: viewMode, 
    setValue: setViewModePreference
  } = useUserPreference<UserActivitiesViewMode>(
    'activitiesDashboardViewMode',
    {
      defaultValue: 'cards',
      localStorageKey: 'activitiesDashboardViewMode',
      debounceMs: 300
    }
  );
  
  const [tableInitialFilters, setTableInitialFilters] = useState<ActivityFiltersType | null>(null); // State for specific filters

  // Collapsible sections state
  const [expandedSections, setExpandedSections] = useState({
    notifications: true,
    schedule: true,
  });

  const toggleSection = (section: keyof typeof expandedSections) => {
    setExpandedSections(prev => ({
      ...prev,
      [section]: !prev[section]
    }));
  };

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
  const handleViewAllNotifications = () => handleViewAll([ActivityType.NOTIFICATION]);


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
    <div className="space-y-6">
      {/* Notifications Section - Full width at top with collapsible card wrapper */}
      <Card>
        <CardHeader
          className="cursor-pointer hover:bg-muted/50 transition-colors"
          onClick={() => toggleSection('notifications')}
        >
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Notifications</h2>
            {expandedSections.notifications ? (
              <ChevronUp className="h-5 w-5 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-5 w-5 text-muted-foreground" />
            )}
          </div>
        </CardHeader>
        {expandedSections.notifications && (
          <NotificationsSection
            limit={5}
            onViewAll={handleViewAllNotifications}
          />
        )}
      </Card>

      {/* Schedule Section - Full width with collapsible card wrapper */}
      <Card>
        <CardHeader
          className="cursor-pointer hover:bg-muted/50 transition-colors"
          onClick={() => toggleSection('schedule')}
        >
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Schedule</h2>
            {expandedSections.schedule ? (
              <ChevronUp className="h-5 w-5 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-5 w-5 text-muted-foreground" />
            )}
          </div>
        </CardHeader>
        {expandedSections.schedule && (
          <ScheduleSection
            limit={5}
            onViewAll={handleViewAllSchedule}
          />
        )}
      </Card>

      {/* Other sections in 2-column grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
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
    </div>
  ), [handleViewAllSchedule, handleViewAllTickets, handleViewAllProjects, handleViewAllNotifications, handleViewAllWorkflowTasks, isAdvancedFeaturesEnabled, expandedSections.notifications, expandedSections.schedule]
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

          {viewMode === 'cards' ? cardViewContent : tableViewContent}
        </div>
      </ActivityDrawerProvider>
    </DrawerProvider>
  );
}
