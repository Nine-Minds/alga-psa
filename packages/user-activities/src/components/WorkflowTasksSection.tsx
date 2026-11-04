'use client';


import React from 'react';
import { WorkflowTaskActivity, ActivityFilters, ActivityType } from '@alga-psa/types';
import { Button } from '@alga-psa/ui/components/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { WorkflowTaskCard } from './ActivityCard';
import { useActivityDrawer } from './ActivityDrawerProvider';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { useActivitySectionFeed } from '../hooks/useActivitySectionFeed';
import { WorkflowTaskListDrawer } from './WorkflowTaskListDrawer';
import { useDrawer } from '@alga-psa/ui';

interface WorkflowTasksSectionProps {
  limit?: number;
  onViewAll?: () => void;
  /** The shared filter model (the same one the table uses). */
  filters: ActivityFilters;
  targetUserId?: string;
  /** Viewing another user: no action menus. */
  readOnly?: boolean;
}

export function WorkflowTasksSection({ limit = 5, onViewAll, filters, targetUserId = '', readOnly = false }: WorkflowTasksSectionProps) {
  const { t } = useTranslation('msp/user-activities');
  const { openActivityDrawer } = useActivityDrawer();
  const drawer = useDrawer();
  const feed = useActivitySectionFeed<WorkflowTaskActivity>(ActivityType.WORKFLOW_TASK, filters, targetUserId, limit);
  const { activities, loading } = feed;
  const error = feed.error
    ? t('sections.workflowTasks.errors.loadFailed', { defaultValue: 'Failed to load workflow task activities. Please try again later.' })
    : null;

  const handleViewAll = () => {
    if (onViewAll) {
      onViewAll();
      return;
    }

    drawer.openListDrawer(
      ActivityType.WORKFLOW_TASK,
      t('sections.workflowTasks.drawerTitle', { defaultValue: 'Workflow Tasks' }),
      <WorkflowTaskListDrawer
        onSelectTask={(task) => {
          // First close the list drawer
          drawer.closeDrawer();

          // Then open the detail drawer after a short delay
          setTimeout(() => {
            openActivityDrawer(task);
          }, 100);
        }}
      />
    );
  };

  return (
    <Card id="workflow-tasks-activities-card" className="col-span-1 md:col-span-2">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle>{t('sections.workflowTasks.title', { defaultValue: 'Workflow Tasks' })}</CardTitle>
        <div className="flex items-center gap-2">
          <Button
            id="refresh-workflow-tasks-button"
            variant="outline"
            size="sm"
            onClick={feed.refresh}
            disabled={loading}
            aria-label={t('sections.workflowTasks.ariaLabels.refresh', { defaultValue: 'Refresh Workflow Tasks' })}
          >
            {t('sections.workflowTasks.actions.refresh', { defaultValue: 'Refresh' })}
          </Button>
          <Button
            id="view-all-workflow-tasks-button"
            variant="outline"
            size="sm"
            onClick={handleViewAll}
          >
            {t('sections.workflowTasks.actions.viewAll', { defaultValue: 'View All' })}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex justify-center items-center h-40">
            <p className="text-gray-500">{t('sections.workflowTasks.states.loading', { defaultValue: 'Loading workflow task activities...' })}</p>
          </div>
        ) : error ? (
          <div className="flex justify-center items-center h-40">
            <p className="text-destructive">{error}</p>
          </div>
        ) : activities.length === 0 ? (
          <div className="flex justify-center items-center h-40">
            <p className="text-gray-500">{t('sections.workflowTasks.states.empty', { defaultValue: 'No workflow task activities found' })}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {activities.map(activity => (
              <WorkflowTaskCard
                key={activity.id}
                activity={activity}
                onViewDetails={() => openActivityDrawer(activity)}
                readOnly={readOnly}
                onActionComplete={feed.refresh}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
