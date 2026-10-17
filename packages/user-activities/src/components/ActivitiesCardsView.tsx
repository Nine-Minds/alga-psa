'use client';

import React, { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { ActivityType } from '@alga-psa/types';
import { Card, CardHeader } from '@alga-psa/ui/components/Card';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { ScheduleSection } from './ScheduleSection';
import { TicketsSection } from './TicketsSection';
import { ProjectsSection } from './ProjectsSection';
import { WorkflowTasksSection } from './WorkflowTasksSection';
import { NotificationsSection } from './NotificationsSection';
import { ViewingUserPicker } from './ViewingUserPicker';
import { ActivitiesTableFilters } from './filters/ActivitiesTableFilters';
import type { ActivityFilterState } from '../hooks/useActivityFilterState';
import type { ActivityFilterOptions } from '../hooks/useActivityFilterOptions';
import { useViewableUsers } from '../hooks/useViewableUsers';

interface ActivitiesCardsViewProps {
  filterState: ActivityFilterState;
  filterOptions: ActivityFilterOptions;
  /** Bell deep link: Notifications in full mode, the other cards collapsed below it. */
  focusNotifications?: boolean;
  onViewAll: (types: ActivityType[]) => void;
}

type SectionKey = 'notifications' | 'schedule' | 'tickets' | 'projects' | 'workflowTasks';

function SectionHeader({ id, title, expanded, onToggle }: { id: string; title: string; expanded: boolean; onToggle: () => void }) {
  return (
    <CardHeader id={id} className="cursor-pointer hover:bg-muted/50 transition-colors" onClick={onToggle}>
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{title}</h2>
        {expanded ? (
          <ChevronUp className="h-5 w-5 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-5 w-5 text-muted-foreground" />
        )}
      </div>
    </CardHeader>
  );
}

/**
 * The cards view. Filters are the table's own `ActivitiesTableFilters`, bound to the shared
 * filter model, rendered inline above the cards; every visible section reads the same filters.
 */
export function ActivitiesCardsView({ filterState, filterOptions, focusNotifications = false, onViewAll }: ActivitiesCardsViewProps) {
  const { t } = useTranslation('msp/user-activities');
  const { filters, setFilters, targetUserId, setTargetUserId } = filterState;
  const { viewableUsers, canViewOthers } = useViewableUsers();
  const readOnly = canViewOthers && targetUserId !== '';

  const [expanded, setExpanded] = useState<Record<SectionKey, boolean>>(
    focusNotifications
      ? { notifications: true, schedule: false, tickets: false, projects: false, workflowTasks: false }
      : { notifications: true, schedule: true, tickets: true, projects: true, workflowTasks: true }
  );
  const toggle = (key: SectionKey) => setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));

  // Empty Types means "all types", exactly like the table query.
  const selected = filters.types ?? [];
  const shows = (type: ActivityType) => selected.length === 0 || selected.includes(type);

  const common = { filters, targetUserId, readOnly };

  const filterBar = (
    <div className="mb-4">
      {canViewOthers && (
        <ViewingUserPicker
          id="cards-viewing-user"
          className="mb-3 flex items-center gap-2"
          value={targetUserId}
          onChange={setTargetUserId}
          users={viewableUsers}
        />
      )}
      <ActivitiesTableFilters filters={filters} onChange={setFilters} {...filterOptions} />
    </div>
  );

  const notifications = !readOnly && (
    <Card>
      <SectionHeader
        id="cards-notifications-header"
        title={t('dashboard.sections.notifications', { defaultValue: 'Notifications' })}
        expanded={expanded.notifications}
        onToggle={() => toggle('notifications')}
      />
      {expanded.notifications && (
        <NotificationsSection
          {...(focusNotifications ? { fullMode: true } : { limit: 5 })}
          onViewAll={() => onViewAll([ActivityType.NOTIFICATION])}
        />
      )}
    </Card>
  );

  const schedule = shows(ActivityType.SCHEDULE) && (
    <Card>
      <SectionHeader
        id="cards-schedule-header"
        title={t('dashboard.sections.schedule', { defaultValue: 'Schedule' })}
        expanded={expanded.schedule}
        onToggle={() => toggle('schedule')}
      />
      {expanded.schedule && (
        <ScheduleSection limit={5} onViewAll={() => onViewAll([ActivityType.SCHEDULE])} {...common} />
      )}
    </Card>
  );

  if (focusNotifications) {
    // Focus layout: one collapsible card per section, notifications on top.
    return (
      <div className="space-y-6">
        {notifications}
        {filterBar}
        {schedule}
        {shows(ActivityType.TICKET) && (
          <Card>
            <SectionHeader
              id="cards-tickets-header"
              title={t('sections.tickets.title', { defaultValue: 'Tickets' })}
              expanded={expanded.tickets}
              onToggle={() => toggle('tickets')}
            />
            {expanded.tickets && (
              <TicketsSection limit={5} onViewAll={() => onViewAll([ActivityType.TICKET])} {...common} />
            )}
          </Card>
        )}
        {shows(ActivityType.PROJECT_TASK) && (
          <Card>
            <SectionHeader
              id="cards-projects-header"
              title={t('sections.projects.title', { defaultValue: 'Project Tasks' })}
              expanded={expanded.projects}
              onToggle={() => toggle('projects')}
            />
            {expanded.projects && (
              <ProjectsSection limit={5} onViewAll={() => onViewAll([ActivityType.PROJECT_TASK])} {...common} />
            )}
          </Card>
        )}
        {shows(ActivityType.WORKFLOW_TASK) && (
          <Card>
            <SectionHeader
              id="cards-workflow-tasks-header"
              title={t('sections.workflowTasks.title', { defaultValue: 'Workflow Tasks' })}
              expanded={expanded.workflowTasks}
              onToggle={() => toggle('workflowTasks')}
            />
            {expanded.workflowTasks && (
              <WorkflowTasksSection limit={5} onViewAll={() => onViewAll([ActivityType.WORKFLOW_TASK])} {...common} />
            )}
          </Card>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {notifications}
      {filterBar}
      {schedule}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {shows(ActivityType.TICKET) && (
          <TicketsSection limit={5} onViewAll={() => onViewAll([ActivityType.TICKET])} {...common} />
        )}
        {shows(ActivityType.PROJECT_TASK) && (
          <ProjectsSection limit={5} onViewAll={() => onViewAll([ActivityType.PROJECT_TASK])} {...common} />
        )}
        {shows(ActivityType.WORKFLOW_TASK) && (
          <WorkflowTasksSection limit={5} onViewAll={() => onViewAll([ActivityType.WORKFLOW_TASK])} {...common} />
        )}
      </div>
    </div>
  );
}
