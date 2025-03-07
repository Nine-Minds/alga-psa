import React, { useState } from 'react';
import { ActivityFilters } from './ActivityFilters';
import { ScheduleSection } from './ScheduleSection';
import { TicketsSection } from './TicketsSection';
import { ProjectsSection } from './ProjectsSection';
import { WorkflowTasksSection } from './WorkflowTasksSection';
import { ActivitiesDataTableSection } from './ActivitiesDataTableSection';
import { Button } from '../ui/Button';
import { RefreshCw, LayoutGrid, List } from 'lucide-react';
import { ActivityFilters as ActivityFiltersType } from '../../interfaces/activity.interfaces';
import { fetchDashboardActivities } from '../../lib/actions/activity-actions/activityServerActions';
import { CustomTabs } from '../ui/CustomTabs';
import { DrawerProvider } from '../../context/DrawerContext';

export function UserActivitiesDashboard() {
  const [filters, setFilters] = useState<ActivityFiltersType>({
    types: [],
    status: [],
    priority: [],
    assignedTo: [],
    isClosed: false
  });
  const [refreshing, setRefreshing] = useState(false);
  const [viewMode, setViewMode] = useState<'cards' | 'table'>('cards');

  // Handle filter changes
  const handleFilterChange = (newFilters: ActivityFiltersType) => {
    setFilters(newFilters);
  };

  // Handle refresh button click
  const handleRefresh = async () => {
    try {
      setRefreshing(true);
      // In a real implementation, this would trigger a refresh of all sections
      // For now, we'll just wait a bit to simulate a refresh
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (error) {
      console.error('Error refreshing dashboard:', error);
    } finally {
      setRefreshing(false);
    }
  };

  // Handle view all button click for each section
  const handleViewAllSchedule = () => {
    // In a real implementation, this would navigate to the schedule page or open a drawer
    console.log('View all schedule entries');
  };

  const handleViewAllProjects = () => {
    // In a real implementation, this would navigate to the projects page or open a drawer
    console.log('View all project tasks');
  };

  const handleViewAllTickets = () => {
    // In a real implementation, this would navigate to the tickets page or open a drawer
    console.log('View all tickets');
  };

  const handleViewAllWorkflowTasks = () => {
    // In a real implementation, this would navigate to the workflow tasks page or open a drawer
    console.log('View all workflow tasks');
  };

  // Card view content
  const cardViewContent = (
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

      {/* Workflow Tasks Section */}
      <WorkflowTasksSection
        limit={5}
        onViewAll={handleViewAllWorkflowTasks}
      />
    </div>
  );

  // Table view content
  const tableViewContent = (
    <ActivitiesDataTableSection
      title="All Activities"
      initialFilters={filters}
      id="all-activities-table-section"
    />
  );

  return (
    <DrawerProvider>
      <div className="container mx-auto p-6">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">User Activities</h1>
          <div className="flex items-center gap-4">
            <div className="flex items-center border rounded-md overflow-hidden">
              <Button
                id="card-view-button"
                variant={viewMode === 'cards' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setViewMode('cards')}
                className="rounded-none border-0"
              >
                <LayoutGrid className="h-4 w-4 mr-2" />
                Cards
              </Button>
              <Button
                id="table-view-button"
                variant={viewMode === 'table' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setViewMode('table')}
                className="rounded-none border-0"
              >
                <List className="h-4 w-4 mr-2" />
                Table
              </Button>
            </div>
            <ActivityFilters
              filters={filters}
              onChange={handleFilterChange}
            />
            <Button
              id="refresh-activities-button"
              size="sm"
              onClick={handleRefresh}
              disabled={refreshing}
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
              {refreshing ? 'Refreshing...' : 'Refresh'}
            </Button>
          </div>
        </div>

        {viewMode === 'cards' ? cardViewContent : tableViewContent}
      </div>
    </DrawerProvider>
  );
}