'use client';

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import {
  IProjectTemplatePhase,
  IProjectTemplateTask,
  IProjectTemplateStatusMapping,
  IProjectTemplateChecklistItem,
  IProjectTemplateDependency,
  IProjectTemplateTaskAssignment,
} from 'server/src/interfaces/projectTemplate.interfaces';
import { IUserWithRoles } from 'server/src/interfaces/auth.interfaces';
import { ITaskType } from 'server/src/interfaces/project.interfaces';
import {
  ChevronDown,
  ChevronRight,
  Pencil,
  Trash2,
  Ban,
  GitBranch,
  Link2,
  Clock,
  CheckSquare,
  Plus,
  GripVertical,
  Zap,
} from 'lucide-react';
import { Tooltip } from 'server/src/components/ui/Tooltip';
import { Button } from 'server/src/components/ui/Button';
import { Alert, AlertDescription } from 'server/src/components/ui/Alert';
import UserAvatar from 'server/src/components/ui/UserAvatar';
import UserPicker from 'server/src/components/ui/UserPicker';
import { useResponsiveColumns, ColumnConfig } from 'server/src/hooks/useResponsiveColumns';
import { getUserAvatarUrlsBatchAction } from 'server/src/lib/actions/avatar-actions';

// Column configuration for responsive hiding
// Lower priority number = higher importance (shown first)
// minWidth should match roughly the actual display width for proper hiding
const COLUMN_CONFIG: ColumnConfig[] = [
  { key: 'drag', minWidth: 40, priority: 0, alwaysShow: true },
  { key: 'name', minWidth: 200, priority: 1, alwaysShow: true },
  { key: 'actions', minWidth: 100, priority: 2, alwaysShow: true },
  { key: 'assignee', minWidth: 220, priority: 3 },
  { key: 'checklist', minWidth: 100, priority: 4 },
  { key: 'deps', minWidth: 70, priority: 5 },
  { key: 'est_hours', minWidth: 80, priority: 6 },
  { key: 'duration', minWidth: 80, priority: 7 },
];

interface TemplateTaskListViewProps {
  phases: IProjectTemplatePhase[];
  tasks: IProjectTemplateTask[];
  statusMappings: IProjectTemplateStatusMapping[];
  checklistItems: IProjectTemplateChecklistItem[];
  dependencies: IProjectTemplateDependency[];
  taskAssignments: IProjectTemplateTaskAssignment[];
  users: IUserWithRoles[];
  taskTypes: ITaskType[];
  priorities: Array<{ priority_id: string; priority_name: string; color?: string }>;
  onTaskClick: (task: IProjectTemplateTask) => void;
  onTaskDelete: (task: IProjectTemplateTask) => void;
  onAddPhase: () => void;
  onAddTask: (phaseId: string, statusMappingId?: string) => void;
  onTaskMove?: (taskId: string, newStatusMappingId: string, newPhaseId: string, beforeTaskId: string | null, afterTaskId: string | null) => Promise<void>;
  onAssigneeChange?: (taskId: string, newAssigneeId: string | null) => void;
}

interface PhaseGroup {
  phase: IProjectTemplatePhase;
  statusGroups: { status: IProjectTemplateStatusMapping; tasks: IProjectTemplateTask[] }[];
  totalTasks: number;
}

export default function TemplateTaskListView({
  phases,
  tasks,
  statusMappings,
  checklistItems,
  dependencies,
  taskAssignments,
  users,
  taskTypes,
  priorities,
  onTaskClick,
  onTaskDelete,
  onAddPhase,
  onAddTask,
  onTaskMove,
  onAssigneeChange,
}: TemplateTaskListViewProps) {
  const [expandedPhases, setExpandedPhases] = useState<Set<string>>(new Set());
  const [expandedStatuses, setExpandedStatuses] = useState<Set<string>>(new Set());
  const [avatarUrls, setAvatarUrls] = useState<Record<string, string | null>>({});

  // Fetch avatar URLs for assignees and additional agents
  useEffect(() => {
    const fetchAvatarUrls = async () => {
      // Collect all unique user IDs from tasks and task assignments
      const userIds = new Set<string>();

      // Add assigned_to users from tasks
      tasks.forEach(task => {
        if (task.assigned_to) {
          userIds.add(task.assigned_to);
        }
      });

      // Add additional agents from task assignments
      taskAssignments.forEach(assignment => {
        if (assignment.user_id) {
          userIds.add(assignment.user_id);
        }
      });

      if (userIds.size === 0) return;

      // Get tenant from first task
      const tenant = tasks[0]?.tenant;
      if (!tenant) return;

      try {
        const avatarUrlsMap = await getUserAvatarUrlsBatchAction(Array.from(userIds), tenant);
        // Convert Map to Record
        const urlsRecord: Record<string, string | null> = {};
        avatarUrlsMap.forEach((url, id) => {
          urlsRecord[id] = url;
        });
        setAvatarUrls(urlsRecord);
      } catch (error) {
        console.error('Failed to fetch avatar URLs:', error);
      }
    };

    fetchAvatarUrls();
  }, [tasks, taskAssignments, users]);

  // Responsive columns - add padding to account for scrollbars, cell padding, and borders
  const { containerRef, isColumnVisible, hiddenColumnCount } = useResponsiveColumns({
    columns: COLUMN_CONFIG,
    containerPadding: 80
  });

  // Calculate visible column count for colSpan
  const visibleColumnCount = COLUMN_CONFIG.filter(c => isColumnVisible(c.key)).length;

  // Drag and drop state
  const [draggedTask, setDraggedTask] = useState<IProjectTemplateTask | null>(null);
  const [dragOverStatus, setDragOverStatus] = useState<string | null>(null);
  const [dragOverPhase, setDragOverPhase] = useState<string | null>(null);
  const [dropIndicatorIndex, setDropIndicatorIndex] = useState<number | null>(null);

  // Sort status mappings by display order
  const sortedStatusMappings = useMemo(() => {
    return [...statusMappings].sort((a, b) => a.display_order - b.display_order);
  }, [statusMappings]);

  // Group tasks by phase and status
  const phaseGroups = useMemo((): PhaseGroup[] => {
    const groups: PhaseGroup[] = [];

    // Sort phases by order_key
    const sortedPhases = [...phases].sort((a, b) =>
      (a.order_key || '').localeCompare(b.order_key || '')
    );

    sortedPhases.forEach((phase) => {
      const phaseTasks = tasks.filter(
        (task) => task.template_phase_id === phase.template_phase_id
      );

      // Include all statuses for each phase
      const statusGroups: { status: IProjectTemplateStatusMapping; tasks: IProjectTemplateTask[] }[] =
        sortedStatusMappings.map((status) => {
          const statusTasks = phaseTasks
            .filter(
              (task) =>
                task.template_status_mapping_id === status.template_status_mapping_id ||
                // Tasks without a status go to the first column
                (!task.template_status_mapping_id &&
                  status.template_status_mapping_id === sortedStatusMappings[0]?.template_status_mapping_id)
            )
            .sort((a, b) => (a.order_key || '').localeCompare(b.order_key || ''));
          return { status, tasks: statusTasks };
        });

      groups.push({
        phase,
        statusGroups,
        totalTasks: phaseTasks.length,
      });
    });

    return groups;
  }, [phases, tasks, sortedStatusMappings]);

  // Auto-expand phases that have tasks
  useEffect(() => {
    const phasesWithTasks = new Set<string>();
    const statusesWithTasks = new Set<string>();

    phaseGroups.forEach((group) => {
      if (group.totalTasks > 0) {
        phasesWithTasks.add(group.phase.template_phase_id);
        group.statusGroups.forEach((statusGroup) => {
          if (statusGroup.tasks.length > 0) {
            const statusKey = `${group.phase.template_phase_id}:${statusGroup.status.template_status_mapping_id}`;
            statusesWithTasks.add(statusKey);
          }
        });
      }
    });

    setExpandedPhases(phasesWithTasks);
    setExpandedStatuses(statusesWithTasks);
  }, [phaseGroups]);

  const togglePhase = (phaseId: string) => {
    setExpandedPhases((prev) => {
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
    setExpandedStatuses((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const getAssigneeName = (userId: string | null | undefined) => {
    if (!userId) return 'Unassigned';
    const user = users.find((u) => u.user_id === userId);
    return user ? `${user.first_name} ${user.last_name}` : 'Unknown';
  };

  const getAdditionalAssigneesCount = (taskId: string) => {
    // Count non-primary assignments for this task
    return taskAssignments.filter((a) => a.template_task_id === taskId && !a.is_primary).length;
  };

  const getTaskChecklistCount = (taskId: string) => {
    return checklistItems.filter((c) => c.template_task_id === taskId).length;
  };

  const getTaskDependencies = (taskId: string) => {
    const predecessors = dependencies.filter((d) => d.successor_task_id === taskId);
    const successors = dependencies.filter((d) => d.predecessor_task_id === taskId);
    return { predecessors, successors };
  };

  // Helper to get dependency type info
  const getDependencyTypeInfo = (
    type: string
  ): { label: string; icon: React.ReactNode; color: string } => {
    switch (type) {
      case 'blocks':
        return { label: 'Blocks', icon: <Ban className="h-3 w-3" />, color: 'text-red-500' };
      case 'blocked_by':
        return { label: 'Blocked by', icon: <Ban className="h-3 w-3" />, color: 'text-orange-500' };
      case 'related_to':
        return {
          label: 'Related to',
          icon: <GitBranch className="h-3 w-3" />,
          color: 'text-blue-500',
        };
      default:
        return { label: type, icon: <Link2 className="h-3 w-3" />, color: 'text-gray-500' };
    }
  };

  // Render dependencies tooltip content
  const renderDependenciesTooltipContent = (taskId: string): React.ReactNode | null => {
    const deps = getTaskDependencies(taskId);
    if (deps.predecessors.length === 0 && deps.successors.length === 0) {
      return null;
    }

    return (
      <div className="text-xs space-y-2 min-w-[220px]">
        {deps.predecessors.length > 0 && (
          <div>
            <div className="font-medium text-gray-300 mb-1">Depends on:</div>
            {deps.predecessors.map((d, i) => {
              const info = getDependencyTypeInfo(d.dependency_type);
              const predecessorTask = tasks.find(
                (t) => t.template_task_id === d.predecessor_task_id
              );
              return (
                <div key={i} className="flex items-center gap-1.5 ml-2">
                  <span className={info.color}>{info.icon}</span>
                  <span>{predecessorTask?.task_name || 'Unknown task'}</span>
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
              const successorTask = tasks.find((t) => t.template_task_id === d.successor_task_id);
              return (
                <div key={i} className="flex items-center gap-1.5 ml-2">
                  <span className={info.color}>{info.icon}</span>
                  <span>{successorTask?.task_name || 'Unknown task'}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  // Get main dependency icon
  const getDependencyIcon = (taskId: string): React.ReactNode => {
    const deps = getTaskDependencies(taskId);
    const hasBlocking =
      deps.predecessors.some(
        (d) => d.dependency_type === 'blocks' || d.dependency_type === 'blocked_by'
      ) ||
      deps.successors.some(
        (d) => d.dependency_type === 'blocks' || d.dependency_type === 'blocked_by'
      );

    if (hasBlocking) {
      return <Ban className="h-3.5 w-3.5 text-red-500" />;
    }

    return <GitBranch className="h-3.5 w-3.5 text-blue-500" />;
  };

  // Drag and drop handlers
  const handleDragStart = useCallback((e: React.DragEvent<HTMLTableRowElement>, task: IProjectTemplateTask) => {
    setDraggedTask(task);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', task.template_task_id);
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
      setDropIndicatorIndex(-1);
    }
  }, [draggedTask]);

  const handleDrop = useCallback(async (e: React.DragEvent<HTMLTableRowElement>, statusId: string, phaseId: string, tasksInStatus: IProjectTemplateTask[], dropIndex: number) => {
    e.preventDefault();

    if (!draggedTask || !onTaskMove) {
      setDraggedTask(null);
      setDragOverStatus(null);
      setDragOverPhase(null);
      setDropIndicatorIndex(null);
      return;
    }

    let beforeTaskId: string | null = null;
    let afterTaskId: string | null = null;

    if (dropIndex === -1 || dropIndex >= tasksInStatus.length) {
      beforeTaskId = tasksInStatus.length > 0 ? tasksInStatus[tasksInStatus.length - 1].template_task_id : null;
      afterTaskId = null;
    } else {
      beforeTaskId = dropIndex > 0 ? tasksInStatus[dropIndex - 1].template_task_id : null;
      afterTaskId = tasksInStatus[dropIndex].template_task_id;
    }

    if (draggedTask.template_task_id === beforeTaskId || draggedTask.template_task_id === afterTaskId) {
      setDraggedTask(null);
      setDragOverStatus(null);
      setDragOverPhase(null);
      setDropIndicatorIndex(null);
      return;
    }

    try {
      await onTaskMove(draggedTask.template_task_id, statusId, phaseId, beforeTaskId, afterTaskId);
    } catch (error) {
      console.error('Failed to move task:', error);
    }

    setDraggedTask(null);
    setDragOverStatus(null);
    setDragOverPhase(null);
    setDropIndicatorIndex(null);
  }, [draggedTask, onTaskMove]);

  return (
    <div ref={containerRef} className="flex flex-col bg-white border border-gray-200 rounded-lg overflow-hidden h-full min-h-[400px]">
      {/* Hidden columns alert */}
      {hiddenColumnCount > 0 && (
        <Alert variant="info" className="rounded-none border-x-0 border-t-0">
          <AlertDescription className="flex items-center text-sm">
            <Zap className="h-4 w-4 mr-1" />
            {hiddenColumnCount} column{hiddenColumnCount > 1 ? 's' : ''} hidden due to limited space. Resize browser to see more.
          </AlertDescription>
        </Alert>
      )}
      {/* Column headers - sticky */}
      <div className="bg-white border-b border-gray-200 flex-shrink-0">
        <table className="w-full table-fixed">
          {/* Column widths: Drag | Name | Deps | Checklist | Assignee | Est. Hours | Duration | Actions */}
          <colgroup><col style={{ width: '40px' }} /><col />{isColumnVisible('deps') && <col style={{ width: '6%' }} />}{isColumnVisible('checklist') && <col style={{ width: '7%' }} />}{isColumnVisible('assignee') && <col style={{ width: '17%' }} />}{isColumnVisible('est_hours') && <col style={{ width: '8%' }} />}{isColumnVisible('duration') && <col style={{ width: '8%' }} />}<col style={{ width: '9%' }} /></colgroup>
          <thead>
            <tr>
              <th className="w-10 px-3 py-3" />
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500">
                Name
              </th>
              {isColumnVisible('deps') && (
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500">
                  Deps
                </th>
              )}
              {isColumnVisible('checklist') && (
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500">
                  Checklist
                </th>
              )}
              {isColumnVisible('assignee') && (
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500">
                  Assignee
                </th>
              )}
              {isColumnVisible('est_hours') && (
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500">
                  Est. Hours
                </th>
              )}
              {isColumnVisible('duration') && (
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500">
                  Duration
                </th>
              )}
              <th className="px-3 py-3 text-right text-xs font-medium text-gray-500">
                Actions
              </th>
            </tr>
          </thead>
        </table>
      </div>

      {/* Hierarchical rows - scrollable */}
      <div className="divide-y divide-gray-200 overflow-y-auto flex-1">
        {phaseGroups.map((phaseGroup) => {
          const isPhaseExpanded = expandedPhases.has(phaseGroup.phase.template_phase_id);

          return (
            <div key={phaseGroup.phase.template_phase_id}>
              <table className="w-full table-fixed">
{/* Column widths: Drag | Name | Deps | Checklist | Assignee | Est. Hours | Duration | Actions */}
                <colgroup><col style={{ width: '40px' }} /><col />{isColumnVisible('deps') && <col style={{ width: '6%' }} />}{isColumnVisible('checklist') && <col style={{ width: '7%' }} />}{isColumnVisible('assignee') && <col style={{ width: '17%' }} />}{isColumnVisible('est_hours') && <col style={{ width: '8%' }} />}{isColumnVisible('duration') && <col style={{ width: '8%' }} />}<col style={{ width: '9%' }} /></colgroup>

                {/* Phase header row */}
                <thead>
                  <tr
                    className="bg-white hover:bg-gray-50 cursor-pointer transition-colors"
                    onClick={() => togglePhase(phaseGroup.phase.template_phase_id)}
                  >
                    <td className="py-3" colSpan={visibleColumnCount}>
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
                                <h4 className="font-semibold text-gray-900">
                                  {phaseGroup.phase.phase_name || 'Untitled Phase'}
                                </h4>
                                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-700">
                                  {phaseGroup.totalTasks} {phaseGroup.totalTasks === 1 ? 'task' : 'tasks'}
                                </span>
                              </div>

                              {/* Phase description */}
                              {phaseGroup.phase.description && (
                                <p className="text-sm text-gray-600 mt-1">
                                  {phaseGroup.phase.description}
                                </p>
                              )}

                              {/* Phase timing info */}
                              {(phaseGroup.phase.duration_days !== undefined ||
                                phaseGroup.phase.start_offset_days !== undefined) && (
                                <div className="flex items-center gap-4 mt-2 text-sm text-gray-500">
                                  {phaseGroup.phase.duration_days !== undefined && (
                                    <span className="flex items-center gap-1">
                                      <Clock className="w-3.5 h-3.5" />
                                      Duration: {phaseGroup.phase.duration_days} days
                                    </span>
                                  )}
                                  {phaseGroup.phase.start_offset_days !== undefined &&
                                    phaseGroup.phase.start_offset_days > 0 && (
                                      <span>
                                        Start offset: +{phaseGroup.phase.start_offset_days} days
                                      </span>
                                    )}
                                </div>
                              )}
                            </div>

                            <div className="flex items-center gap-4 ml-4">
                              {/* Add Task button */}
                              <Button
                                id={`add-task-${phaseGroup.phase.template_phase_id}`}
                                variant="default"
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onAddTask(phaseGroup.phase.template_phase_id);
                                }}
                              >
                                <Plus className="h-4 w-4 mr-1" />
                                Add Task
                              </Button>
                            </div>
                          </div>
                        </div>
                      </div>
                    </td>
                  </tr>
                </thead>

                {/* Status and task rows */}
                {isPhaseExpanded && (
                  <tbody className="divide-y divide-gray-100">
                    {phaseGroup.statusGroups.map((statusGroup) => {
                      const statusKey = `${phaseGroup.phase.template_phase_id}:${statusGroup.status.template_status_mapping_id}`;
                      const isStatusExpanded = expandedStatuses.has(statusKey);
                      const statusColor = statusGroup.status.color || '#6B7280';
                      const displayName =
                        statusGroup.status.status_name ||
                        statusGroup.status.custom_status_name ||
                        'Status';
                      const isDropTarget = draggedTask &&
                        dragOverStatus === statusGroup.status.template_status_mapping_id &&
                        dragOverPhase === phaseGroup.phase.template_phase_id;

                      return (
                        <React.Fragment key={statusKey}>
                          {/* Status header row - also serves as drop zone for empty statuses */}
                          <tr
                            className={`bg-gray-50 hover:bg-gray-100 cursor-pointer transition-colors ${
                              isDropTarget && statusGroup.tasks.length === 0 ? 'ring-2 ring-primary-400 ring-inset bg-primary-50' : ''
                            }`}
                            onClick={() =>
                              toggleStatus(
                                phaseGroup.phase.template_phase_id,
                                statusGroup.status.template_status_mapping_id
                              )
                            }
                            onDragOver={(e) => {
                              if (statusGroup.tasks.length === 0) {
                                handleStatusDragOver(e, statusGroup.status.template_status_mapping_id, phaseGroup.phase.template_phase_id);
                              }
                            }}
                            onDrop={(e) => {
                              if (draggedTask && statusGroup.tasks.length === 0) {
                                handleDrop(e, statusGroup.status.template_status_mapping_id, phaseGroup.phase.template_phase_id, [], -1);
                              }
                            }}
                          >
                            <td className="py-1.5" colSpan={visibleColumnCount}>
                              <div className="flex items-center gap-2 pl-8">
                                {isStatusExpanded ? (
                                  <ChevronDown className="h-3.5 w-3.5 text-gray-400" />
                                ) : (
                                  <ChevronRight className="h-3.5 w-3.5 text-gray-400" />
                                )}
                                <span
                                  className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium"
                                  style={{
                                    backgroundColor: `${statusColor}20`,
                                    color: statusColor,
                                    border: `1px solid ${statusColor}40`,
                                  }}
                                >
                                  <span
                                    className="w-2 h-2 rounded-full"
                                    style={{ backgroundColor: statusColor }}
                                  />
                                  {displayName}
                                </span>
                                <span className="text-xs text-gray-500">
                                  ({statusGroup.tasks.length})
                                </span>
                              </div>
                            </td>
                          </tr>

                          {/* Task rows */}
                          {isStatusExpanded &&
                            statusGroup.tasks.map((task, taskIndex) => {
                              const deps = getTaskDependencies(task.template_task_id);
                              const hasDependencies =
                                deps.predecessors.length > 0 || deps.successors.length > 0;
                              const dependencyTooltipContent = renderDependenciesTooltipContent(
                                task.template_task_id
                              );
                              const checklistCount = getTaskChecklistCount(task.template_task_id);
                              const additionalAssigneesCount = getAdditionalAssigneesCount(task.template_task_id);
                              const isDragging = draggedTask?.template_task_id === task.template_task_id;
                              const showDropIndicator = isDropTarget && dropIndicatorIndex === taskIndex;

                              return (
                                <React.Fragment key={task.template_task_id}>
                                  {/* Drop indicator line above task */}
                                  {showDropIndicator && (
                                    <tr className="h-0">
                                      <td colSpan={visibleColumnCount} className="p-0">
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
                                    onDragOver={(e) => handleDragOver(e, statusGroup.status.template_status_mapping_id, phaseGroup.phase.template_phase_id, taskIndex)}
                                    onDragLeave={handleDragLeave}
                                    onDrop={(e) => handleDrop(e, statusGroup.status.template_status_mapping_id, phaseGroup.phase.template_phase_id, statusGroup.tasks, taskIndex)}
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
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          onTaskClick(task);
                                        }}
                                        title={task.task_name}
                                      >
                                        {task.task_name}
                                      </button>
                                      {task.description && (
                                        <p
                                          className="text-xs text-gray-500 mt-0.5 line-clamp-1"
                                          title={task.description}
                                        >
                                          {task.description}
                                        </p>
                                      )}
                                    </div>
                                  </td>

                                  {/* Dependencies */}
                                  {isColumnVisible('deps') && (
                                    <td className="py-3 px-3">
                                      {hasDependencies && dependencyTooltipContent && (
                                        <Tooltip content={dependencyTooltipContent}>
                                          <div className="flex items-center gap-1 cursor-help">
                                            {getDependencyIcon(task.template_task_id)}
                                            <span className="text-xs text-gray-500">
                                              {deps.predecessors.length + deps.successors.length}
                                            </span>
                                          </div>
                                        </Tooltip>
                                      )}
                                    </td>
                                  )}

                                  {/* Checklist */}
                                  {isColumnVisible('checklist') && (
                                    <td className="py-3 px-3">
                                      {checklistCount > 0 && (() => {
                                        const taskChecklistItems = checklistItems.filter(c => c.template_task_id === task.template_task_id);
                                        return (
                                          <Tooltip
                                            content={
                                              <div className="text-xs space-y-1 max-w-xs">
                                                <div className="font-medium text-gray-300 mb-1">Checklist Items:</div>
                                                {taskChecklistItems.map((item, i) => (
                                                  <div key={i} className="flex items-center gap-1.5">
                                                    <CheckSquare className={`h-3 w-3 ${item.completed ? 'text-green-400' : 'text-gray-400'}`} />
                                                    <span className={item.completed ? 'line-through text-gray-400' : ''}>{item.item_name}</span>
                                                  </div>
                                                ))}
                                              </div>
                                            }
                                          >
                                            <div className="flex items-center gap-1 text-gray-600 cursor-help">
                                              <CheckSquare className="h-3.5 w-3.5" />
                                              <span className="text-xs">{checklistCount}</span>
                                            </div>
                                          </Tooltip>
                                        );
                                      })()}
                                    </td>
                                  )}

                                  {/* Assignee */}
                                  {isColumnVisible('assignee') && (
                                    <td className="py-3 px-3" onClick={(e) => e.stopPropagation()}>
                                      <div className="flex items-center gap-1.5">
                                        {onAssigneeChange ? (
                                          <UserPicker
                                            value={task.assigned_to || ''}
                                            onValueChange={(newAssigneeId) => onAssigneeChange(task.template_task_id, newAssigneeId || null)}
                                            size="sm"
                                            users={users.filter(u =>
                                              !taskAssignments.some(a =>
                                                a.template_task_id === task.template_task_id &&
                                                !a.is_primary &&
                                                a.user_id === u.user_id
                                              )
                                            )}
                                          />
                                        ) : (
                                          (() => {
                                            const user = task.assigned_to ? users.find(u => u.user_id === task.assigned_to) : null;
                                            if (user) {
                                              const userName = `${user.first_name} ${user.last_name}`;
                                              return (
                                                <>
                                                  <UserAvatar
                                                    userId={user.user_id}
                                                    userName={userName}
                                                    avatarUrl={avatarUrls[user.user_id] ?? null}
                                                    size="xs"
                                                  />
                                                  <span className="text-sm text-gray-700 truncate">
                                                    {userName}
                                                  </span>
                                                </>
                                              );
                                            }
                                            return (
                                              <span className="text-sm text-gray-400">Unassigned</span>
                                            );
                                          })()
                                        )}
                                        {additionalAssigneesCount > 0 && (() => {
                                          const additionalAssignments = taskAssignments.filter(a => a.template_task_id === task.template_task_id && !a.is_primary);
                                          return (
                                            <Tooltip
                                              content={
                                                <div className="text-xs space-y-1.5">
                                                  <div className="font-medium text-gray-300 mb-1">Additional Agents:</div>
                                                  {additionalAssignments.map((assignment, i) => {
                                                    const assignmentUser = users.find(u => u.user_id === assignment.user_id);
                                                    const userName = assignmentUser ? `${assignmentUser.first_name} ${assignmentUser.last_name}` : 'Unknown';
                                                    return (
                                                      <div key={i} className="flex items-center gap-2">
                                                        <UserAvatar
                                                          userId={assignment.user_id}
                                                          userName={userName}
                                                          avatarUrl={avatarUrls[assignment.user_id] ?? null}
                                                          size="xs"
                                                        />
                                                        <span>{userName}</span>
                                                      </div>
                                                    );
                                                  })}
                                                </div>
                                              }
                                            >
                                              <span
                                                className="text-xs font-medium cursor-help px-1.5 py-0.5 rounded"
                                                style={{
                                                  color: 'rgb(var(--color-primary-500))',
                                                  backgroundColor: 'rgb(var(--color-primary-50))'
                                                }}
                                              >
                                                +{additionalAssigneesCount}
                                              </span>
                                            </Tooltip>
                                          );
                                        })()}
                                      </div>
                                    </td>
                                  )}

                                  {/* Est. Hours */}
                                  {isColumnVisible('est_hours') && (
                                    <td className="py-3 px-3">
                                      <span className="text-sm text-gray-700">
                                        {task.estimated_hours != null
                                          ? (Number(task.estimated_hours) / 60).toFixed(1)
                                          : '-'}
                                      </span>
                                    </td>
                                  )}

                                  {/* Duration */}
                                  {isColumnVisible('duration') && (
                                    <td className="py-3 px-3">
                                      <span className="text-sm text-gray-700">
                                        {task.duration_days != null ? `${task.duration_days}d` : '-'}
                                      </span>
                                    </td>
                                  )}

                                  {/* Actions */}
                                  <td className="py-2 px-3 text-right">
                                    <div
                                      className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      <Button
                                        id={`edit-task-${task.template_task_id}`}
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => onTaskClick(task)}
                                        title="Edit task"
                                      >
                                        <Pencil className="h-3.5 w-3.5" />
                                      </Button>
                                      <Button
                                        id={`delete-task-${task.template_task_id}`}
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => onTaskDelete(task)}
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
        <div className="border-t border-gray-200 p-3">
          <Button
            id="add-phase-list-view"
            variant="default"
            size="sm"
            onClick={onAddPhase}
          >
            <Plus className="h-4 w-4 mr-2" />
            Add Phase
          </Button>
        </div>
      </div>

      {/* Empty state */}
      {phaseGroups.length === 0 && (
        <div className="flex items-center justify-center h-48 text-gray-500">
          <div className="text-center">
            <p className="text-base font-medium">No phases found</p>
            <p className="text-sm mt-1">Create phases and add tasks to see them here</p>
            <Button
              id="add-phase-empty-state"
              variant="default"
              size="sm"
              className="mt-4"
              onClick={onAddPhase}
            >
              <Plus className="h-4 w-4 mr-2" />
              Add Phase
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
