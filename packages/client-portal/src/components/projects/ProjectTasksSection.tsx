'use client';

import React, { useEffect, useState } from 'react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { getClientProjectTasks } from 'server/src/lib/actions/client-portal-actions/client-project-details';
import { format } from 'date-fns';
import { getDateFnsLocale } from 'server/src/lib/utils/dateFnsLocale';
import TaskDocumentUpload from './TaskDocumentUpload';
import { IClientPortalConfig } from 'server/src/interfaces/project.interfaces';

interface Task {
  task_id: string;
  phase_id: string;
  task_name?: string;
  description?: string;
  due_date?: Date | null;
  status_name?: string;
  assigned_to_name?: string;
  estimated_hours?: number | null;
  actual_hours?: number | null;
  priority_id?: string | null;
  service_name?: string;
  checklist_total?: number;
  checklist_completed?: number;
}

interface Phase {
  phase_id: string;
  phase_name: string;
}

interface ProjectTasksSectionProps {
  projectId: string;
  visibleFields: string[];
  showServices: boolean;
  allowUploads: boolean;
}

export default function ProjectTasksSection({
  projectId,
  visibleFields,
  showServices,
  allowUploads
}: ProjectTasksSectionProps) {
  const { t, i18n } = useTranslation('clientPortal');
  const dateLocale = getDateFnsLocale(i18n.language);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [phases, setPhases] = useState<Phase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedPhases, setExpandedPhases] = useState<Set<string>>(new Set());

  useEffect(() => {
    const fetchTasks = async () => {
      try {
        const result = await getClientProjectTasks(projectId);
        if (result?.tasks && result?.phases) {
          setTasks(result.tasks);
          setPhases(result.phases);
          // Auto-expand all phases by default
          setExpandedPhases(new Set(result.phases.map((p: Phase) => p.phase_id)));
        }
      } catch (err) {
        console.error('Error fetching project tasks:', err);
        setError('Failed to load project tasks');
      } finally {
        setLoading(false);
      }
    };

    fetchTasks();
  }, [projectId]);

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
      <div className="bg-gray-50 p-4 rounded-lg">
        <div className="animate-pulse">
          <div className="h-5 bg-gray-200 rounded w-1/4 mb-4"></div>
          <div className="space-y-2">
            <div className="h-12 bg-gray-200 rounded"></div>
            <div className="h-12 bg-gray-200 rounded"></div>
            <div className="h-12 bg-gray-200 rounded"></div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 p-4 rounded-lg">
        <p className="text-red-600 text-sm">{error}</p>
      </div>
    );
  }

  if (tasks.length === 0) {
    return (
      <div className="bg-gray-50 p-4 rounded-lg">
        <h3 className="text-lg font-semibold mb-2">{t('projects.tasks.title', 'Tasks')}</h3>
        <p className="text-gray-600 text-sm">{t('projects.tasks.noTasks', 'No tasks to display')}</p>
      </div>
    );
  }

  // Group tasks by phase
  const tasksByPhase = tasks.reduce((acc, task) => {
    if (!acc[task.phase_id]) {
      acc[task.phase_id] = [];
    }
    acc[task.phase_id].push(task);
    return acc;
  }, {} as Record<string, Task[]>);

  return (
    <div className="bg-gray-50 p-4 rounded-lg mb-6">
      <h3 className="text-lg font-semibold mb-4">{t('projects.tasks.title', 'Tasks')}</h3>
      <div className="space-y-3">
        {phases.map((phase) => {
          const phaseTasks = tasksByPhase[phase.phase_id] || [];
          if (phaseTasks.length === 0) return null;

          const isExpanded = expandedPhases.has(phase.phase_id);

          return (
            <div key={phase.phase_id} className="bg-white rounded-lg border border-gray-200">
              {/* Phase Header */}
              <button
                onClick={() => togglePhase(phase.phase_id)}
                className="w-full flex items-center justify-between p-3 hover:bg-gray-50 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <svg
                    className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                  <span className="font-medium text-gray-900">{phase.phase_name}</span>
                  <span className="text-sm text-gray-500">({phaseTasks.length})</span>
                </div>
              </button>

              {/* Tasks List */}
              {isExpanded && (
                <div className="border-t border-gray-200">
                  {phaseTasks.map((task) => (
                    <div key={task.task_id} className="p-4 border-b border-gray-100 last:border-b-0">
                      <div className="space-y-2">
                        {/* Task Name */}
                        {visibleFields.includes('task_name') && task.task_name && (
                          <h4 className="font-medium text-gray-900">{task.task_name}</h4>
                        )}

                        {/* Description */}
                        {visibleFields.includes('description') && task.description && (
                          <p className="text-sm text-gray-600">{task.description}</p>
                        )}

                        {/* Task Details Grid */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
                          {/* Status */}
                          {visibleFields.includes('status') && task.status_name && (
                            <div>
                              <span className="font-medium text-gray-700">
                                {t('projects.tasks.status', 'Status')}:
                              </span>{' '}
                              <span className="text-gray-600">{task.status_name}</span>
                            </div>
                          )}

                          {/* Assigned To */}
                          {visibleFields.includes('assigned_to') && task.assigned_to_name && (
                            <div>
                              <span className="font-medium text-gray-700">
                                {t('projects.tasks.assignedTo', 'Assigned To')}:
                              </span>{' '}
                              <span className="text-gray-600">{task.assigned_to_name}</span>
                            </div>
                          )}

                          {/* Due Date */}
                          {visibleFields.includes('due_date') && task.due_date && (
                            <div>
                              <span className="font-medium text-gray-700">
                                {t('projects.tasks.dueDate', 'Due Date')}:
                              </span>{' '}
                              <span className="text-gray-600">
                                {format(new Date(task.due_date), 'PPP', { locale: dateLocale })}
                              </span>
                            </div>
                          )}

                          {/* Estimated Hours */}
                          {visibleFields.includes('estimated_hours') && task.estimated_hours != null && (
                            <div>
                              <span className="font-medium text-gray-700">
                                {t('projects.tasks.estimatedHours', 'Estimated Hours')}:
                              </span>{' '}
                              <span className="text-gray-600">{task.estimated_hours}</span>
                            </div>
                          )}

                          {/* Actual Hours */}
                          {visibleFields.includes('actual_hours') && task.actual_hours != null && (
                            <div>
                              <span className="font-medium text-gray-700">
                                {t('projects.fields.hoursLogged', 'Actual Hours')}:
                              </span>{' '}
                              <span className="text-gray-600">{task.actual_hours}</span>
                            </div>
                          )}

                          {/* Priority */}
                          {visibleFields.includes('priority') && task.priority_id && (
                            <div>
                              <span className="font-medium text-gray-700">
                                {t('projects.tasks.priority', 'Priority')}:
                              </span>{' '}
                              <span className="text-gray-600">{task.priority_id}</span>
                            </div>
                          )}

                          {/* Service */}
                          {showServices && task.service_name && (
                            <div>
                              <span className="font-medium text-gray-700">
                                {t('projects.tasks.services', 'Service')}:
                              </span>{' '}
                              <span className="text-gray-600">{task.service_name}</span>
                            </div>
                          )}

                          {/* Checklist Progress */}
                          {visibleFields.includes('checklist_progress') &&
                           task.checklist_total !== undefined &&
                           task.checklist_total > 0 && (
                            <div>
                              <span className="font-medium text-gray-700">Checklist:</span>{' '}
                              <span className="text-gray-600">
                                {task.checklist_completed}/{task.checklist_total}
                              </span>
                            </div>
                          )}
                        </div>

                        {/* Document Upload Section */}
                        {allowUploads && (
                          <div className="mt-3 pt-3 border-t border-gray-100">
                            <TaskDocumentUpload taskId={task.task_id} />
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
