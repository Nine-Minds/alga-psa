'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { useTranslation } from 'server/src/lib/i18n/client';
import { format } from 'date-fns';
import { getDateFnsLocale } from 'server/src/lib/utils/dateFnsLocale';
import { IClientPortalConfig } from 'server/src/interfaces/project.interfaces';
import {
  Calendar,
  ChevronDown,
  ChevronRight,
  Ban,
  GitBranch,
} from 'lucide-react';
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

interface Task {
  task_id: string;
  phase_id: string;
  task_name?: string;
  description?: string;
  due_date?: Date | null;
  status_name?: string;
  status_color?: string | null;
  assigned_to_name?: string;
  estimated_hours?: number | null;
  actual_hours?: number | null;
  additional_agents?: Array<{ user_id: string; user_name: string; role: string | null }>;
  checklist_total?: number;
  checklist_completed?: number;
}

interface StatusGroup {
  status_name: string;
  status_color: string | null;
  tasks: Task[];
}

interface TaskDependency {
  dependency_id: string;
  predecessor_task_id: string;
  successor_task_id: string;
  dependency_type: 'blocks' | 'blocked_by' | 'related_to';
  predecessor_task?: { task_name: string };
  successor_task?: { task_name: string };
}

interface ClientTaskListViewProps {
  phases: Phase[];
  tasks: Task[];
  config: IClientPortalConfig;
  loading?: boolean;
  taskDependencies?: { [taskId: string]: { predecessors: TaskDependency[]; successors: TaskDependency[] } };
}

// Progress bar component
function ProgressBar({ percentage }: { percentage: number }) {
  return (
    <div className="w-full max-w-[200px] bg-gray-200 rounded-full h-1.5 overflow-hidden">
      <div
        className="bg-purple-600 h-1.5 rounded-full transition-all duration-300"
        style={{ width: `${Math.min(percentage, 100)}%` }}
      />
    </div>
  );
}

export default function ClientTaskListView({
  phases,
  tasks,
  config,
  loading = false,
  taskDependencies
}: ClientTaskListViewProps) {
  const { t, i18n } = useTranslation('clientPortal');
  const dateLocale = getDateFnsLocale(i18n.language);
  const [expandedPhases, setExpandedPhases] = useState<Set<string>>(
    new Set(phases.map(p => p.phase_id))
  );
  const [expandedStatuses, setExpandedStatuses] = useState<Set<string>>(new Set());

  const showPhases = config.show_phases ?? false;
  const showTasks = config.show_tasks ?? false;
  const showPhaseCompletion = config.show_phase_completion ?? false;
  const visibleFields = config.visible_task_fields ?? ['task_name', 'due_date', 'status'];
  const allowUploads = visibleFields.includes('document_uploads');
  const showDependencies = visibleFields.includes('dependencies');

  // Group tasks by phase and status
  const phaseGroups = useMemo(() => {
    return phases.map(phase => {
      const phaseTasks = tasks.filter(task => task.phase_id === phase.phase_id);

      // Group by status_name
      const statusMap = new Map<string, StatusGroup>();

      phaseTasks.forEach(task => {
        const statusName = task.status_name || 'Unknown';
        if (!statusMap.has(statusName)) {
          statusMap.set(statusName, {
            status_name: statusName,
            status_color: task.status_color || null,
            tasks: []
          });
        }
        statusMap.get(statusName)!.tasks.push(task);
      });

      return {
        phase,
        statusGroups: Array.from(statusMap.values()),
        totalTasks: phaseTasks.length
      };
    });
  }, [phases, tasks]);

  // Auto-expand statuses that have tasks
  useEffect(() => {
    const statusesWithTasks = new Set<string>();
    phaseGroups.forEach(group => {
      group.statusGroups.forEach(statusGroup => {
        if (statusGroup.tasks.length > 0) {
          const statusKey = `${group.phase.phase_id}:${statusGroup.status_name}`;
          statusesWithTasks.add(statusKey);
        }
      });
    });
    setExpandedStatuses(statusesWithTasks);
  }, [phaseGroups]);

  const togglePhase = (phaseId: string) => {
    setExpandedPhases(prev => {
      const next = new Set(prev);
      if (next.has(phaseId)) {
        next.delete(phaseId);
      } else {
        next.add(phaseId);
      }
      return next;
    });
  };

  const toggleStatus = (phaseId: string, statusName: string) => {
    const key = `${phaseId}:${statusName}`;
    setExpandedStatuses(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Spinner size="lg" />
      </div>
    );
  }

  if (phases.length === 0 && tasks.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500">
        {showTasks
          ? t('projects.tasks.noTasks', 'No tasks to display')
          : t('projects.phases.noPhases', 'No phases to display')}
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
      {/* Column headers */}
      {showTasks && (
        <table className="min-w-full">
          <thead className="bg-white border-b border-gray-200">
            <tr>
              {/* Expand icon space */}
              <th className="w-10 px-3 py-3" />
              {visibleFields.includes('task_name') && (
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500">
                  Task Name
                </th>
              )}
              {visibleFields.includes('assigned_to') && (
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 w-36">
                  Assignee
                </th>
              )}
              {visibleFields.includes('due_date') && (
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 w-32">
                  Due Date
                </th>
              )}
              {visibleFields.includes('estimated_hours') && (
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 w-24">
                  Est. Hours
                </th>
              )}
              {visibleFields.includes('actual_hours') && (
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 w-28">
                  Hours Logged
                </th>
              )}
              {visibleFields.includes('checklist_progress') && (
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 w-24">
                  Checklist
                </th>
              )}
              {showDependencies && (
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 w-20">
                  Deps
                </th>
              )}
              {allowUploads && (
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 w-36">
                  Attachments
                </th>
              )}
            </tr>
          </thead>
        </table>
      )}

      {/* Hierarchical rows */}
      <div className="divide-y divide-gray-200">
        {phaseGroups.map(({ phase, statusGroups, totalTasks }) => {
          const isPhaseExpanded = expandedPhases.has(phase.phase_id);

          return (
            <div key={phase.phase_id}>
              {/* Phase header row */}
              <div
                className="bg-white hover:bg-gray-50 cursor-pointer transition-colors"
                onClick={() => togglePhase(phase.phase_id)}
              >
                <div className="px-3 py-3">
                  <div className="flex items-start gap-2">
                    <div className="pt-0.5 text-gray-400">
                      {isPhaseExpanded ? (
                        <ChevronDown className="h-5 w-5" />
                      ) : (
                        <ChevronRight className="h-5 w-5" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-base font-semibold text-gray-900">{phase.phase_name}</span>
                            {showTasks && (
                              <span className="text-sm text-gray-500">
                                ({totalTasks} {totalTasks === 1 ? t('projects.task', 'task') : t('projects.tasks.title', 'tasks').toLowerCase()})
                              </span>
                            )}
                          </div>

                          {/* Phase description - always show if available */}
                          {phase.description && (
                            <p className="text-sm text-gray-500 mt-1">{phase.description}</p>
                          )}

                          {/* Phase dates - always show if available */}
                          {(phase.start_date || phase.end_date) && (
                            <div className="flex items-center gap-4 mt-2 text-sm text-gray-500">
                              {phase.start_date && (
                                <span className="flex items-center gap-1">
                                  <Calendar className="w-3.5 h-3.5" />
                                  {t('projects.startDate', 'Start')}: {format(new Date(phase.start_date), 'PP', { locale: dateLocale })}
                                </span>
                              )}
                              {phase.end_date && (
                                <span className="flex items-center gap-1">
                                  <Calendar className="w-3.5 h-3.5" />
                                  {t('projects.endDate', 'End')}: {format(new Date(phase.end_date), 'PP', { locale: dateLocale })}
                                </span>
                              )}
                            </div>
                          )}
                        </div>

                        {/* Completion percentage */}
                        {showPhaseCompletion && phase.completion_percentage !== undefined && (
                          <div className="flex items-center gap-3 flex-shrink-0">
                            <ProgressBar percentage={phase.completion_percentage} />
                            <div className="text-right min-w-[60px]">
                              <span className="text-lg font-bold text-purple-600">
                                {phase.completion_percentage}%
                              </span>
                              <div className="text-xs text-gray-500">
                                {t('projects.phases.completion', 'Complete')}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Status Groups */}
              {showTasks && isPhaseExpanded && statusGroups.length > 0 && (
                <div className="divide-y divide-gray-100">
                  {statusGroups.map((statusGroup) => {
                    const statusKey = `${phase.phase_id}:${statusGroup.status_name}`;
                    const isStatusExpanded = expandedStatuses.has(statusKey);
                    const statusColor = statusGroup.status_color || '#6B7280';

                    return (
                      <div key={statusGroup.status_name}>
                        {/* Status header row */}
                        <div
                          className="bg-gray-50 hover:bg-gray-100 cursor-pointer transition-colors py-2 px-3"
                          onClick={() => toggleStatus(phase.phase_id, statusGroup.status_name)}
                        >
                          <div className="flex items-center gap-2 pl-6">
                            {isStatusExpanded ? (
                              <ChevronDown className="h-4 w-4 text-gray-400" />
                            ) : (
                              <ChevronRight className="h-4 w-4 text-gray-400" />
                            )}
                            <span
                              className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium"
                              style={{
                                backgroundColor: `${statusColor}20`,
                                color: statusColor,
                                border: `1px solid ${statusColor}40`
                              }}
                            >
                              <span
                                className="w-2 h-2 rounded-full"
                                style={{ backgroundColor: statusColor }}
                              />
                              {statusGroup.status_name}
                            </span>
                            <span className="text-xs text-gray-500">
                              ({statusGroup.tasks.length})
                            </span>
                          </div>
                        </div>

                        {/* Task rows */}
                        {isStatusExpanded && (
                          <table className="min-w-full">
                            <tbody className="divide-y divide-gray-100">
                              {statusGroup.tasks.map((task, index) => (
                                <tr
                                  key={task.task_id}
                                  className={`${index % 2 === 0 ? 'bg-gray-50' : 'bg-white'} hover:bg-blue-50 transition-colors`}
                                >
                                  <td className="w-10 px-3 py-3" /> {/* Indent space */}

                                  {/* Task Name */}
                                  {visibleFields.includes('task_name') && (
                                    <td className="px-6 py-3 text-sm text-gray-700">
                                      <div className="pl-6">
                                        <span className="font-medium text-gray-900">{task.task_name}</span>
                                        {visibleFields.includes('description') && task.description && (
                                          <p className="text-xs text-gray-500 mt-0.5 line-clamp-1">{task.description}</p>
                                        )}
                                      </div>
                                    </td>
                                  )}

                                  {/* Assignee */}
                                  {visibleFields.includes('assigned_to') && (
                                    <td className="px-6 py-3 text-sm text-gray-700 w-36">
                                      {task.assigned_to_name && (
                                        <span className="flex items-center gap-1">
                                          {task.assigned_to_name}
                                          {task.additional_agents && task.additional_agents.length > 0 && (
                                            <span className="text-xs text-purple-600 font-medium">
                                              +{task.additional_agents.length}
                                            </span>
                                          )}
                                        </span>
                                      )}
                                    </td>
                                  )}

                                  {/* Due Date */}
                                  {visibleFields.includes('due_date') && (
                                    <td className="px-6 py-3 text-sm text-gray-700 w-32">
                                      {task.due_date && format(new Date(task.due_date), 'PP', { locale: dateLocale })}
                                    </td>
                                  )}

                                  {/* Estimated Hours */}
                                  {visibleFields.includes('estimated_hours') && (
                                    <td className="px-6 py-3 text-sm text-gray-700 w-24">
                                      {task.estimated_hours != null && (task.estimated_hours / 60).toFixed(1)}
                                    </td>
                                  )}

                                  {/* Actual Hours */}
                                  {visibleFields.includes('actual_hours') && (
                                    <td className="px-6 py-3 text-sm text-gray-700 w-28">
                                      {task.actual_hours != null && (task.actual_hours / 60).toFixed(1)}
                                    </td>
                                  )}

                                  {/* Checklist Progress */}
                                  {visibleFields.includes('checklist_progress') && (
                                    <td className="px-6 py-3 text-sm text-gray-700 w-24">
                                      {task.checklist_total != null && task.checklist_total > 0 && (
                                        <span>{task.checklist_completed ?? 0}/{task.checklist_total}</span>
                                      )}
                                    </td>
                                  )}

                                  {/* Dependencies */}
                                  {showDependencies && (
                                    <td className="px-6 py-3 text-sm text-gray-700 w-20">
                                      {(() => {
                                        const deps = taskDependencies?.[task.task_id];
                                        if (!deps || (deps.predecessors.length === 0 && deps.successors.length === 0)) {
                                          return null;
                                        }
                                        const hasBlockingDeps = deps.predecessors.some(d => d.dependency_type === 'blocks' || d.dependency_type === 'blocked_by') ||
                                                               deps.successors.some(d => d.dependency_type === 'blocks' || d.dependency_type === 'blocked_by');
                                        const count = deps.predecessors.length + deps.successors.length;
                                        return (
                                          <Tooltip
                                            content={
                                              <div className="text-xs space-y-2">
                                                {deps.predecessors.length > 0 && (
                                                  <div>
                                                    <div className="font-medium text-gray-300 mb-1">{t('projects.dependencies.dependsOn', 'Depends on')}:</div>
                                                    {deps.predecessors.map((d, i) => {
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
                                                {deps.successors.length > 0 && (
                                                  <div>
                                                    <div className="font-medium text-gray-300 mb-1">{t('projects.dependencies.blocks', 'Blocks')}:</div>
                                                    {deps.successors.map((d, i) => {
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
                                            <div className={`flex items-center gap-1 ${hasBlockingDeps ? 'text-red-500' : 'text-blue-500'}`}>
                                              {hasBlockingDeps ? <Ban className="w-3.5 h-3.5" /> : <GitBranch className="w-3.5 h-3.5" />}
                                              <span>{count}</span>
                                            </div>
                                          </Tooltip>
                                        );
                                      })()}
                                    </td>
                                  )}

                                  {/* Document Upload */}
                                  {allowUploads && (
                                    <td className="px-6 py-3 text-sm text-gray-700 w-36">
                                      <TaskDocumentUpload taskId={task.task_id} compact />
                                    </td>
                                  )}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Empty state for phase */}
              {showTasks && isPhaseExpanded && totalTasks === 0 && (
                <div className="py-4 text-center text-sm text-gray-400 bg-gray-50">
                  {t('projects.tasks.noTasks', 'No tasks in this phase')}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
