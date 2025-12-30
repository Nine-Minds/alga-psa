'use client';

import React, { useEffect, useState, useMemo } from 'react';
import { IProject, IClientPortalConfig, DEFAULT_CLIENT_PORTAL_CONFIG } from 'server/src/interfaces/project.interfaces';
import DonutChart from 'server/src/components/projects/DonutChart';
import HoursProgressBar from 'server/src/components/projects/HoursProgressBar';
import { calculateProjectCompletion, ProjectCompletionMetrics } from 'server/src/lib/utils/projectUtils';
import { formatDistanceToNow, format } from 'date-fns';
import { getDateFnsLocale } from 'server/src/lib/utils/dateFnsLocale';
import { useTranslation } from 'server/src/lib/i18n/client';
import ViewSwitcher from 'server/src/components/ui/ViewSwitcher';
import {
  getClientProjectPhases,
  getClientProjectTasks,
  getClientProjectStatuses,
  getClientProjectTasksForKanban
} from 'server/src/lib/actions/client-portal-actions/client-project-details';
import ClientKanbanBoard from './ClientKanbanBoard';
import ClientTaskListView from './ClientTaskListView';
import { LayoutGrid, List } from 'lucide-react';

interface ProjectDetailViewProps {
  project: IProject;
}

type ViewMode = 'kanban' | 'list';

interface Phase {
  phase_id: string;
  phase_name: string;
  description: string | null;
  start_date: Date | null;
  end_date: Date | null;
  completion_percentage?: number;
}

interface Status {
  project_status_mapping_id: string;
  name: string;
  display_order: number;
  is_closed: boolean;
  color: string | null;
}

interface Task {
  task_id: string;
  phase_id: string;
  project_status_mapping_id: string;
  task_name?: string;
  description?: string;
  due_date?: Date | null;
  status_name?: string;
  custom_name?: string;
  assigned_to_name?: string;
  estimated_hours?: number | null;
  actual_hours?: number | null;
  is_closed?: boolean;
}

const VIEW_MODE_STORAGE_KEY = 'client-portal-project-view-mode';

export default function ProjectDetailView({ project }: ProjectDetailViewProps) {
  const { t, i18n } = useTranslation('clientPortal');
  const dateLocale = getDateFnsLocale(i18n.language);
  const [metrics, setMetrics] = useState<ProjectCompletionMetrics | null>(null);
  const [loading, setLoading] = useState(true);

  // Initialize viewMode from localStorage
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(VIEW_MODE_STORAGE_KEY);
      if (saved === 'kanban' || saved === 'list') {
        return saved;
      }
    }
    return 'kanban';
  });

  // Data states
  const [phases, setPhases] = useState<Phase[]>([]);
  const [statuses, setStatuses] = useState<Status[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedPhaseId, setSelectedPhaseId] = useState<string | null>(null);
  const [dataLoading, setDataLoading] = useState(true);

  // Persist viewMode to localStorage when it changes
  const handleViewModeChange = (newMode: ViewMode) => {
    setViewMode(newMode);
    if (typeof window !== 'undefined') {
      localStorage.setItem(VIEW_MODE_STORAGE_KEY, newMode);
    }
  };

  // Get client portal config with default fallback
  const config = project.client_portal_config ?? DEFAULT_CLIENT_PORTAL_CONFIG;
  const showPhases = config.show_phases ?? false;
  const showTasks = config.show_tasks ?? false;

  // Load project metrics
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

  // Load phases and statuses
  useEffect(() => {
    const fetchData = async () => {
      if (!showPhases && !showTasks) {
        setDataLoading(false);
        return;
      }

      setDataLoading(true);
      try {
        const [phasesResult, statusesResult] = await Promise.all([
          showPhases ? getClientProjectPhases(project.project_id) : null,
          showTasks ? getClientProjectStatuses(project.project_id) : null
        ]);

        if (phasesResult?.phases) {
          setPhases(phasesResult.phases);
          // Auto-select first phase for kanban view
          if (phasesResult.phases.length > 0 && !selectedPhaseId) {
            setSelectedPhaseId(phasesResult.phases[0].phase_id);
          }
        }

        if (statusesResult?.statuses) {
          setStatuses(statusesResult.statuses);
        }
      } catch (error) {
        console.error('Error fetching phases/statuses:', error);
      } finally {
        setDataLoading(false);
      }
    };

    fetchData();
  }, [project.project_id, showPhases, showTasks]);

  // Load tasks based on view mode
  useEffect(() => {
    const fetchTasks = async () => {
      if (!showTasks) return;

      setDataLoading(true);
      try {
        if (viewMode === 'kanban') {
          // Kanban view: filter by selected phase
          const result = await getClientProjectTasksForKanban(project.project_id, selectedPhaseId || undefined);
          if (result?.tasks) {
            setTasks(result.tasks);
          }
        } else {
          // List view: get all tasks
          const result = await getClientProjectTasks(project.project_id);
          if (result?.tasks) {
            setTasks(result.tasks);
          }
          if (result?.phases && phases.length === 0) {
            setPhases(result.phases.map((p: { phase_id: string; phase_name: string }) => ({
              phase_id: p.phase_id,
              phase_name: p.phase_name,
              description: null,
              start_date: null,
              end_date: null
            })));
          }
        }
      } catch (error) {
        console.error('Error fetching tasks:', error);
      } finally {
        setDataLoading(false);
      }
    };

    fetchTasks();
  }, [project.project_id, showTasks, viewMode, selectedPhaseId]);

  // View switcher options
  const viewOptions = useMemo(() => [
    { value: 'kanban' as ViewMode, label: t('projects.kanbanView', 'Kanban'), icon: LayoutGrid },
    { value: 'list' as ViewMode, label: t('projects.listView', 'List'), icon: List }
  ], [t]);

  // Kanban stats
  const kanbanStats = useMemo(() => {
    const completedTasks = tasks.filter(t => t.is_closed).length;
    return {
      total: tasks.length,
      completed: completedTasks
    };
  }, [tasks]);

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
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Project Header Card */}
      <div className="p-6 bg-white rounded-lg shadow">
        <h2 className="text-2xl font-bold mb-2">{project.project_name}</h2>
        <p className="text-gray-600 mb-6">
          {project.description || t('projects.messages.noDescription', 'No description provided')}
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
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
              <div className="flex flex-col mb-1">
                <p className="font-medium">{t('projects.budgetUsed', '{{percent}}% of Budget Used', { percent: Math.round(metrics?.hoursCompletionPercentage || 0) })}</p>
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
                    <p className="text-sm">{t('projects.hoursUsedDetail', '{{spent}} of {{budgeted}} hours used', { spent: (metrics?.spentHours || 0).toFixed(1), budgeted: (metrics?.budgetedHours || 0).toFixed(1) })}</p>
                    <p className="text-sm">{t('projects.hoursRemaining', '{{remaining}} hours remaining', { remaining: (metrics?.remainingHours || 0).toFixed(1) })}</p>
                  </div>
                }
              />
            </div>
          </div>
        </div>

        <div>
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
              <p className="font-medium">{project.status_name ? t(`projects.status.${project.status_name.toLowerCase().replace(/\s+/g, '')}`, project.status_name) : t('projects.status.active', 'Active')}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Tasks Section - with View Switcher */}
      {(showPhases || showTasks) && (
        <div className="bg-white rounded-lg shadow">
          {/* Header with View Switcher */}
          <div className="p-4 border-b border-gray-200">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div className="flex items-center gap-4">
                <h3 className="text-lg font-semibold">
                  {showPhases && showTasks
                    ? t('projects.phasesAndTasks', 'Phases & Tasks')
                    : showPhases
                      ? t('projects.phases.title', 'Project Phases')
                      : t('projects.tasks.title', 'Tasks')}
                </h3>

                {/* Task count for Kanban */}
                {showTasks && viewMode === 'kanban' && (
                  <span className="text-sm text-gray-500">
                    {kanbanStats.completed} / {kanbanStats.total} {t('projects.tasks.title', 'Tasks').toLowerCase()}
                  </span>
                )}
              </div>

              {/* View Switcher */}
              {showTasks && (
                <ViewSwitcher
                  currentView={viewMode}
                  onChange={handleViewModeChange}
                  options={viewOptions}
                />
              )}
            </div>
          </div>

          {/* Content */}
          <div className="p-4">
            {viewMode === 'kanban' ? (
              <ClientKanbanBoard
                phases={phases}
                statuses={statuses}
                tasks={tasks}
                config={config}
                selectedPhaseId={selectedPhaseId}
                onPhaseSelect={setSelectedPhaseId}
                loading={dataLoading}
              />
            ) : (
              <ClientTaskListView
                phases={phases}
                tasks={tasks}
                config={config}
                loading={dataLoading}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
