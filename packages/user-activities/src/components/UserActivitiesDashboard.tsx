'use client';


import React, { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import ViewSwitcher, { ViewSwitcherOption } from '@alga-psa/ui/components/ViewSwitcher';
import { ScheduleSection } from './ScheduleSection';
import { TicketsSection } from './TicketsSection';
import { ProjectsSection } from './ProjectsSection';
import { WorkflowTasksSection } from './WorkflowTasksSection';
import { NotificationsSection } from './NotificationsSection';
import { ActivitiesDataTableSection } from './ActivitiesDataTableSection';
import { LayoutGrid, List, ChevronDown, ChevronUp } from 'lucide-react';
import { ActivityFilters as ActivityFiltersType, ActivityType } from '@alga-psa/types';
import { useUserPreference } from '@alga-psa/user-composition/hooks';
import { Card, CardHeader } from '@alga-psa/ui/components/Card';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

export function UserActivitiesDashboard() {
  const { t } = useTranslation('msp/user-activities');
  const searchParams = useSearchParams();
  // Bell "View all notifications" deep-links here with ?focus=notifications. Treat it
  // as an EPHEMERAL card-view override (task 29.8.46).
  const focusNotifications = searchParams?.get('focus') === 'notifications';
  // Define view mode type
  type UserActivitiesViewMode = 'cards' | 'table';

  // Use the custom hook for view mode preference
  const {
    value: viewMode,
    setValue: setViewModePreference
  } = useUserPreference<UserActivitiesViewMode>(
    'activitiesDashboardViewMode',
    {
      defaultValue: 'table',
      localStorageKey: 'activitiesDashboardViewMode',
      debounceMs: 300
    }
  );

  // Ephemeral, in-memory view override (flag on only): "View All" and the focus deep
  // link switch the view for the current visit WITHOUT persisting the saved preference.
  // The ViewSwitcher remains the only thing that writes the preference.
  const [ephemeralView, setEphemeralView] = useState<UserActivitiesViewMode | null>(null);

  const [tableInitialFilters, setTableInitialFilters] = useState<ActivityFiltersType | null>(null); // State for specific filters

  // Collapsible sections state
  const [expandedSections, setExpandedSections] = useState({
    notifications: true,
    schedule: true,
  });

  // Focus-mode collapsible state (flag on): notifications expanded to full mode with
  // the other sections present but collapsed below it.
  const [focusExpandedSections, setFocusExpandedSections] = useState({
    notifications: true,
    schedule: false,
    tickets: false,
    projects: false,
    workflowTasks: false,
  });

  const toggleSection = (section: keyof typeof expandedSections) => {
    setExpandedSections(prev => ({
      ...prev,
      [section]: !prev[section]
    }));
  };

  const toggleFocusSection = (section: keyof typeof focusExpandedSections) => {
    setFocusExpandedSections(prev => ({
      ...prev,
      [section]: !prev[section]
    }));
  };

  // Generic handler for "View All" clicks
  const handleViewAll = (types: ActivityType[]) => {
    const filters: ActivityFiltersType = { types, isClosed: false };
    setTableInitialFilters(filters);
    // Switch to the table view ephemerally; do NOT persist the preference.
    setEphemeralView('table');
  };

  // Specific handlers calling the generic one
  const handleViewAllSchedule = () => handleViewAll([ActivityType.SCHEDULE]); // Corrected Enum Member
  const handleViewAllProjects = () => handleViewAll([ActivityType.PROJECT_TASK]);
  const handleViewAllTickets = () => handleViewAll([ActivityType.TICKET]);
  const handleViewAllWorkflowTasks = () => handleViewAll([ActivityType.WORKFLOW_TASK]);
  const handleViewAllNotifications = () => handleViewAll([ActivityType.NOTIFICATION]);


  // Determine the filters to apply to the table.
  // When no explicit "View All" filters were passed, hand the table an EMPTY object so it
  // hydrates from the user's saved preferences (due/created dates, client, tags, search, …).
  // Injecting default types here would make the table's `hasExplicitFilters` true and
  // permanently bypass that hydration — silently dropping every persisted filter on reload.
  // The table falls back to its own DEFAULT_FILTERS when the user has no saved preference.
  const currentTableFilters: ActivityFiltersType = tableInitialFilters || {};

  // Table view content - Defined before use and memoized to prevent unnecessary re-renders
  const tableViewContent = useMemo(() => (
    <ActivitiesDataTableSection
      title={tableInitialFilters
        ? t('dashboard.filteredTitle', { defaultValue: 'Filtered Activities' })
        : t('dashboard.allActivitiesTitle', { defaultValue: 'All Activities' })}
      initialFilters={currentTableFilters}
      id="all-activities-table-section"
    />
  ), [currentTableFilters, tableInitialFilters, t]
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
            <h2 className="text-lg font-semibold">{t('dashboard.sections.notifications', { defaultValue: 'Notifications' })}</h2>
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
            <h2 className="text-lg font-semibold">{t('dashboard.sections.schedule', { defaultValue: 'Schedule' })}</h2>
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

        {/* Workflow Tasks Section */}
        <WorkflowTasksSection
          limit={5}
          onViewAll={handleViewAllWorkflowTasks}
        />
      </div>
    </div>
  ), [handleViewAllSchedule, handleViewAllTickets, handleViewAllProjects, handleViewAllNotifications, handleViewAllWorkflowTasks, expandedSections.notifications, expandedSections.schedule]
  );

  // Define options for the ViewSwitcher with explicit type
  const viewOptions: ViewSwitcherOption<UserActivitiesViewMode>[] = [
    { value: 'cards', label: t('dashboard.viewSwitcher.cards', { defaultValue: 'Cards' }), icon: LayoutGrid },
    { value: 'table', label: t('dashboard.viewSwitcher.table', { defaultValue: 'Table' }), icon: List },
  ];

  // Handler for view change (the ViewSwitcher — the only writer of the saved preference)
  const handleViewChange = (newView: UserActivitiesViewMode) => {
    setViewModePreference(newView);
    // An explicit switch also wins over any ephemeral/focus override this visit.
    setEphemeralView(newView);
    if (newView === 'table') {
      setTableInitialFilters(null); // Reset specific filters when switching to table view
    }
  };

  // Effective view mode: an ephemeral override wins, else the focus deep link
  // forces cards, else the saved preference.
  const effectiveViewMode: UserActivitiesViewMode =
    ephemeralView ?? (focusNotifications ? 'cards' : viewMode);

  // Focus-mode card layout: notifications expanded to full mode, the other
  // sections rendered collapsed below — still present and expandable.
  const focusCardViewContent = (
    <div className="space-y-6">
      {/* Notifications — expanded, full mode with server-side pagination + priority chips */}
      <Card>
        <CardHeader
          className="cursor-pointer hover:bg-muted/50 transition-colors"
          onClick={() => toggleFocusSection('notifications')}
        >
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">{t('dashboard.sections.notifications', { defaultValue: 'Notifications' })}</h2>
            {focusExpandedSections.notifications ? (
              <ChevronUp className="h-5 w-5 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-5 w-5 text-muted-foreground" />
            )}
          </div>
        </CardHeader>
        {focusExpandedSections.notifications && (
          <NotificationsSection
            fullMode
            onViewAll={handleViewAllNotifications}
          />
        )}
      </Card>

      {/* Schedule — collapsed */}
      <Card>
        <CardHeader
          className="cursor-pointer hover:bg-muted/50 transition-colors"
          onClick={() => toggleFocusSection('schedule')}
        >
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">{t('dashboard.sections.schedule', { defaultValue: 'Schedule' })}</h2>
            {focusExpandedSections.schedule ? (
              <ChevronUp className="h-5 w-5 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-5 w-5 text-muted-foreground" />
            )}
          </div>
        </CardHeader>
        {focusExpandedSections.schedule && (
          <ScheduleSection limit={5} onViewAll={handleViewAllSchedule} />
        )}
      </Card>

      {/* Tickets — collapsed */}
      <Card>
        <CardHeader
          className="cursor-pointer hover:bg-muted/50 transition-colors"
          onClick={() => toggleFocusSection('tickets')}
        >
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">{t('sections.tickets.title', { defaultValue: 'Tickets' })}</h2>
            {focusExpandedSections.tickets ? (
              <ChevronUp className="h-5 w-5 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-5 w-5 text-muted-foreground" />
            )}
          </div>
        </CardHeader>
        {focusExpandedSections.tickets && (
          <TicketsSection limit={5} onViewAll={handleViewAllTickets} />
        )}
      </Card>

      {/* Projects — collapsed */}
      <Card>
        <CardHeader
          className="cursor-pointer hover:bg-muted/50 transition-colors"
          onClick={() => toggleFocusSection('projects')}
        >
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">{t('sections.projects.title', { defaultValue: 'Project Tasks' })}</h2>
            {focusExpandedSections.projects ? (
              <ChevronUp className="h-5 w-5 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-5 w-5 text-muted-foreground" />
            )}
          </div>
        </CardHeader>
        {focusExpandedSections.projects && (
          <ProjectsSection limit={5} onViewAll={handleViewAllProjects} />
        )}
      </Card>

      {/* Workflow Tasks — collapsed */}
      <Card>
        <CardHeader
          className="cursor-pointer hover:bg-muted/50 transition-colors"
          onClick={() => toggleFocusSection('workflowTasks')}
        >
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">{t('sections.workflowTasks.title', { defaultValue: 'Workflow Tasks' })}</h2>
            {focusExpandedSections.workflowTasks ? (
              <ChevronUp className="h-5 w-5 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-5 w-5 text-muted-foreground" />
            )}
          </div>
        </CardHeader>
        {focusExpandedSections.workflowTasks && (
          <WorkflowTasksSection limit={5} onViewAll={handleViewAllWorkflowTasks} />
        )}
      </Card>
    </div>
  );

  // Pick the main content. Table always wins when selected; otherwise the focus
  // deep link renders the focus layout, else the standard card view.
  let mainContent: React.ReactNode;
  if (effectiveViewMode === 'table') {
    mainContent = tableViewContent;
  } else if (focusNotifications) {
    mainContent = focusCardViewContent;
  } else {
    mainContent = cardViewContent;
  }

  return (
    <div className="container mx-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">{t('dashboard.title', { defaultValue: 'User Activities' })}</h1>
        <div className="flex items-center gap-4">
          <ViewSwitcher
            options={viewOptions}
            currentView={effectiveViewMode}
            onChange={handleViewChange}
          />
        </div>
      </div>

      {mainContent}
    </div>
  );
}
