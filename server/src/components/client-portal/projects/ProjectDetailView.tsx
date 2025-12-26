'use client';

import React, { useEffect, useState } from 'react';
import { IProject } from 'server/src/interfaces/project.interfaces';
import DonutChart from 'server/src/components/projects/DonutChart';
import HoursProgressBar from 'server/src/components/projects/HoursProgressBar';
import { calculateProjectCompletion, ProjectCompletionMetrics } from 'server/src/lib/utils/projectUtils';
import { formatDistanceToNow } from 'date-fns';
import { getDateFnsLocale } from 'server/src/lib/utils/dateFnsLocale';
import { useTranslation } from 'server/src/lib/i18n/client';
import { DEFAULT_CLIENT_PORTAL_CONFIG } from 'server/src/interfaces/project.interfaces';
import ProjectPhaseTasksView from './ProjectPhaseTasksView';

interface ProjectDetailViewProps {
  project: IProject;
}

export default function ProjectDetailView({ project }: ProjectDetailViewProps) {
  const { t, i18n } = useTranslation('clientPortal');
  const dateLocale = getDateFnsLocale(i18n.language);
  const [metrics, setMetrics] = useState<ProjectCompletionMetrics | null>(null);
  const [loading, setLoading] = useState(true);

  // Get client portal config with default fallback
  const config = project.client_portal_config ?? DEFAULT_CLIENT_PORTAL_CONFIG;

  useEffect(() => {
    const fetchMetrics = async () => {
      try {
        const projectMetrics = await calculateProjectCompletion(project.project_id);
        setMetrics(projectMetrics);
      } catch (error) {
        console.error('Error fetching project metrics:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchMetrics();
  }, [project.project_id]);

  if (loading) {
    return (
      <div className="p-6 bg-white rounded-lg shadow">
        <div className="animate-pulse">
          <div className="h-6 bg-gray-200 rounded w-3/4 mb-4"></div>
          <div className="h-4 bg-gray-200 rounded w-1/2 mb-6"></div>
          <div className="flex space-x-4 mb-6">
            <div className="h-20 w-20 bg-gray-200 rounded-full"></div>
            <div className="flex-1 space-y-4">
              <div className="h-4 bg-gray-200 rounded w-3/4"></div>
              <div className="h-4 bg-gray-200 rounded w-1/2"></div>
            </div>
          </div>
          <div className="h-4 bg-gray-200 rounded w-full mb-2"></div>
          <div className="h-4 bg-gray-200 rounded w-full mb-2"></div>
          <div className="h-4 bg-gray-200 rounded w-3/4"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 bg-white rounded-lg shadow">
      <h2 className="text-2xl font-bold mb-2">{project.project_name}</h2>
      <p className="text-gray-600 mb-6">
        {project.description || t('projects.messages.noDescription', 'No description provided')}
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        <div className="bg-gray-50 p-4 rounded-lg">
          <h3 className="text-lg font-semibold mb-4">{t('projects.taskCompletion', 'Task Completion')}</h3>
            <div className="flex items-center">
              <div className="mr-4">
                <DonutChart 
                  percentage={metrics?.taskCompletionPercentage || 0} 
                  tooltipContent="Shows the percentage of completed tasks across the entire project"
                />
              </div>
              <div>
                <p className="font-medium">{t('projects.percentComplete', '{{percent}}% Complete', { percent: Math.round(metrics?.taskCompletionPercentage || 0) })}</p>
                <p className="text-sm text-gray-600">
                  {t('projects.tasksCompleted', '{{completed}} of {{total}} tasks completed', { completed: metrics?.completedTasks || 0, total: metrics?.totalTasks || 0 })}
                </p>
              </div>
            </div>
        </div>

        <div className="bg-gray-50 p-4 rounded-lg">
          <h3 className="text-lg font-semibold mb-4">{t('projects.budgetHours', 'Budget Hours')}</h3>
          <div className="flex flex-col">
            {/* Make this a column flex container */}
            <div className="flex flex-col mb-1">
              <p className="font-medium">{t('projects.budgetUsed', '{{percent}}% of Budget Used', { percent: Math.round(metrics?.hoursCompletionPercentage || 0) })}</p>
              {/* Put hours on a new line */}
              <p className="text-sm text-gray-600">
                {t('projects.hoursUsed', '{{spent}} of {{budgeted}} hours', { spent: (metrics?.spentHours || 0).toFixed(1), budgeted: (metrics?.budgetedHours || 0).toFixed(1) })}
              </p>
            </div>
            <HoursProgressBar 
              percentage={metrics?.hoursCompletionPercentage || 0}
              width={'100%'}
              height={8}
              showTooltip={true}
              tooltipContent={
                <div className="p-2">
                  <p className="font-medium">{t('projects.hoursUsage', 'Hours Usage')}</p>
                  {/* Display hours directly from metrics */}
                  <p className="text-sm">{t('projects.hoursUsedDetail', '{{spent}} of {{budgeted}} hours used', { spent: (metrics?.spentHours || 0).toFixed(1), budgeted: (metrics?.budgetedHours || 0).toFixed(1) })}</p>
                  <p className="text-sm">{t('projects.hoursRemaining', '{{remaining}} hours remaining', { remaining: (metrics?.remainingHours || 0).toFixed(1) })}</p>
                </div>
              }
            />
          </div>
        </div>
      </div>

      <div className="mb-6">
        <h3 className="text-lg font-semibold mb-2">{t('projects.details')}</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <p className="text-sm text-gray-600">{t('projects.startDate')}</p>
            <p className="font-medium">
              {project.start_date
                ? new Date(project.start_date).toLocaleDateString()
                : t('common.notSpecified', 'Not specified')}
            </p>
          </div>
          <div>
            <p className="text-sm text-gray-600">{t('projects.endDate')}</p>
            <p className="font-medium">
              {project.end_date
                ? new Date(project.end_date).toLocaleDateString()
                : t('common.notSpecified', 'Not specified')}
            </p>
          </div>
          <div>
            <p className="text-sm text-gray-600">{t('projects.lastUpdated', 'Last Updated')}</p>
            <p className="font-medium">
              {project.updated_at
                ? formatDistanceToNow(new Date(project.updated_at), { addSuffix: true, locale: dateLocale })
                : t('common.unknown', 'Unknown')}
            </p>
          </div>
          <div>
            <p className="text-sm text-gray-600">{t('projects.fields.status')}</p>
            <p className="font-medium">{project.status ? t(`projects.status.${project.status.toLowerCase().replace(/\s+/g, '')}`, project.status) : t('projects.status.active', 'Active')}</p>
          </div>
        </div>
      </div>

      {/* Unified Phases & Tasks View - respects all config settings */}
      {(config.show_phases || config.show_tasks) && (
        <ProjectPhaseTasksView
          projectId={project.project_id}
          config={config}
        />
      )}
    </div>
  );
}
