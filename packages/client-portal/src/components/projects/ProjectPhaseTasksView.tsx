'use client';

import React, { useEffect, useState } from 'react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import {
  getClientProjectPhases,
  getClientProjectTasks
} from '@alga-psa/client-portal/actions';
import { format } from 'date-fns';
import { getDateFnsLocale } from '@alga-psa/ui';
import TaskDocumentUpload from './TaskDocumentUpload';
import { IClientPortalConfig, DEFAULT_CLIENT_PORTAL_CONFIG } from '@alga-psa/types';
import { ChevronRight, ChevronDown, Calendar, Clock, User, CheckCircle2, Circle, AlertCircle } from 'lucide-react';

interface Phase {
  phase_id: string;
  phase_name: string;
  description: string | null;
  start_date: Date | null;
  end_date: Date | null;
  completion_percentage?: number;
}

interface AdditionalAgent {
  user_id: string;
  user_name: string;
  role: string | null;
}

interface Task {
  task_id: string;
  phase_id: string;
  task_name?: string;
  description?: string;
  due_date?: Date | null;
  status_name?: string;
  assigned_to_name?: string;
  additional_agents?: AdditionalAgent[];
  estimated_hours?: number | null;
  actual_hours?: number | null;
  priority_id?: string | null;
  service_name?: string;
  checklist_total?: number;
  checklist_completed?: number;
}

interface ProjectPhaseTasksViewProps {
  projectId: string;
  config: IClientPortalConfig;
}

// Status badge component with colors
function StatusBadge({ status }: { status: string }) {
  const normalizedStatus = status?.toLowerCase() || '';

  let bgColor = 'bg-gray-100';
  let textColor = 'text-gray-700';
  let Icon = Circle;

  if (normalizedStatus.includes('complete') || normalizedStatus.includes('done') || normalizedStatus.includes('closed')) {
    bgColor = 'bg-green-100';
    textColor = 'text-green-700';
    Icon = CheckCircle2;
  } else if (normalizedStatus.includes('progress') || normalizedStatus.includes('active') || normalizedStatus.includes('working')) {
    bgColor = 'bg-blue-100';
    textColor = 'text-blue-700';
    Icon = Clock;
  } else if (normalizedStatus.includes('blocked') || normalizedStatus.includes('hold') || normalizedStatus.includes('waiting')) {
    bgColor = 'bg-amber-100';
    textColor = 'text-amber-700';
    Icon = AlertCircle;
  } else if (normalizedStatus.includes('new') || normalizedStatus.includes('open') || normalizedStatus.includes('todo')) {
    bgColor = 'bg-purple-100';
    textColor = 'text-purple-700';
    Icon = Circle;
  }

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${bgColor} ${textColor}`}>
      <Icon className="w-3 h-3" />
      {status}
    </span>
  );
}

// Progress bar component
function ProgressBar({ percentage, size = 'md' }: { percentage: number; size?: 'sm' | 'md' }) {
  const height = size === 'sm' ? 'h-1.5' : 'h-2';
  return (
    <div className={`w-full bg-gray-200 rounded-full ${height} overflow-hidden`}>
      <div
        className={`bg-purple-600 ${height} rounded-full transition-all duration-300`}
        style={{ width: `${Math.min(percentage, 100)}%` }}
      />
    </div>
  );
}

export default function ProjectPhaseTasksView({ projectId, config }: ProjectPhaseTasksViewProps) {
  const { t, i18n } = useTranslation('clientPortal');
  const dateLocale = getDateFnsLocale(i18n.language);

  const [phases, setPhases] = useState<Phase[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedPhases, setExpandedPhases] = useState<Set<string>>(new Set());

  const showPhases = config.show_phases ?? false;
  const showTasks = config.show_tasks ?? false;
  const showPhaseCompletion = config.show_phase_completion ?? false;
  const visibleFields = config.visible_task_fields ?? ['task_name', 'due_date', 'status'];
  const showServices = visibleFields.includes('services');
  const allowUploads = visibleFields.includes('document_uploads');

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      setError(null);

      try {
        const results = await Promise.all([
          showPhases ? getClientProjectPhases(projectId) : null,
          showTasks ? getClientProjectTasks(projectId) : null
        ]);

        const [phasesResult, tasksResult] = results;

        if (phasesResult?.phases) {
          setPhases(phasesResult.phases);
          // Auto-expand all phases
          setExpandedPhases(new Set(phasesResult.phases.map((p: Phase) => p.phase_id)));
        }

        if (tasksResult?.tasks && tasksResult?.phases) {
          setTasks(tasksResult.tasks);
          // If we don't have phases from phasesResult, use the ones from tasksResult
          if (!phasesResult?.phases) {
            const taskPhases = tasksResult.phases.map((p: { phase_id: string; phase_name: string }) => ({
              phase_id: p.phase_id,
              phase_name: p.phase_name,
              description: null,
              start_date: null,
              end_date: null
            }));
            setPhases(taskPhases);
            setExpandedPhases(new Set(taskPhases.map((p: Phase) => p.phase_id)));
          }
        }
      } catch (err) {
        console.error('Error fetching project data:', err);
        setError(t('projects.messages.loadError', 'Failed to load project details'));
      } finally {
        setLoading(false);
      }
    };

    if (showPhases || showTasks) {
      fetchData();
    } else {
      setLoading(false);
    }
  }, [projectId, showPhases, showTasks]);

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

  // Group tasks by phase
  const tasksByPhase = tasks.reduce((acc, task) => {
    if (!acc[task.phase_id]) {
      acc[task.phase_id] = [];
    }
    acc[task.phase_id].push(task);
    return acc;
  }, {} as Record<string, Task[]>);

  if (!showPhases && !showTasks) {
    return null;
  }

  if (loading) {
    return (
      <div className="bg-gray-50 rounded-lg p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-5 bg-gray-200 rounded w-1/3"></div>
          <div className="space-y-3">
            <div className="h-16 bg-gray-200 rounded"></div>
            <div className="h-16 bg-gray-200 rounded"></div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4">
        <p className="text-red-600 text-sm">{error}</p>
      </div>
    );
  }

  if (phases.length === 0 && tasks.length === 0) {
    return (
      <div className="bg-gray-50 rounded-lg p-6 text-center">
        <p className="text-gray-500">
          {showPhases && showTasks
            ? t('projects.messages.noPhasesOrTasks', 'No phases or tasks to display')
            : showPhases
              ? t('projects.phases.noPhases', 'No phases to display')
              : t('projects.tasks.noTasks', 'No tasks to display')}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">
        {showPhases && showTasks
          ? t('projects.phasesAndTasks', 'Phases & Tasks')
          : showPhases
            ? t('projects.phases.title', 'Project Phases')
            : t('projects.tasks.title', 'Tasks')}
      </h3>

      <div className="space-y-3">
        {phases.map((phase) => {
          const phaseTasks = tasksByPhase[phase.phase_id] || [];
          const isExpanded = expandedPhases.has(phase.phase_id);
          const hasContent = showTasks ? phaseTasks.length > 0 : true;

          // Skip phases with no tasks if we're only showing tasks
          if (!showPhases && phaseTasks.length === 0) return null;

          return (
            <div
              key={phase.phase_id}
              className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden"
            >
              {/* Phase Header */}
              <div
                className={`${showTasks && phaseTasks.length > 0 ? 'cursor-pointer hover:bg-gray-50' : ''} transition-colors`}
                onClick={() => showTasks && phaseTasks.length > 0 && togglePhase(phase.phase_id)}
              >
                <div className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-3 flex-1">
                      {/* Expand/Collapse Icon - only show if there are tasks to show */}
                      {showTasks && phaseTasks.length > 0 && (
                        <div className="mt-0.5 text-gray-400">
                          {isExpanded ? (
                            <ChevronDown className="w-5 h-5" />
                          ) : (
                            <ChevronRight className="w-5 h-5" />
                          )}
                        </div>
                      )}

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-3">
                          <h4 className="font-semibold text-gray-900">{phase.phase_name}</h4>
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

                    {/* Phase Completion - only if showPhaseCompletion is enabled */}
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

                  {/* Phase Progress Bar - only if showPhaseCompletion is enabled */}
                  {showPhases && showPhaseCompletion && phase.completion_percentage !== undefined && (
                    <div className="mt-3">
                      <ProgressBar percentage={phase.completion_percentage} />
                    </div>
                  )}
                </div>
              </div>

              {/* Tasks List - only if showTasks is enabled and phase is expanded */}
              {showTasks && isExpanded && phaseTasks.length > 0 && (
                <div className="border-t border-gray-200 divide-y divide-gray-100">
                  {phaseTasks.map((task) => (
                    <div key={task.task_id} className="p-4 bg-gray-50/50">
                      <div className="space-y-2">
                        {/* Task Header: Name + Status */}
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            {visibleFields.includes('task_name') && task.task_name && (
                              <h5 className="font-medium text-gray-900">{task.task_name}</h5>
                            )}
                            {visibleFields.includes('description') && task.description && (
                              <p className="text-sm text-gray-600 mt-1">{task.description}</p>
                            )}
                          </div>

                          {/* Status Badge */}
                          {visibleFields.includes('status') && task.status_name && (
                            <StatusBadge status={task.status_name} />
                          )}
                        </div>

                        {/* Task Details */}
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-600">
                          {/* Due Date */}
                          {visibleFields.includes('due_date') && task.due_date && (
                            <span className="flex items-center gap-1">
                              <Calendar className="w-3.5 h-3.5 text-gray-400" />
                              {format(new Date(task.due_date), 'PP', { locale: dateLocale })}
                            </span>
                          )}

                          {/* Assigned To (primary + additional agents) */}
                          {visibleFields.includes('assigned_to') && (task.assigned_to_name || (task.additional_agents && task.additional_agents.length > 0)) && (
                            <span className="flex items-center gap-1 flex-wrap">
                              <User className="w-3.5 h-3.5 text-gray-400" />
                              {task.assigned_to_name}
                              {task.additional_agents && task.additional_agents.length > 0 && (
                                <>
                                  {task.assigned_to_name && <span className="text-gray-400">,</span>}
                                  {task.additional_agents.map((agent, idx) => (
                                    <span key={agent.user_id}>
                                      {agent.user_name}
                                      {agent.role && <span className="text-gray-400 text-xs">({agent.role})</span>}
                                      {idx < (task.additional_agents?.length ?? 0) - 1 && <span className="text-gray-400">,</span>}
                                    </span>
                                  ))}
                                </>
                              )}
                            </span>
                          )}

                          {/* Hours */}
                          {visibleFields.includes('estimated_hours') && task.estimated_hours != null && (
                            <span className="flex items-center gap-1">
                              <Clock className="w-3.5 h-3.5 text-gray-400" />
                              {t('projects.tasks.estimatedHours', 'Est')}: {task.estimated_hours}h
                            </span>
                          )}

                          {visibleFields.includes('actual_hours') && task.actual_hours != null && (
                            <span className="flex items-center gap-1">
                              <Clock className="w-3.5 h-3.5 text-gray-400" />
                              {t('projects.fields.hoursLogged', 'Logged')}: {task.actual_hours}h
                            </span>
                          )}

                          {/* Service */}
                          {showServices && task.service_name && (
                            <span className="text-gray-500">
                              {t('projects.tasks.services', 'Service')}: {task.service_name}
                            </span>
                          )}

                          {/* Checklist Progress */}
                          {visibleFields.includes('checklist_progress') &&
                           task.checklist_total !== undefined &&
                           task.checklist_total > 0 && (
                            <span className="flex items-center gap-1">
                              <CheckCircle2 className="w-3.5 h-3.5 text-gray-400" />
                              {task.checklist_completed}/{task.checklist_total}
                            </span>
                          )}
                        </div>

                        {/* Document Upload Section - only if allowUploads is enabled */}
                        {allowUploads && (
                          <div className="mt-3 pt-3 border-t border-gray-200">
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
