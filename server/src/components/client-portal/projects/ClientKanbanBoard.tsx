'use client';

import React from 'react';
import { useTranslation } from 'server/src/lib/i18n/client';
import { format, Locale } from 'date-fns';
import { getDateFnsLocale } from 'server/src/lib/utils/dateFnsLocale';
import { IClientPortalConfig } from 'server/src/interfaces/project.interfaces';
import { Calendar, Clock, User, FolderOpen, CheckSquare, Ban, GitBranch } from 'lucide-react';
import { Tooltip } from 'server/src/components/ui/Tooltip';
import TaskDocumentUpload from './TaskDocumentUpload';
import Spinner from 'server/src/components/ui/Spinner';

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

interface TaskDependency {
  dependency_id: string;
  predecessor_task_id: string;
  successor_task_id: string;
  dependency_type: 'blocks' | 'blocked_by' | 'related_to';
  predecessor_task?: { task_name: string };
  successor_task?: { task_name: string };
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
  additional_agents?: Array<{ user_id: string; user_name: string; role: string | null }>;
  checklist_total?: number;
  checklist_completed?: number;
}

interface ClientKanbanBoardProps {
  phases: Phase[];
  statuses: Status[];
  tasks: Task[];
  config: IClientPortalConfig;
  selectedPhaseId: string | null;
  onPhaseSelect: (phaseId: string) => void;
  loading?: boolean;
  taskDependencies?: { [taskId: string]: { predecessors: TaskDependency[]; successors: TaskDependency[] } };
}

// Lighten a hex color by a given amount (0-1)
function lightenColor(hex: string, amount: number): string {
  // Remove # if present
  const color = hex.replace('#', '');

  // Parse RGB values
  const r = parseInt(color.substring(0, 2), 16);
  const g = parseInt(color.substring(2, 4), 16);
  const b = parseInt(color.substring(4, 6), 16);

  // Lighten each component
  const newR = Math.round(r + (255 - r) * amount);
  const newG = Math.round(g + (255 - g) * amount);
  const newB = Math.round(b + (255 - b) * amount);

  // Convert back to hex
  return `#${((newR << 16) | (newG << 8) | newB).toString(16).padStart(6, '0')}`;
}

// Task card component
function TaskCard({
  task,
  config,
  dateLocale,
  dependencies
}: {
  task: Task;
  config: IClientPortalConfig;
  dateLocale: Locale;
  dependencies?: { predecessors: TaskDependency[]; successors: TaskDependency[] };
}) {
  const { t } = useTranslation('clientPortal');
  const visibleFields = config.visible_task_fields ?? ['task_name', 'due_date', 'status'];
  const allowUploads = visibleFields.includes('document_uploads');
  const showDependencies = visibleFields.includes('dependencies');

  const hasDependencies = dependencies && (dependencies.predecessors.length > 0 || dependencies.successors.length > 0);
  const hasBlockingDeps = dependencies && (
    dependencies.predecessors.some(d => d.dependency_type === 'blocks' || d.dependency_type === 'blocked_by') ||
    dependencies.successors.some(d => d.dependency_type === 'blocks' || d.dependency_type === 'blocked_by')
  );

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-3 shadow-sm hover:shadow-md transition-shadow">
      {/* Task Name */}
      {visibleFields.includes('task_name') && task.task_name && (
        <h4 className="font-medium text-gray-900 text-sm mb-2">{task.task_name}</h4>
      )}

      {/* Task Description */}
      {visibleFields.includes('description') && task.description && (
        <p className="text-xs text-gray-600 mb-2 line-clamp-2">{task.description}</p>
      )}

      {/* Task Details */}
      <div className="space-y-1.5 text-xs text-gray-600">
        {/* Due Date row with badges inline */}
        {(visibleFields.includes('due_date') || visibleFields.includes('checklist_progress') || showDependencies) && (
          <div className="flex items-center justify-between gap-2">
            {/* Left side: Due Date */}
            {visibleFields.includes('due_date') && task.due_date ? (
              <div className="flex items-center gap-1.5">
                <Calendar className="w-3 h-3 text-gray-400" />
                <span>{format(new Date(task.due_date), 'PP', { locale: dateLocale })}</span>
              </div>
            ) : (
              <div />
            )}

            {/* Right side: Badges */}
            <div className="flex items-center gap-1.5">
              {/* Checklist Progress Badge */}
              {visibleFields.includes('checklist_progress') && task.checklist_total != null && task.checklist_total > 0 && (
                <div className={`flex items-center gap-1 px-1.5 py-0.5 rounded ${
                  (task.checklist_completed ?? 0) === task.checklist_total ? 'bg-green-50 text-green-600' : 'bg-gray-50 text-gray-500'
                }`}>
                  <CheckSquare className="w-3 h-3" />
                  <span>{task.checklist_completed ?? 0}/{task.checklist_total}</span>
                </div>
              )}

              {/* Dependencies Badge */}
              {showDependencies && hasDependencies && (
                <Tooltip
                  content={
                    <div className="text-xs space-y-2">
                      {dependencies!.predecessors.length > 0 && (
                        <div>
                          <div className="font-medium text-gray-300 mb-1">{t('projects.dependencies.dependsOn', 'Depends on')}:</div>
                          {dependencies!.predecessors.map((d, i) => {
                            const isBlocking = d.dependency_type === 'blocks' || d.dependency_type === 'blocked_by';
                            return (
                              <div key={i} className="flex items-center gap-1.5 ml-2">
                                <span className={isBlocking ? 'text-orange-400' : 'text-blue-400'}>
                                  {isBlocking ? <Ban className="h-3 w-3" /> : <GitBranch className="h-3 w-3" />}
                                </span>
                                <span>{d.predecessor_task?.task_name || t('projects.dependencies.unknownTask', 'Unknown task')}</span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                      {dependencies!.successors.length > 0 && (
                        <div>
                          <div className="font-medium text-gray-300 mb-1">{t('projects.dependencies.blocks', 'Blocks')}:</div>
                          {dependencies!.successors.map((d, i) => {
                            const isBlocking = d.dependency_type === 'blocks' || d.dependency_type === 'blocked_by';
                            return (
                              <div key={i} className="flex items-center gap-1.5 ml-2">
                                <span className={isBlocking ? 'text-red-400' : 'text-blue-400'}>
                                  {isBlocking ? <Ban className="h-3 w-3" /> : <GitBranch className="h-3 w-3" />}
                                </span>
                                <span>{d.successor_task?.task_name || t('projects.dependencies.unknownTask', 'Unknown task')}</span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  }
                >
                  <div className={`flex items-center gap-1 px-1.5 py-0.5 rounded ${
                    hasBlockingDeps ? 'bg-red-50 text-red-500' : 'bg-blue-50 text-blue-500'
                  }`}>
                    {hasBlockingDeps ? <Ban className="w-3 h-3" /> : <GitBranch className="w-3 h-3" />}
                    <span>{dependencies!.predecessors.length + dependencies!.successors.length}</span>
                  </div>
                </Tooltip>
              )}
            </div>
          </div>
        )}

        {/* Assigned To */}
        {visibleFields.includes('assigned_to') && task.assigned_to_name && (
          <div className="flex items-center gap-1.5">
            <User className="w-3 h-3 text-gray-400" />
            <span>{task.assigned_to_name}</span>
            {task.additional_agents && task.additional_agents.length > 0 && (
              <span className="text-xs text-purple-600 font-medium">
                +{task.additional_agents.length}
              </span>
            )}
          </div>
        )}

        {/* Estimated Hours */}
        {visibleFields.includes('estimated_hours') && task.estimated_hours != null && (
          <div className="flex items-center gap-1.5">
            <Clock className="w-3 h-3 text-gray-400" />
            <span>{t('projects.tasks.estimatedHours', 'Est')}: {(task.estimated_hours / 60).toFixed(1)}</span>
          </div>
        )}

        {/* Actual Hours (Hours Logged) */}
        {visibleFields.includes('actual_hours') && task.actual_hours != null && (
          <div className="flex items-center gap-1.5">
            <Clock className="w-3 h-3 text-gray-400" />
            <span>{t('projects.fields.hoursLogged', 'Logged')}: {(task.actual_hours / 60).toFixed(1)}</span>
          </div>
        )}
      </div>

      {/* Document Upload Section */}
      {allowUploads && (
        <div className="mt-3 pt-2 border-t border-gray-100">
          <TaskDocumentUpload taskId={task.task_id} compact />
        </div>
      )}
    </div>
  );
}

// Phase card component for left pane
function PhaseCard({
  phase,
  isSelected,
  taskCount,
  onClick,
  showCompletion,
  dateLocale
}: {
  phase: Phase;
  isSelected: boolean;
  taskCount: number;
  onClick: () => void;
  showCompletion: boolean;
  dateLocale: Locale;
}) {
  const { t } = useTranslation('clientPortal');

  return (
    <div
      onClick={onClick}
      className={`p-3 rounded-lg cursor-pointer transition-all ${
        isSelected
          ? 'bg-purple-50'
          : 'hover:bg-gray-50'
      }`}
    >
      <div className="flex flex-col gap-1">
        {/* Phase name and task count */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-sm font-semibold ${isSelected ? 'text-purple-900' : 'text-gray-900'}`}>
            {phase.phase_name}
          </span>
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-700">
            {taskCount} {taskCount === 1 ? t('projects.task', 'task') : t('projects.tasks.title', 'tasks').toLowerCase()}
          </span>
          {showCompletion && phase.completion_percentage !== undefined && (
            <span className={`text-xs font-medium ${isSelected ? 'text-purple-600' : 'text-gray-500'}`}>
              {phase.completion_percentage}%
            </span>
          )}
        </div>

        {/* Phase dates */}
        {(phase.start_date || phase.end_date) && (
          <div className="flex items-center gap-1 text-xs text-gray-500">
            <Calendar className="w-3 h-3" />
            {phase.start_date && format(new Date(phase.start_date), 'MMM d', { locale: dateLocale })}
            {phase.start_date && phase.end_date && ' - '}
            {phase.end_date && format(new Date(phase.end_date), 'MMM d, yyyy', { locale: dateLocale })}
          </div>
        )}

        {/* Phase description */}
        {phase.description && (
          <p className="text-xs text-gray-500 line-clamp-2">
            {phase.description}
          </p>
        )}
      </div>
    </div>
  );
}

export default function ClientKanbanBoard({
  phases,
  statuses,
  tasks,
  config,
  selectedPhaseId,
  onPhaseSelect,
  loading = false,
  taskDependencies
}: ClientKanbanBoardProps) {
  const { t, i18n } = useTranslation('clientPortal');
  const dateLocale = getDateFnsLocale(i18n.language);
  const showPhases = config.show_phases ?? false;
  const showPhaseCompletion = config.show_phase_completion ?? false;

  // Group tasks by status
  const tasksByStatus = tasks.reduce((acc, task) => {
    const statusId = task.project_status_mapping_id;
    if (!acc[statusId]) {
      acc[statusId] = [];
    }
    acc[statusId].push(task);
    return acc;
  }, {} as Record<string, Task[]>);

  // Get task counts per phase
  const getPhaseTaskCounts = (phaseId: string) => {
    const phaseTasks = tasks.filter(t => t.phase_id === phaseId);
    return {
      total: phaseTasks.length,
      completed: phaseTasks.filter(t => t.is_closed).length
    };
  };

  // Default fallback colors for columns without configured colors
  const fallbackColors = ['#6B7280', '#6366F1', '#10B981', '#F59E0B', '#EF4444'];

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Spinner size="lg" />
      </div>
    );
  }

  if (statuses.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500">
        {t('projects.tasks.noTasks', 'No tasks to display')}
      </div>
    );
  }

  return (
    <div className="flex gap-4">
      {/* Left Pane - Phase Cards */}
      {showPhases && phases.length > 0 && (
        <div className="w-56 flex-shrink-0 space-y-2">
          <h4 className="text-xs font-medium text-gray-500 uppercase tracking-wider px-1 mb-3">
            {t('projects.phases.title', 'Phases')}
          </h4>
          {phases.map((phase) => {
            const counts = getPhaseTaskCounts(phase.phase_id);
            return (
              <PhaseCard
                key={phase.phase_id}
                phase={phase}
                isSelected={selectedPhaseId === phase.phase_id}
                taskCount={counts.total}
                onClick={() => onPhaseSelect(phase.phase_id)}
                showCompletion={showPhaseCompletion}
                dateLocale={dateLocale}
              />
            );
          })}
        </div>
      )}

      {/* Right Pane - Kanban Columns */}
      <div className="flex-1 flex gap-4 overflow-x-auto pb-4">
        {statuses.map((status, index) => {
          const statusTasks = tasksByStatus[status.project_status_mapping_id] || [];
          const statusColor = status.color || fallbackColors[index % fallbackColors.length];

          return (
            <div
              key={status.project_status_mapping_id}
              className="flex-shrink-0 w-72 rounded-lg border-2"
              style={{
                backgroundColor: lightenColor(statusColor, 0.90),
                borderColor: lightenColor(statusColor, 0.70)
              }}
            >
              {/* Column Header */}
              <div className="p-3">
                <div className="flex items-center justify-between">
                  <div
                    className="flex items-center gap-2 px-3 py-1.5 rounded-2xl border-2"
                    style={{
                      backgroundColor: lightenColor(statusColor, 0.75),
                      borderColor: lightenColor(statusColor, 0.50)
                    }}
                  >
                    <div
                      className="w-2.5 h-2.5 rounded-full"
                      style={{ backgroundColor: statusColor }}
                    />
                    <h3 className="font-medium text-gray-900 text-sm">{status.name}</h3>
                  </div>
                  <span
                    className="text-xs font-medium px-2 py-0.5 rounded-full"
                    style={{
                      backgroundColor: lightenColor(statusColor, 0.70),
                      color: statusColor
                    }}
                  >
                    {statusTasks.length}
                  </span>
                </div>
              </div>

              {/* Tasks */}
              <div className="px-2 pb-2 space-y-2 max-h-[calc(100vh-400px)] overflow-y-auto">
                {statusTasks.length === 0 ? (
                  <div className="text-center py-4 text-xs text-gray-400">
                    {t('projects.tasks.noTasks', 'No tasks')}
                  </div>
                ) : (
                  statusTasks.map((task) => (
                    <TaskCard
                      key={task.task_id}
                      task={task}
                      config={config}
                      dateLocale={dateLocale}
                      dependencies={taskDependencies?.[task.task_id]}
                    />
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
