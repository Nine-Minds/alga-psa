'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { IProjectPhase, IProjectTask, ProjectStatus, IProjectTicketLinkWithDetails, ITaskChecklistItem, IProjectTaskDependency } from 'server/src/interfaces/project.interfaces';
import { ITag } from 'server/src/interfaces/tag.interfaces';
import { ITaskResource } from 'server/src/interfaces/taskResource.interfaces';
import { ChevronDown, ChevronRight, Pencil, Copy, Trash2, Link2, ArrowRight } from 'lucide-react';
import { Tooltip } from 'server/src/components/ui/Tooltip';
import { Button } from 'server/src/components/ui/Button';
import { format } from 'date-fns';
import { TagList } from 'server/src/components/tags';

interface TaskListViewProps {
  projectId: string;
  phases: IProjectPhase[];
  tasks: IProjectTask[];
  statuses: ProjectStatus[];
  ticketLinks: Record<string, IProjectTicketLinkWithDetails[]>;
  taskResources: Record<string, ITaskResource[]>;
  checklistItems: Record<string, ITaskChecklistItem[]>;
  taskTags: Record<string, ITag[]>;
  taskDependencies?: Record<string, { predecessors: IProjectTaskDependency[]; successors: IProjectTaskDependency[] }>;
  onTaskUpdate: () => void;
  onTaskClick: (task: IProjectTask) => void;
  onTaskDelete: (task: IProjectTask) => void;
  onTaskDuplicate: (task: IProjectTask) => void;
  users: any[];
  // Filter props
  selectedPriorityFilter?: string;
  selectedTaskTags?: string[];
}

interface PhaseGroup {
  phase: IProjectPhase;
  statusGroups: { status: ProjectStatus; tasks: IProjectTask[] }[];
  totalTasks: number;
}

export default function TaskListView({
  projectId,
  phases,
  tasks,
  statuses,
  ticketLinks,
  taskResources,
  checklistItems,
  taskTags,
  taskDependencies = {},
  onTaskUpdate,
  onTaskClick,
  onTaskDelete,
  onTaskDuplicate,
  users,
  selectedPriorityFilter = 'all',
  selectedTaskTags = []
}: TaskListViewProps) {
  const [expandedPhases, setExpandedPhases] = useState<Set<string>>(new Set());
  const [expandedStatuses, setExpandedStatuses] = useState<Set<string>>(new Set());

  // Filter tasks based on priority and tags
  const filteredTasks = useMemo(() => {
    let filtered = tasks;

    // Apply priority filter
    if (selectedPriorityFilter !== 'all') {
      filtered = filtered.filter(task => task.priority_id === selectedPriorityFilter);
    }

    // Apply tag filter
    if (selectedTaskTags.length > 0) {
      filtered = filtered.filter(task => {
        const tags = taskTags[task.task_id] || [];
        const tagTexts = tags.map(tag => tag.tag_text);
        return selectedTaskTags.some(selectedTag => tagTexts.includes(selectedTag));
      });
    }

    return filtered;
  }, [tasks, selectedPriorityFilter, selectedTaskTags, taskTags]);

  // Group tasks by phase and status
  const phaseGroups = useMemo((): PhaseGroup[] => {
    const groups: PhaseGroup[] = [];

    phases.forEach(phase => {
      const phaseTasks = filteredTasks.filter(task => task.phase_id === phase.phase_id);

      const statusGroups: { status: ProjectStatus; tasks: IProjectTask[] }[] = [];
      statuses.forEach(status => {
        const statusTasks = phaseTasks.filter(task => task.project_status_mapping_id === status.project_status_mapping_id);
        if (statusTasks.length > 0) {
          statusGroups.push({ status, tasks: statusTasks });
        }
      });

      if (phaseTasks.length > 0) {
        groups.push({
          phase,
          statusGroups,
          totalTasks: phaseTasks.length
        });
      }
    });

    return groups;
  }, [phases, filteredTasks, statuses]);

  // Auto-expand phases and statuses that have tasks
  useEffect(() => {
    const phasesWithTasks = new Set<string>();
    const statusesWithTasks = new Set<string>();

    phaseGroups.forEach(group => {
      if (group.totalTasks > 0) {
        phasesWithTasks.add(group.phase.phase_id);
        group.statusGroups.forEach(statusGroup => {
          const statusKey = `${group.phase.phase_id}:${statusGroup.status.project_status_mapping_id}`;
          statusesWithTasks.add(statusKey);
        });
      }
    });

    setExpandedPhases(phasesWithTasks);
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

  const toggleStatus = (phaseId: string, statusId: string) => {
    const key = `${phaseId}:${statusId}`;
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

  const getAssigneeName = (userId: string | null) => {
    if (!userId) return 'Unassigned';
    const user = users.find(u => u.user_id === userId);
    return user ? `${user.first_name} ${user.last_name}` : 'Unknown';
  };

  // Helper to get dependency type label
  const getDependencyTypeLabel = (type: string): string => {
    switch (type) {
      case 'blocks': return 'Blocks';
      case 'blocked_by': return 'Blocked by';
      case 'related_to': return 'Related to';
      default: return type;
    }
  };

  // Render dependencies tooltip content
  const renderDependenciesTooltip = (taskId: string): string | null => {
    const deps = taskDependencies[taskId];
    if (!deps || (deps.predecessors.length === 0 && deps.successors.length === 0)) {
      return null;
    }

    const lines: string[] = [];

    if (deps.predecessors.length > 0) {
      lines.push('Depends on:');
      deps.predecessors.forEach(d => {
        const taskName = d.predecessor_task?.task_name || 'Unknown task';
        lines.push(`  • ${taskName} (${getDependencyTypeLabel(d.dependency_type)})`);
      });
    }

    if (deps.successors.length > 0) {
      if (lines.length > 0) lines.push('');
      lines.push('Blocks:');
      deps.successors.forEach(d => {
        const taskName = d.successor_task?.task_name || 'Unknown task';
        lines.push(`  • ${taskName} (${getDependencyTypeLabel(d.dependency_type)})`);
      });
    }

    return lines.join('\n');
  };

  return (
    <div className="overflow-hidden bg-white border border-gray-200 rounded-lg shadow-md">
      {/* Column headers */}
      <div className="bg-gray-50 border-b border-gray-200">
        <table className="w-full table-fixed">
          <colgroup>
            <col style={{ width: '3%' }} />
            <col style={{ width: '25%' }} />
            <col style={{ width: '6%' }} />
            <col style={{ width: '14%' }} />
            <col style={{ width: '12%' }} />
            <col style={{ width: '12%' }} />
            <col style={{ width: '10%' }} />
            <col style={{ width: '10%' }} />
            <col style={{ width: '8%' }} />
          </colgroup>
          <thead>
            <tr>
              <th className="pl-3" />
              <th className="py-2 pr-3 text-left text-xs font-medium text-gray-500 tracking-wider">
                Task Name
              </th>
              <th className="py-2 px-3 text-left text-xs font-medium text-gray-500 tracking-wider">
                Deps
              </th>
              <th className="py-2 px-3 text-left text-xs font-medium text-gray-500 tracking-wider">
                Tags
              </th>
              <th className="py-2 px-3 text-left text-xs font-medium text-gray-500 tracking-wider">
                Assignee
              </th>
              <th className="py-2 px-3 text-left text-xs font-medium text-gray-500 tracking-wider">
                Due Date
              </th>
              <th className="py-2 px-3 text-left text-xs font-medium text-gray-500 tracking-wider">
                Est. Hours
              </th>
              <th className="py-2 px-3 text-left text-xs font-medium text-gray-500 tracking-wider">
                Actual Hours
              </th>
              <th className="py-2 px-3 text-right text-xs font-medium text-gray-500 tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
        </table>
      </div>

      {/* Hierarchical rows */}
      <div className="divide-y divide-gray-200">
        {phaseGroups.map(phaseGroup => {
          const isPhaseExpanded = expandedPhases.has(phaseGroup.phase.phase_id);

          return (
            <div key={phaseGroup.phase.phase_id}>
              <table className="w-full table-fixed">
                <colgroup>
                  <col style={{ width: '3%' }} />
                  <col style={{ width: '25%' }} />
                  <col style={{ width: '6%' }} />
                  <col style={{ width: '14%' }} />
                  <col style={{ width: '12%' }} />
                  <col style={{ width: '12%' }} />
                  <col style={{ width: '10%' }} />
                  <col style={{ width: '10%' }} />
                  <col style={{ width: '8%' }} />
                </colgroup>

                {/* Phase header row */}
                <thead>
                  <tr
                    className="bg-gray-50 hover:bg-gray-100 cursor-pointer"
                    onClick={() => togglePhase(phaseGroup.phase.phase_id)}
                  >
                    <td className="py-2 pl-3">
                      {isPhaseExpanded ? (
                        <ChevronDown className="h-4 w-4 text-gray-400" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-gray-400" />
                      )}
                    </td>
                    <td className="py-2 pr-3" colSpan={8}>
                      <span className="text-base font-semibold text-gray-900">
                        {phaseGroup.phase.phase_name}
                      </span>
                      <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-700">
                        {phaseGroup.totalTasks} {phaseGroup.totalTasks === 1 ? 'task' : 'tasks'}
                      </span>
                    </td>
                  </tr>
                </thead>

                {/* Status and task rows */}
                {isPhaseExpanded && (
                  <tbody className="divide-y divide-gray-100">
                    {phaseGroup.statusGroups.map(statusGroup => {
                      const statusKey = `${phaseGroup.phase.phase_id}:${statusGroup.status.project_status_mapping_id}`;
                      const isStatusExpanded = expandedStatuses.has(statusKey);

                      return (
                        <React.Fragment key={statusKey}>
                          {/* Status header row */}
                          <tr
                            className="bg-gray-50/50 hover:bg-gray-100/50 cursor-pointer"
                            onClick={() => toggleStatus(phaseGroup.phase.phase_id, statusGroup.status.project_status_mapping_id)}
                          >
                            <td className="py-1.5 pl-8">
                              {isStatusExpanded ? (
                                <ChevronDown className="h-3.5 w-3.5 text-gray-400" />
                              ) : (
                                <ChevronRight className="h-3.5 w-3.5 text-gray-400" />
                              )}
                            </td>
                            <td className="py-1.5 pr-3" colSpan={8}>
                              <div className="flex items-center gap-2">
                                <span
                                  className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium"
                                  style={{
                                    backgroundColor: statusGroup.status.color ? `${statusGroup.status.color}20` : '#6B728020',
                                    color: statusGroup.status.color || '#6B7280',
                                    border: `1px solid ${statusGroup.status.color || '#6B7280'}40`
                                  }}
                                >
                                  <span
                                    className="w-2 h-2 rounded-full"
                                    style={{ backgroundColor: statusGroup.status.color || '#6B7280' }}
                                  />
                                  {statusGroup.status.custom_name || statusGroup.status.name}
                                </span>
                                <span className="text-xs text-gray-500">
                                  ({statusGroup.tasks.length})
                                </span>
                              </div>
                            </td>
                          </tr>

                          {/* Task rows */}
                          {isStatusExpanded && statusGroup.tasks.map(task => {
                            const tags = taskTags[task.task_id] || [];
                            const resources = taskResources[task.task_id] || [];
                            const additionalCount = resources.length;
                            const deps = taskDependencies[task.task_id];
                            const hasDependencies = deps && (deps.predecessors.length > 0 || deps.successors.length > 0);
                            const dependencyTooltip = renderDependenciesTooltip(task.task_id);

                            return (
                              <tr
                                key={task.task_id}
                                className="bg-white hover:bg-gray-50 group"
                              >
                                {/* Indent spacer */}
                                <td className="py-2 pl-12" />

                                {/* Task Name */}
                                <td className="py-2 pr-3">
                                  <button
                                    type="button"
                                    className="text-sm text-gray-900 hover:text-primary-600 hover:underline cursor-pointer truncate text-left max-w-full"
                                    onClick={() => onTaskClick(task)}
                                    title={task.task_name}
                                  >
                                    {task.task_name}
                                  </button>
                                </td>

                                {/* Dependencies */}
                                <td className="py-2 px-3">
                                  {hasDependencies && dependencyTooltip && (
                                    <Tooltip content={<pre className="text-xs whitespace-pre-wrap">{dependencyTooltip}</pre>}>
                                      <div className="flex items-center gap-1 cursor-help">
                                        <Link2 className="h-3.5 w-3.5 text-gray-500" />
                                        <span className="text-xs text-gray-500">
                                          {(deps?.predecessors.length || 0) + (deps?.successors.length || 0)}
                                        </span>
                                      </div>
                                    </Tooltip>
                                  )}
                                </td>

                                {/* Tags */}
                                <td className="py-2 px-3">
                                  {tags.length > 0 && (
                                    <TagList
                                      tags={tags}
                                      maxDisplay={2}
                                    />
                                  )}
                                </td>

                                {/* Assignee */}
                                <td className="py-2 px-3">
                                  <div className="flex items-center gap-1">
                                    <span className="text-sm text-gray-700 truncate">
                                      {getAssigneeName(task.assigned_to)}
                                    </span>
                                    {additionalCount > 0 && (
                                      <span className="text-xs text-gray-500">
                                        +{additionalCount}
                                      </span>
                                    )}
                                  </div>
                                </td>

                                {/* Due Date */}
                                <td className="py-2 px-3">
                                  {task.due_date && (
                                    <span className="text-sm text-gray-700">
                                      {format(new Date(task.due_date), 'MMM d, yyyy')}
                                    </span>
                                  )}
                                </td>

                                {/* Est. Hours */}
                                <td className="py-2 px-3">
                                  <span className="text-sm text-gray-700">
                                    {task.estimated_hours ?? '-'}
                                  </span>
                                </td>

                                {/* Actual Hours */}
                                <td className="py-2 px-3">
                                  <span className="text-sm text-gray-700">
                                    {task.actual_hours ?? '-'}
                                  </span>
                                </td>

                                {/* Actions */}
                                <td className="py-2 px-3 text-right">
                                  <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <Button
                                      id={`edit-task-${task.task_id}`}
                                      variant="ghost"
                                      size="sm"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        onTaskClick(task);
                                      }}
                                      title="Edit task"
                                    >
                                      <Pencil className="h-3.5 w-3.5" />
                                    </Button>
                                    <Button
                                      id={`duplicate-task-${task.task_id}`}
                                      variant="ghost"
                                      size="sm"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        onTaskDuplicate(task);
                                      }}
                                      title="Duplicate task"
                                    >
                                      <Copy className="h-3.5 w-3.5" />
                                    </Button>
                                    <Button
                                      id={`delete-task-${task.task_id}`}
                                      variant="ghost"
                                      size="sm"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        onTaskDelete(task);
                                      }}
                                      title="Delete task"
                                    >
                                      <Trash2 className="h-3.5 w-3.5 text-red-600" />
                                    </Button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                )}
              </table>
            </div>
          );
        })}
      </div>

      {/* Empty state */}
      {phaseGroups.length === 0 && (
        <div className="flex items-center justify-center h-48 text-gray-500">
          <div className="text-center">
            <p className="text-base font-medium">No tasks found</p>
            <p className="text-sm mt-1">Create phases and add tasks to see them here</p>
          </div>
        </div>
      )}
    </div>
  );
}
