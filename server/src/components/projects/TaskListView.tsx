'use client';

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { IProjectPhase, IProjectTask, ProjectStatus, IProjectTicketLinkWithDetails, ITaskChecklistItem, IProjectTaskDependency } from 'server/src/interfaces/project.interfaces';
import { ITag } from 'server/src/interfaces/tag.interfaces';
import { ITaskResource } from 'server/src/interfaces/taskResource.interfaces';
import { ChevronDown, ChevronRight, Pencil, Copy, Trash2, Link2, Ban, GitBranch, Calendar, GripVertical, Plus } from 'lucide-react';
import { Tooltip } from 'server/src/components/ui/Tooltip';
import { Button } from 'server/src/components/ui/Button';
import { format } from 'date-fns';
import { TagList } from 'server/src/components/tags';

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
  onTaskMove?: (taskId: string, newStatusMappingId: string, newPhaseId: string, beforeTaskId: string | null, afterTaskId: string | null) => Promise<void>;
  onAddPhase?: () => void;
  onAddTask?: (phaseId: string) => void;
  users: any[];
  // Filter props
  selectedPriorityFilter?: string;
  selectedTaskTags?: string[];
}

interface PhaseGroup {
  phase: IProjectPhase;
  statusGroups: { status: ProjectStatus; tasks: IProjectTask[] }[];
  totalTasks: number;
  completedTasks: number;
  completionPercentage: number;
}

export default function TaskListView({
  projectId: _projectId,
  phases,
  tasks,
  statuses,
  ticketLinks: _ticketLinks,
  taskResources,
  checklistItems: _checklistItems,
  taskTags,
  taskDependencies = {},
  onTaskUpdate: _onTaskUpdate,
  onTaskClick,
  onTaskDelete,
  onTaskDuplicate,
  onTaskMove,
  onAddPhase,
  onAddTask,
  users,
  selectedPriorityFilter = 'all',
  selectedTaskTags = []
}: TaskListViewProps) {
  // Suppress unused variable warnings
  void _projectId;
  void _ticketLinks;
  void _checklistItems;
  void _onTaskUpdate;
  const [expandedPhases, setExpandedPhases] = useState<Set<string>>(new Set());
  const [expandedStatuses, setExpandedStatuses] = useState<Set<string>>(new Set());

  // Drag and drop state
  const [draggedTask, setDraggedTask] = useState<IProjectTask | null>(null);
  const [dragOverStatus, setDragOverStatus] = useState<string | null>(null);
  const [dragOverPhase, setDragOverPhase] = useState<string | null>(null);
  const [dropIndicatorIndex, setDropIndicatorIndex] = useState<number | null>(null);

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

  // Group tasks by phase and status - include ALL phases and ALL statuses for drag-and-drop
  const phaseGroups = useMemo((): PhaseGroup[] => {
    const groups: PhaseGroup[] = [];

    // Create a set of closed status IDs for quick lookup
    const closedStatusIds = new Set(
      statuses.filter(s => s.is_closed).map(s => s.project_status_mapping_id)
    );

    phases.forEach(phase => {
      const phaseTasks = filteredTasks.filter(task => task.phase_id === phase.phase_id);

      // Include ALL statuses for each phase (even empty ones) to enable drag-and-drop
      const statusGroups: { status: ProjectStatus; tasks: IProjectTask[] }[] = statuses.map(status => {
        const statusTasks = phaseTasks
          .filter(task => task.project_status_mapping_id === status.project_status_mapping_id)
          // Sort by order_key to match the reordering system (not wbs_code)
          .sort((a, b) => (a.order_key || '').localeCompare(b.order_key || ''));
        return { status, tasks: statusTasks };
      });

      // Calculate completion stats
      const completedTasks = phaseTasks.filter(task =>
        closedStatusIds.has(task.project_status_mapping_id)
      ).length;
      const completionPercentage = phaseTasks.length > 0
        ? Math.round((completedTasks / phaseTasks.length) * 100)
        : 0;

      groups.push({
        phase,
        statusGroups,
        totalTasks: phaseTasks.length,
        completedTasks,
        completionPercentage
      });
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

  // Helper to get dependency type info (label and icon)
  const getDependencyTypeInfo = (type: string): { label: string; icon: React.ReactNode; color: string } => {
    switch (type) {
      case 'blocks':
        return { label: 'Blocks', icon: <Ban className="h-3 w-3" />, color: 'text-red-500' };
      case 'blocked_by':
        return { label: 'Blocked by', icon: <Ban className="h-3 w-3" />, color: 'text-orange-500' };
      case 'related_to':
        return { label: 'Related to', icon: <GitBranch className="h-3 w-3" />, color: 'text-blue-500' };
      default:
        return { label: type, icon: <Link2 className="h-3 w-3" />, color: 'text-gray-500' };
    }
  };

  // Render dependencies tooltip content as JSX
  const renderDependenciesTooltipContent = (taskId: string): React.ReactNode | null => {
    const deps = taskDependencies[taskId];
    if (!deps || (deps.predecessors.length === 0 && deps.successors.length === 0)) {
      return null;
    }

    return (
      <div className="text-xs space-y-2">
        {deps.predecessors.length > 0 && (
          <div>
            <div className="font-medium text-gray-300 mb-1">Depends on:</div>
            {deps.predecessors.map((d, i) => {
              const info = getDependencyTypeInfo(d.dependency_type);
              return (
                <div key={i} className="flex items-center gap-1.5 ml-2">
                  <span className={info.color}>{info.icon}</span>
                  <span>{d.predecessor_task?.task_name || 'Unknown task'}</span>
                  <span className="text-gray-400">({info.label})</span>
                </div>
              );
            })}
          </div>
        )}
        {deps.successors.length > 0 && (
          <div>
            <div className="font-medium text-gray-300 mb-1">Blocks:</div>
            {deps.successors.map((d, i) => {
              const info = getDependencyTypeInfo(d.dependency_type);
              return (
                <div key={i} className="flex items-center gap-1.5 ml-2">
                  <span className={info.color}>{info.icon}</span>
                  <span>{d.successor_task?.task_name || 'Unknown task'}</span>
                  <span className="text-gray-400">({info.label})</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  // Get main dependency icon based on dependency types
  const getDependencyIcon = (taskId: string): React.ReactNode => {
    const deps = taskDependencies[taskId];
    if (!deps) return <Link2 className="h-3.5 w-3.5 text-gray-500" />;

    // Check if there are any blocking dependencies
    const hasBlocking = deps.predecessors.some(d => d.dependency_type === 'blocks' || d.dependency_type === 'blocked_by') ||
                       deps.successors.some(d => d.dependency_type === 'blocks' || d.dependency_type === 'blocked_by');

    if (hasBlocking) {
      return <Ban className="h-3.5 w-3.5 text-red-500" />;
    }

    return <GitBranch className="h-3.5 w-3.5 text-blue-500" />;
  };

  // Drag and drop handlers
  const handleDragStart = useCallback((e: React.DragEvent<HTMLTableRowElement>, task: IProjectTask) => {
    setDraggedTask(task);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', task.task_id);
    // Add a visual cue that we're dragging
    if (e.currentTarget) {
      e.currentTarget.style.opacity = '0.5';
    }
  }, []);

  const handleDragEnd = useCallback((e: React.DragEvent<HTMLTableRowElement>) => {
    setDraggedTask(null);
    setDragOverStatus(null);
    setDragOverPhase(null);
    setDropIndicatorIndex(null);
    if (e.currentTarget) {
      e.currentTarget.style.opacity = '1';
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent<HTMLTableRowElement>, statusId: string, phaseId: string, taskIndex: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    if (draggedTask) {
      setDragOverStatus(statusId);
      setDragOverPhase(phaseId);
      setDropIndicatorIndex(taskIndex);
    }
  }, [draggedTask]);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLTableRowElement>) => {
    // Only clear if we're leaving the current target (not entering a child)
    const relatedTarget = e.relatedTarget as HTMLElement;
    if (!e.currentTarget.contains(relatedTarget)) {
      setDropIndicatorIndex(null);
    }
  }, []);

  const handleStatusDragOver = useCallback((e: React.DragEvent<HTMLTableRowElement>, statusId: string, phaseId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    if (draggedTask) {
      setDragOverStatus(statusId);
      setDragOverPhase(phaseId);
      setDropIndicatorIndex(-1); // -1 means drop at end
    }
  }, [draggedTask]);

  const handleDrop = useCallback(async (e: React.DragEvent<HTMLTableRowElement>, statusId: string, phaseId: string, tasksInStatus: IProjectTask[], dropIndex: number) => {
    e.preventDefault();

    if (!draggedTask || !onTaskMove) {
      setDraggedTask(null);
      setDragOverStatus(null);
      setDragOverPhase(null);
      setDropIndicatorIndex(null);
      return;
    }

    // Determine beforeTaskId and afterTaskId based on drop position
    // beforeTaskId = task that should come BEFORE the moved task (lower order_key)
    // afterTaskId = task that should come AFTER the moved task (higher order_key)
    let beforeTaskId: string | null = null;
    let afterTaskId: string | null = null;

    if (dropIndex === -1 || dropIndex >= tasksInStatus.length) {
      // Dropping at the end - moved task should come after the last task
      beforeTaskId = tasksInStatus.length > 0 ? tasksInStatus[tasksInStatus.length - 1].task_id : null;
      afterTaskId = null;
    } else {
      // Dropping at a specific position (inserting before the task at dropIndex)
      // The task at dropIndex-1 should be BEFORE the moved task
      // The task at dropIndex should be AFTER the moved task
      beforeTaskId = dropIndex > 0 ? tasksInStatus[dropIndex - 1].task_id : null;
      afterTaskId = tasksInStatus[dropIndex].task_id;
    }

    // Don't move if dropping on itself
    if (draggedTask.task_id === beforeTaskId || draggedTask.task_id === afterTaskId) {
      setDraggedTask(null);
      setDragOverStatus(null);
      setDragOverPhase(null);
      setDropIndicatorIndex(null);
      return;
    }

    try {
      await onTaskMove(draggedTask.task_id, statusId, phaseId, beforeTaskId, afterTaskId);
    } catch (error) {
      console.error('Failed to move task:', error);
    }

    setDraggedTask(null);
    setDragOverStatus(null);
    setDragOverPhase(null);
    setDropIndicatorIndex(null);
  }, [draggedTask, onTaskMove]);

  return (
    <div className="flex flex-col bg-white border border-gray-200 rounded-lg overflow-hidden h-[calc(100vh-220px)] min-h-[400px]">
      {/* Column headers - sticky */}
      <div className="bg-white border-b border-gray-200 flex-shrink-0">
        <table className="w-full table-fixed">
          <colgroup>
            <col style={{ width: '40px' }} />
            <col style={{ width: '24%' }} />
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
              <th className="w-10 px-3 py-3" />
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Task Name
              </th>
              <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Deps
              </th>
              <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Tags
              </th>
              <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Assignee
              </th>
              <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Due Date
              </th>
              <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Est. Hours
              </th>
              <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Actual Hours
              </th>
              <th className="px-3 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
        </table>
      </div>

      {/* Hierarchical rows - scrollable */}
      <div className="divide-y divide-gray-200 overflow-y-auto flex-1">
        {phaseGroups.map(phaseGroup => {
          const isPhaseExpanded = expandedPhases.has(phaseGroup.phase.phase_id);

          return (
            <div key={phaseGroup.phase.phase_id}>
              <table className="w-full table-fixed">
                <colgroup>
                  <col style={{ width: '40px' }} />
                  <col style={{ width: '24%' }} />
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
                    className="bg-white hover:bg-gray-50 cursor-pointer transition-colors"
                    onClick={() => togglePhase(phaseGroup.phase.phase_id)}
                  >
                    <td className="py-3" colSpan={9}>
                      <div className="flex items-start gap-2 px-3">
                        <div className="pt-1 text-gray-400">
                          {isPhaseExpanded ? (
                            <ChevronDown className="h-5 w-5" />
                          ) : (
                            <ChevronRight className="h-5 w-5" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between">
                            <div>
                              <div className="flex items-center gap-3">
                                <h4 className="font-semibold text-gray-900">{phaseGroup.phase.phase_name}</h4>
                                <span className="text-sm text-gray-500">
                                  ({phaseGroup.totalTasks} {phaseGroup.totalTasks === 1 ? 'task' : 'tasks'})
                                </span>
                              </div>

                              {/* Phase description */}
                              {phaseGroup.phase.description && (
                                <p className="text-sm text-gray-600 mt-1">{phaseGroup.phase.description}</p>
                              )}

                              {/* Phase dates */}
                              {(phaseGroup.phase.start_date || phaseGroup.phase.end_date) && (
                                <div className="flex items-center gap-4 mt-2 text-sm text-gray-500">
                                  {phaseGroup.phase.start_date && (
                                    <span className="flex items-center gap-1">
                                      <Calendar className="w-3.5 h-3.5" />
                                      Start: {format(new Date(phaseGroup.phase.start_date), 'PP')}
                                    </span>
                                  )}
                                  {phaseGroup.phase.end_date && (
                                    <span className="flex items-center gap-1">
                                      <Calendar className="w-3.5 h-3.5" />
                                      End: {format(new Date(phaseGroup.phase.end_date), 'PP')}
                                    </span>
                                  )}
                                </div>
                              )}
                            </div>

                            <div className="flex items-center gap-4 ml-4">
                              {/* Completion percentage */}
                              {phaseGroup.totalTasks > 0 && (
                                <div className="text-right min-w-[80px]">
                                  <div className="text-lg font-bold text-purple-600">
                                    {phaseGroup.completionPercentage}%
                                  </div>
                                  <div className="text-xs text-gray-500">
                                    Complete
                                  </div>
                                </div>
                              )}

                              {/* Add Task button */}
                              {onAddTask && (
                                <Button
                                  id={`add-task-${phaseGroup.phase.phase_id}`}
                                  variant="ghost"
                                  size="sm"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onAddTask(phaseGroup.phase.phase_id);
                                  }}
                                >
                                  <Plus className="h-4 w-4 mr-1" />
                                  Add Task
                                </Button>
                              )}
                            </div>
                          </div>

                          {/* Progress bar */}
                          {phaseGroup.totalTasks > 0 && (
                            <div className="mt-3">
                              <ProgressBar percentage={phaseGroup.completionPercentage} />
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                  </tr>
                </thead>

                {/* Status and task rows */}
                {isPhaseExpanded && (
                  <tbody className="divide-y divide-gray-100">
                    {phaseGroup.statusGroups.map(statusGroup => {
                      const statusKey = `${phaseGroup.phase.phase_id}:${statusGroup.status.project_status_mapping_id}`;
                      const isStatusExpanded = expandedStatuses.has(statusKey);
                      const isDropTarget = draggedTask &&
                        dragOverStatus === statusGroup.status.project_status_mapping_id &&
                        dragOverPhase === phaseGroup.phase.phase_id;

                      return (
                        <React.Fragment key={statusKey}>
                          {/* Status header row - also serves as drop zone for empty statuses */}
                          <tr
                            className={`bg-gray-50 hover:bg-gray-100 cursor-pointer transition-colors ${
                              isDropTarget && statusGroup.tasks.length === 0 ? 'ring-2 ring-primary-400 ring-inset bg-primary-50' : ''
                            }`}
                            onClick={() => toggleStatus(phaseGroup.phase.phase_id, statusGroup.status.project_status_mapping_id)}
                            onDragOver={(e) => {
                              if (statusGroup.tasks.length === 0) {
                                handleStatusDragOver(e, statusGroup.status.project_status_mapping_id, phaseGroup.phase.phase_id);
                              }
                            }}
                            onDrop={(e) => {
                              if (draggedTask && statusGroup.tasks.length === 0) {
                                handleDrop(e, statusGroup.status.project_status_mapping_id, phaseGroup.phase.phase_id, [], -1);
                              }
                            }}
                          >
                            <td className="py-1.5" colSpan={9}>
                              <div className="flex items-center gap-2 pl-8">
                                {isStatusExpanded ? (
                                  <ChevronDown className="h-3.5 w-3.5 text-gray-400" />
                                ) : (
                                  <ChevronRight className="h-3.5 w-3.5 text-gray-400" />
                                )}
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
                          {isStatusExpanded && statusGroup.tasks.map((task, taskIndex) => {
                            const tags = taskTags[task.task_id] || [];
                            const resources = taskResources[task.task_id] || [];
                            const additionalCount = resources.length;
                            const deps = taskDependencies[task.task_id];
                            const hasDependencies = deps && (deps.predecessors.length > 0 || deps.successors.length > 0);
                            const dependencyTooltipContent = renderDependenciesTooltipContent(task.task_id);
                            const isDragging = draggedTask?.task_id === task.task_id;
                            const showDropIndicator = isDropTarget && dropIndicatorIndex === taskIndex;

                            return (
                              <React.Fragment key={task.task_id}>
                                {/* Drop indicator line above task */}
                                {showDropIndicator && (
                                  <tr className="h-0">
                                    <td colSpan={9} className="p-0">
                                      <div className="h-0.5 bg-primary-500 mx-2" />
                                    </td>
                                  </tr>
                                )}
                                <tr
                                className={`${taskIndex % 2 === 0 ? 'bg-gray-50' : 'bg-white'} hover:bg-blue-50 group transition-colors ${
                                  isDragging ? 'opacity-50' : ''
                                } ${showDropIndicator ? 'bg-primary-50' : ''}`}
                                draggable={!!onTaskMove}
                                onDragStart={(e) => handleDragStart(e, task)}
                                onDragEnd={handleDragEnd}
                                onDragOver={(e) => handleDragOver(e, statusGroup.status.project_status_mapping_id, phaseGroup.phase.phase_id, taskIndex)}
                                onDragLeave={handleDragLeave}
                                onDrop={(e) => handleDrop(e, statusGroup.status.project_status_mapping_id, phaseGroup.phase.phase_id, statusGroup.tasks, taskIndex)}
                              >
                                {/* Drag handle and indent spacer */}
                                <td className="py-3 px-3 w-10">
                                  {onTaskMove && (
                                    <GripVertical className="h-4 w-4 text-gray-400 cursor-grab opacity-0 group-hover:opacity-100 transition-opacity" />
                                  )}
                                </td>

                                {/* Task Name */}
                                <td className="py-3 px-6">
                                  <div className="min-w-0">
                                    <button
                                      type="button"
                                      className="text-sm font-medium text-gray-900 hover:text-primary-600 hover:underline cursor-pointer truncate text-left max-w-full block"
                                      onClick={() => onTaskClick(task)}
                                      title={task.task_name}
                                    >
                                      {task.task_name}
                                    </button>
                                    {task.description && (
                                      <p className="text-xs text-gray-500 mt-0.5 line-clamp-1" title={task.description}>
                                        {task.description}
                                      </p>
                                    )}
                                  </div>
                                </td>

                                {/* Dependencies */}
                                <td className="py-3 px-3">
                                  {hasDependencies && dependencyTooltipContent && (
                                    <Tooltip content={dependencyTooltipContent}>
                                      <div className="flex items-center gap-1 cursor-help">
                                        {getDependencyIcon(task.task_id)}
                                        <span className="text-xs text-gray-500">
                                          {(deps?.predecessors.length || 0) + (deps?.successors.length || 0)}
                                        </span>
                                      </div>
                                    </Tooltip>
                                  )}
                                </td>

                                {/* Tags */}
                                <td className="py-3 px-3">
                                  {tags.length > 0 && (
                                    <TagList
                                      tags={tags}
                                      maxDisplay={2}
                                    />
                                  )}
                                </td>

                                {/* Assignee */}
                                <td className="py-3 px-3">
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
                                <td className="py-3 px-3">
                                  {task.due_date && (
                                    <span className="text-sm text-gray-700">
                                      {format(new Date(task.due_date), 'MMM d, yyyy')}
                                    </span>
                                  )}
                                </td>

                                {/* Est. Hours */}
                                <td className="py-3 px-3">
                                  <span className="text-sm text-gray-700">
                                    {task.estimated_hours != null ? (task.estimated_hours / 60).toFixed(1) : '-'}
                                  </span>
                                </td>

                                {/* Actual Hours */}
                                <td className="py-3 px-3">
                                  <span className="text-sm text-gray-700">
                                    {task.actual_hours != null ? (task.actual_hours / 60).toFixed(1) : '-'}
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
                              </React.Fragment>
                            );
                          })}

                          {/* End drop zone for dropping at the end of status */}
                          {isStatusExpanded && draggedTask && statusGroup.tasks.length > 0 && (
                            <tr
                              className={`transition-colors ${
                                isDropTarget && dropIndicatorIndex === -1 ? 'bg-primary-50' : ''
                              }`}
                              onDragOver={(e) => handleStatusDragOver(e, statusGroup.status.project_status_mapping_id, phaseGroup.phase.phase_id)}
                              onDrop={(e) => handleDrop(e, statusGroup.status.project_status_mapping_id, phaseGroup.phase.phase_id, statusGroup.tasks, -1)}
                            >
                              <td colSpan={9} className="h-2">
                                {isDropTarget && dropIndicatorIndex === -1 && (
                                  <div className="h-0.5 bg-primary-400 ml-10" />
                                )}
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                )}
              </table>
            </div>
          );
        })}

        {/* Add Phase button */}
        {onAddPhase && (
          <div className="border-t border-gray-200 p-3">
            <Button
              id="add-phase-list-view"
              variant="ghost"
              size="sm"
              className="w-full justify-start text-gray-600 hover:text-gray-900"
              onClick={onAddPhase}
            >
              <Plus className="h-4 w-4 mr-2" />
              Add Phase
            </Button>
          </div>
        )}
      </div>

      {/* Empty state */}
      {phaseGroups.length === 0 && (
        <div className="flex items-center justify-center h-48 text-gray-500">
          <div className="text-center">
            <p className="text-base font-medium">No phases found</p>
            <p className="text-sm mt-1">Create phases and add tasks to see them here</p>
            {onAddPhase && (
              <Button
                id="add-phase-empty-state"
                variant="outline"
                size="sm"
                className="mt-4"
                onClick={onAddPhase}
              >
                <Plus className="h-4 w-4 mr-2" />
                Add Phase
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
