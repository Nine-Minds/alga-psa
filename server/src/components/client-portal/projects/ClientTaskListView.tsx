'use client';

import React, { useState } from 'react';
import { useTranslation } from 'server/src/lib/i18n/client';
import { format } from 'date-fns';
import { getDateFnsLocale } from 'server/src/lib/utils/dateFnsLocale';
import { IClientPortalConfig } from 'server/src/interfaces/project.interfaces';
import {
  Calendar,
  User,
  ChevronDown,
  ChevronRight,
  CheckSquare
} from 'lucide-react';
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

interface ClientTaskListViewProps {
  phases: Phase[];
  tasks: Task[];
  config: IClientPortalConfig;
  loading?: boolean;
}

// Status badge component with database color
function StatusBadge({ status, color }: { status: string; color?: string | null }) {
  const defaultColor = '#6B7280'; // Gray fallback
  const statusColor = color || defaultColor;

  // Calculate a lighter background color based on the status color
  // For better visibility, we'll use the color with low opacity
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium"
      style={{
        backgroundColor: `${statusColor}20`, // 20 is hex for ~12% opacity
        color: statusColor
      }}
    >
      <div
        className="w-2 h-2 rounded-full flex-shrink-0"
        style={{ backgroundColor: statusColor }}
      />
      {status}
    </span>
  );
}

// Progress bar component
function ProgressBar({ percentage }: { percentage: number }) {
  return (
    <div className="w-full bg-gray-200 rounded-full h-1.5 overflow-hidden">
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
  loading = false
}: ClientTaskListViewProps) {
  const { t, i18n } = useTranslation('clientPortal');
  const dateLocale = getDateFnsLocale(i18n.language);
  const [expandedPhases, setExpandedPhases] = useState<Set<string>>(
    new Set(phases.map(p => p.phase_id))
  );

  const showPhases = config.show_phases ?? false;
  const showTasks = config.show_tasks ?? false;
  const showPhaseCompletion = config.show_phase_completion ?? false;
  const allowUploads = config.allow_document_uploads ?? false;
  const visibleFields = config.visible_task_fields ?? ['task_name', 'due_date', 'status'];

  // Group tasks by phase
  const tasksByPhase = tasks.reduce((acc, task) => {
    if (!acc[task.phase_id]) {
      acc[task.phase_id] = [];
    }
    acc[task.phase_id].push(task);
    return acc;
  }, {} as Record<string, Task[]>);

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

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Spinner size="xs" />
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

  // Build columns based on visible fields
  const columns: Array<{ key: string; label: string; width: string }> = [];
  if (visibleFields.includes('task_name')) columns.push({ key: 'task_name', label: t('projects.fields.name', 'Task'), width: 'flex-1' });
  if (visibleFields.includes('status')) columns.push({ key: 'status', label: t('projects.fields.status', 'Status'), width: 'w-32' });
  if (visibleFields.includes('assigned_to')) columns.push({ key: 'assigned_to', label: t('projects.tasks.assignedTo', 'Assignee'), width: 'w-36' });
  if (visibleFields.includes('due_date')) columns.push({ key: 'due_date', label: t('projects.tasks.dueDate', 'Due Date'), width: 'w-32' });
  if (visibleFields.includes('estimated_hours')) columns.push({ key: 'estimated_hours', label: t('projects.tasks.estimatedHours', 'Est. Hours'), width: 'w-24' });
  if (visibleFields.includes('actual_hours')) columns.push({ key: 'actual_hours', label: t('projects.fields.hoursLogged', 'Logged'), width: 'w-24' });
  if (visibleFields.includes('checklist_progress')) columns.push({ key: 'checklist_progress', label: t('projects.tasks.checklist', 'Checklist'), width: 'w-24' });

  return (
    <div className="space-y-4">
      {/* Table Header - only show when tasks are enabled */}
      {showTasks && (
        <div className="hidden md:flex items-center gap-4 px-4 py-2 bg-gray-100 rounded-lg text-xs font-medium text-gray-600 uppercase tracking-wider">
          <div className="w-6" /> {/* Expand icon space */}
          {columns.map(col => (
            <div key={col.key} className={col.width}>{col.label}</div>
          ))}
          {allowUploads && <div className="w-44">{t('projects.documents.title', 'Docs')}</div>}
        </div>
      )}

      {/* Phase Groups */}
      <div className="space-y-3">
        {phases.map((phase) => {
          const phaseTasks = tasksByPhase[phase.phase_id] || [];
          const isExpanded = expandedPhases.has(phase.phase_id);

          return (
            <div
              key={phase.phase_id}
              className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden"
            >
              {/* Phase Header */}
              <div
                className={showTasks ? "cursor-pointer hover:bg-gray-50 transition-colors" : ""}
                onClick={showTasks ? () => togglePhase(phase.phase_id) : undefined}
              >
                <div className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {/* Only show expand/collapse chevron when tasks are enabled */}
                      {showTasks && (
                        <div className="text-gray-400">
                          {isExpanded ? (
                            <ChevronDown className="w-5 h-5" />
                          ) : (
                            <ChevronRight className="w-5 h-5" />
                          )}
                        </div>
                      )}
                      <div>
                        <div className="flex items-center gap-3">
                          <h4 className="font-semibold text-gray-900">{phase.phase_name}</h4>
                          {/* Only show task count when tasks are enabled */}
                          {showTasks && (
                            <span className="text-sm text-gray-500">
                              ({phaseTasks.length} {phaseTasks.length === 1 ? t('projects.task', 'task') : t('projects.tasks.title', 'tasks').toLowerCase()})
                            </span>
                          )}
                        </div>

                        {/* Phase Description - only if phases are shown */}
                        {showPhases && phase.description && (
                          <p className="text-sm text-gray-600 mt-1">{phase.description}</p>
                        )}

                        {/* Phase Dates - only if phases are shown */}
                        {showPhases && (phase.start_date || phase.end_date) && (
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
                    </div>

                    {/* Phase Completion */}
                    {showPhases && showPhaseCompletion && phase.completion_percentage !== undefined && (
                      <div className="text-right ml-4 min-w-[80px]">
                        <div className="text-lg font-bold text-purple-600">
                          {phase.completion_percentage}%
                        </div>
                        <div className="text-xs text-gray-500">
                          {t('projects.phases.completion', 'Complete')}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Phase Progress Bar */}
                  {showPhases && showPhaseCompletion && phase.completion_percentage !== undefined && (
                    <div className="mt-3">
                      <ProgressBar percentage={phase.completion_percentage} />
                    </div>
                  )}
                </div>
              </div>

              {/* Tasks Table - only show when tasks are enabled */}
              {showTasks && isExpanded && phaseTasks.length > 0 && (
                <div className="border-t border-gray-200">
                  {phaseTasks.map((task, index) => (
                    <div
                      key={task.task_id}
                      className={`flex flex-col md:flex-row md:items-center gap-2 md:gap-4 p-4 ${
                        index !== phaseTasks.length - 1 ? 'border-b border-gray-100' : ''
                      } hover:bg-gray-50/50`}
                    >
                      <div className="w-6 hidden md:block" /> {/* Indent space */}

                      {/* Task Name */}
                      {visibleFields.includes('task_name') && (
                        <div className="flex-1 min-w-0">
                          <span className="font-medium text-gray-900">{task.task_name}</span>
                          {visibleFields.includes('description') && task.description && (
                            <p className="text-xs text-gray-500 mt-0.5 line-clamp-1">{task.description}</p>
                          )}
                        </div>
                      )}

                      {/* Status */}
                      {visibleFields.includes('status') && task.status_name && (
                        <div className="w-32 flex-shrink-0">
                          <StatusBadge status={task.status_name} color={task.status_color} />
                        </div>
                      )}

                      {/* Assigned To */}
                      {visibleFields.includes('assigned_to') && (
                        <div className="w-36 flex-shrink-0 text-sm text-gray-600">
                          {task.assigned_to_name && (
                            <span className="flex items-center gap-1">
                              <User className="w-3.5 h-3.5 text-gray-400 md:hidden" />
                              {task.assigned_to_name}
                              {task.additional_agents && task.additional_agents.length > 0 && (
                                <span className="text-xs text-purple-600 font-medium">
                                  +{task.additional_agents.length}
                                </span>
                              )}
                            </span>
                          )}
                        </div>
                      )}

                      {/* Due Date */}
                      {visibleFields.includes('due_date') && (
                        <div className="w-32 flex-shrink-0 text-sm text-gray-600">
                          {task.due_date && (
                            <span className="flex items-center gap-1">
                              <Calendar className="w-3.5 h-3.5 text-gray-400 md:hidden" />
                              {format(new Date(task.due_date), 'PP', { locale: dateLocale })}
                            </span>
                          )}
                        </div>
                      )}

                      {/* Estimated Hours */}
                      {visibleFields.includes('estimated_hours') && (
                        <div className="w-24 flex-shrink-0 text-sm text-gray-600">
                          {task.estimated_hours != null && `${(task.estimated_hours / 60).toFixed(1)}h`}
                        </div>
                      )}

                      {/* Actual Hours */}
                      {visibleFields.includes('actual_hours') && (
                        <div className="w-24 flex-shrink-0 text-sm text-gray-600">
                          {task.actual_hours != null && `${(task.actual_hours / 60).toFixed(1)}h`}
                        </div>
                      )}

                      {/* Checklist Progress */}
                      {visibleFields.includes('checklist_progress') && (
                        <div className="w-24 flex-shrink-0 text-sm text-gray-600">
                          {task.checklist_total != null && task.checklist_total > 0 && (
                            <span className="flex items-center gap-1">
                              <CheckSquare className="w-3.5 h-3.5 text-gray-400 md:hidden" />
                              {task.checklist_completed ?? 0}/{task.checklist_total}
                            </span>
                          )}
                        </div>
                      )}

                      {/* Document Upload */}
                      {allowUploads && (
                        <div className="w-44 flex-shrink-0">
                          <TaskDocumentUpload taskId={task.task_id} compact />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Empty state for phase - only show when tasks are enabled */}
              {showTasks && isExpanded && phaseTasks.length === 0 && (
                <div className="border-t border-gray-200 p-4 text-center text-sm text-gray-400">
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
