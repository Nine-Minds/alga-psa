'use client';


import React from 'react';
import { ProjectTaskActivity, ActivityFilters, ActivityType } from '@alga-psa/types';
import { Button } from '@alga-psa/ui/components/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@alga-psa/ui/components/Card';
import { ProjectTaskCard } from './ActivityCard';
import { useActivityDrawer } from './ActivityDrawerProvider';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { useActivitySectionFeed } from '../hooks/useActivitySectionFeed';

interface ProjectsSectionProps {
  limit?: number;
  onViewAll?: () => void;
  /** The shared filter model (the same one the table uses). */
  filters: ActivityFilters;
  targetUserId?: string;
  /** Viewing another user: no action menus. */
  readOnly?: boolean;
}

export function ProjectsSection({ limit = 5, onViewAll, filters, targetUserId = '', readOnly = false }: ProjectsSectionProps) {
  const { t } = useTranslation('msp/user-activities');
  const { openActivityDrawer } = useActivityDrawer();
  const feed = useActivitySectionFeed<ProjectTaskActivity>(ActivityType.PROJECT_TASK, filters, targetUserId, limit);
  const { activities, loading } = feed;
  const error = feed.error
    ? t('sections.projects.errors.loadFailed', { defaultValue: 'Failed to load project activities. Please try again later.' })
    : null;

  return (
    <Card id="projects-activities-card">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle>{t('sections.projects.title', { defaultValue: 'Project Tasks' })}</CardTitle>
        <div className="flex items-center gap-2">
          <Button
            id="refresh-projects-button"
            variant="outline"
            size="sm"
            onClick={feed.refresh}
            disabled={loading}
            aria-label={t('sections.projects.ariaLabels.refresh', { defaultValue: 'Refresh Project Tasks' })}
          >
            {t('sections.projects.actions.refresh', { defaultValue: 'Refresh' })}
          </Button>
          <Button
            id="view-all-projects-button"
            variant="outline"
            size="sm"
            onClick={onViewAll}
          >
            {t('sections.projects.actions.viewAll', { defaultValue: 'View All' })}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex justify-center items-center h-40">
            <p className="text-gray-500">{t('sections.projects.states.loading', { defaultValue: 'Loading project activities...' })}</p>
          </div>
        ) : error ? (
          <div className="flex justify-center items-center h-40">
            <p className="text-destructive">{error}</p>
          </div>
        ) : activities.length === 0 ? (
          <div className="flex justify-center items-center h-40">
            <p className="text-gray-500">{t('sections.projects.states.empty', { defaultValue: 'No project activities found' })}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4">
            {activities.map(activity => (
              <ProjectTaskCard
                key={activity.id}
                activity={activity}
                onViewDetails={() => openActivityDrawer(activity)}
                readOnly={readOnly}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
