'use client';

import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { IProjectPhase, IProjectTask, ProjectStatus, IProjectTaskDependency } from '@alga-psa/types';
import { ITag } from '@alga-psa/types';
import { ITaskResource } from '@alga-psa/types';
import { ChevronDown, ChevronRight, Pencil, Copy, Trash2, Link2, Ban, GitBranch, Calendar, GripVertical, Plus, CheckSquare, Paperclip, Zap } from 'lucide-react';
import { Tooltip } from '@alga-psa/ui/components/Tooltip';
import { Button } from '@alga-psa/ui/components/Button';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { format } from 'date-fns';
import { TagList } from '@alga-psa/ui/components';
import { TagManager } from '@alga-psa/tags/components';
import UserAvatar from '@alga-psa/ui/components/UserAvatar';
import UserPicker from '@alga-psa/ui/components/UserPicker';
import { useResponsiveColumns, ColumnConfig } from '@alga-psa/ui/hooks';
import { getUserAvatarUrlsBatchAction } from '@alga-psa/users/actions';

// Helper function to highlight matching text in search results
const highlightSearchMatch = (text: string, query: string, caseSensitive: boolean = false): React.ReactNode => {
  if (!query.trim()) return text;

  const flags = caseSensitive ? 'g' : 'gi';
  const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, flags);
  const parts = text.split(regex);

  return parts.map((part, index) =>
    regex.test(part) ? (
      <mark
        key={index}
        className="bg-[rgb(var(--color-primary-200))] text-[rgb(var(--color-primary-900))] rounded px-0.5"
      >
        {part}
      </mark>
    ) : part
  );
};

// Auto-scroll configuration for drag operations
const SCROLL_THRESHOLD = 80; // Pixels from edge to start scrolling
const MAX_SCROLL_SPEED = 15; // Maximum scroll speed in pixels per frame

// Column configuration for responsive hiding
// Lower priority number = higher importance (shown first)
// minWidth should be generous to prevent overflow before hiding
const COLUMN_CONFIG: ColumnConfig[] = [
  { key: 'drag', minWidth: 50, priority: 0, alwaysShow: true },
  { key: 'name', minWidth: 250, priority: 1, alwaysShow: true },
  { key: 'actions', minWidth: 110, priority: 2, alwaysShow: true },
  { key: 'assignee', minWidth: 220, priority: 3 },
  { key: 'due_date', minWidth: 120, priority: 4 },
  { key: 'checklist', minWidth: 100, priority: 5 },
  { key: 'deps', minWidth: 80, priority: 6 },
  { key: 'tags', minWidth: 130, priority: 7 },
  { key: 'est_hours', minWidth: 90, priority: 8 },
  { key: 'actual_hours', minWidth: 100, priority: 9 },
  { key: 'attachments', minWidth: 90, priority: 10 },
];

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
  phases: IProjectPhase[];
  tasks: IProjectTask[];
  statuses: ProjectStatus[];
  taskResources: Record<string, ITaskResource[]>;
  taskTags: Record<string, ITag[]>;
  taskDependencies?: Record<string, { predecessors: IProjectTaskDependency[]; successors: IProjectTaskDependency[] }>;
  checklistItems: Record<string, { total: number; completed: number; items?: Array<{ item_name: string; completed: boolean }> }>;
  documentCounts?: Record<string, number>;
  onTaskClick: (task: IProjectTask) => void;
  onTaskDelete: (task: IProjectTask) => void;
  onTaskDuplicate: (task: IProjectTask) => void;
  onTaskMove?: (taskId: string, newStatusMappingId: string, newPhaseId: string, beforeTaskId: string | null, afterTaskId: string | null) => Promise<void>;
  onAddPhase?: () => void;
  onAddTask?: (phaseId: string) => void;
  onTaskTagsChange?: (taskId: string, tags: ITag[]) => void;
  onAssigneeChange?: (taskId: string, newAssigneeId: string | null) => void;
  users: any[];
  // Filter props
  selectedPriorityFilter?: string;
  selectedTaskTags?: string[];
  searchQuery?: string;
  searchWholeWord?: boolean;
  searchCaseSensitive?: boolean;
}

interface PhaseGroup {
  phase: IProjectPhase;
  statusGroups: { status: ProjectStatus; tasks: IProjectTask[] }[];
  totalTasks: number;
  completedTasks: number;
  completionPercentage: number;
}

export default function TaskListView({
  phases,
  tasks,
  statuses,
  taskResources,
  taskTags,
  taskDependencies = {},
  checklistItems,
  documentCounts = {},
  onTaskClick,
  onTaskDelete,
  onTaskDuplicate,
  onTaskMove,
  onAddPhase,
  onAddTask,
  onTaskTagsChange,
  onAssigneeChange,
  users,
  selectedPriorityFilter = 'all',
  selectedTaskTags = [],
  searchQuery = '',
  searchWholeWord = false,
  searchCaseSensitive = false
}: TaskListViewProps) {
  const [expandedPhases, setExpandedPhases] = useState<Set<string>>(new Set());
  const [expandedStatuses, setExpandedStatuses] = useState<Set<string>>(new Set());
  const [expandedTitles, setExpandedTitles] = useState<Set<string>>(new Set());
  const [expandedDescriptions, setExpandedDescriptions] = useState<Set<string>>(new Set());
  const [avatarUrls, setAvatarUrls] = useState<Record<string, string | null>>({});

  // Auto-expand titles and descriptions when search matches
  useEffect(() => {
    if (!searchQuery.trim()) {
      setExpandedTitles(new Set());
      setExpandedDescriptions(new Set());
      return;
    }

    const newExpandedTitles = new Set<string>();
    const newExpandedDescriptions = new Set<string>();
    const query = searchCaseSensitive ? searchQuery : searchQuery.toLowerCase();

    tasks.forEach(task => {
      const taskName = searchCaseSensitive ? task.task_name : task.task_name.toLowerCase();
      const description = task.description
        ? (searchCaseSensitive ? task.description : task.description.toLowerCase())
        : '';

      const matchesName = taskName.includes(query);
      const matchesDescription = description.includes(query);

      // Auto-expand title if it matches and is long enough to be truncated
      if (matchesName && task.task_name.length > 50) {
        newExpandedTitles.add(task.task_id);
      }

      // Auto-expand description if it matches but name doesn't
      if (matchesDescription && !matchesName) {
        newExpandedDescriptions.add(task.task_id);
      }
    });

    setExpandedTitles(newExpandedTitles);
    setExpandedDescriptions(newExpandedDescriptions);
  }, [searchQuery, searchCaseSensitive, tasks]);

  // Fetch avatar URLs for assignees and additional agents
  useEffect(() => {
    const fetchAvatarUrls = async () => {
      // Collect all unique user IDs from tasks and task resources
      const userIds = new Set<string>();

      // Add assigned_to users
      tasks.forEach(task => {
        if (task.assigned_to) {
          userIds.add(task.assigned_to);
        }
      });

      // Add additional agents from task resources
      Object.values(taskResources).forEach(resources => {
        resources.forEach(resource => {
          if (resource.additional_user_id) {
            userIds.add(resource.additional_user_id);
          }
        });
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
  }, [taskResources, tasks]);

  // Responsive columns - add padding to account for scrollbars, cell padding, and borders
  const { containerRef, isColumnVisible, hiddenColumnCount } = useResponsiveColumns({
    columns: COLUMN_CONFIG,
    containerPadding: 80
  });

  // Drag and drop state
  const [draggedTask, setDraggedTask] = useState<IProjectTask | null>(null);
  const [dragOverStatus, setDragOverStatus] = useState<string | null>(null);
  const [dragOverPhase, setDragOverPhase] = useState<string | null>(null);
  const [dropIndicatorIndex, setDropIndicatorIndex] = useState<number | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const scrollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const scrollSpeedRef = useRef<number>(0);

  // Filter tasks based on search, priority and tags
  const filteredTasks = useMemo(() => {
    let filtered = tasks;

    // Apply search filter
    if (searchQuery.trim()) {
      const query = searchCaseSensitive ? searchQuery : searchQuery.toLowerCase();
      filtered = filtered.filter(task => {
        const taskName = searchCaseSensitive ? task.task_name : task.task_name.toLowerCase();
        const taskDescription = searchCaseSensitive
          ? (task.description ?? '')
          : (task.description?.toLowerCase() ?? '');

        if (searchWholeWord) {
          // Use word boundary regex for whole word matching
          const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const wordRegex = new RegExp(`\\b${escapedQuery}\\b`, searchCaseSensitive ? '' : 'i');
          return wordRegex.test(task.task_name) || wordRegex.test(task.description ?? '');
        } else {
          return taskName.includes(query) || taskDescription.includes(query);
        }
      });
    }

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
  }, [tasks, searchQuery, searchWholeWord, searchCaseSensitive, selectedPriorityFilter, selectedTaskTags, taskTags]);

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

  // Cleanup scroll interval on unmount
  useEffect(() => {
    return () => {
      if (scrollIntervalRef.current) {
        clearInterval(scrollIntervalRef.current);
      }
    };
  }, []);

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
      <div className="text-xs space-y-2 min-w-[220px]">
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
    // Clear scroll interval
    scrollSpeedRef.current = 0;
    if (scrollIntervalRef.current) {
      clearInterval(scrollIntervalRef.current);
      scrollIntervalRef.current = null;
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent<HTMLTableRowElement>, statusId: string, phaseId: string, taskIndex: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    if (draggedTask) {
      setDragOverStatus(statusId);
      setDragOverPhase(phaseId);
      setDropIndicatorIndex(taskIndex);

      // Handle auto-scroll
      const container = scrollContainerRef.current;
      if (container) {
        const containerRect = container.getBoundingClientRect();
        const mouseY = e.clientY;

        // Calculate scroll speed based on distance from edges
        let scrollSpeed = 0;
        const topEdge = containerRect.top + SCROLL_THRESHOLD;
        const bottomEdge = containerRect.bottom - SCROLL_THRESHOLD;

        if (mouseY < topEdge && mouseY > containerRect.top) {
          // Near top edge - scroll up
          const distance = topEdge - mouseY;
          scrollSpeed = -Math.min(MAX_SCROLL_SPEED, (distance / SCROLL_THRESHOLD) * MAX_SCROLL_SPEED);
        } else if (mouseY > bottomEdge && mouseY < containerRect.bottom) {
          // Near bottom edge - scroll down
          const distance = mouseY - bottomEdge;
          scrollSpeed = Math.min(MAX_SCROLL_SPEED, (distance / SCROLL_THRESHOLD) * MAX_SCROLL_SPEED);
        }

        // Update scroll speed ref
        scrollSpeedRef.current = scrollSpeed;

        // Start interval if not already running and we need to scroll
        if (!scrollIntervalRef.current && scrollSpeed !== 0) {
          scrollIntervalRef.current = setInterval(() => {
            const currentContainer = scrollContainerRef.current;
            if (currentContainer && scrollSpeedRef.current !== 0) {
              currentContainer.scrollTop += scrollSpeedRef.current;
            }
            // Stop interval if speed is 0
            if (scrollSpeedRef.current === 0 && scrollIntervalRef.current) {
              clearInterval(scrollIntervalRef.current);
              scrollIntervalRef.current = null;
            }
          }, 16); // ~60fps
        }
      }
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

      // Handle auto-scroll
      const container = scrollContainerRef.current;
      if (container) {
        const containerRect = container.getBoundingClientRect();
        const mouseY = e.clientY;

        // Calculate scroll speed based on distance from edges
        let scrollSpeed = 0;
        const topEdge = containerRect.top + SCROLL_THRESHOLD;
        const bottomEdge = containerRect.bottom - SCROLL_THRESHOLD;

        if (mouseY < topEdge && mouseY > containerRect.top) {
          // Near top edge - scroll up
          const distance = topEdge - mouseY;
          scrollSpeed = -Math.min(MAX_SCROLL_SPEED, (distance / SCROLL_THRESHOLD) * MAX_SCROLL_SPEED);
        } else if (mouseY > bottomEdge && mouseY < containerRect.bottom) {
          // Near bottom edge - scroll down
          const distance = mouseY - bottomEdge;
          scrollSpeed = Math.min(MAX_SCROLL_SPEED, (distance / SCROLL_THRESHOLD) * MAX_SCROLL_SPEED);
        }

        // Update scroll speed ref
        scrollSpeedRef.current = scrollSpeed;

        // Start interval if not already running and we need to scroll
        if (!scrollIntervalRef.current && scrollSpeed !== 0) {
          scrollIntervalRef.current = setInterval(() => {
            const currentContainer = scrollContainerRef.current;
            if (currentContainer && scrollSpeedRef.current !== 0) {
              currentContainer.scrollTop += scrollSpeedRef.current;
            }
            // Stop interval if speed is 0
            if (scrollSpeedRef.current === 0 && scrollIntervalRef.current) {
              clearInterval(scrollIntervalRef.current);
              scrollIntervalRef.current = null;
            }
          }, 16); // ~60fps
        }
      }
    }
  }, [draggedTask]);

  const handleDrop = useCallback(async (e: React.DragEvent<HTMLTableRowElement>, statusId: string, phaseId: string, tasksInStatus: IProjectTask[], dropIndex: number) => {
    e.preventDefault();

    // Clear scroll interval
    scrollSpeedRef.current = 0;
    if (scrollIntervalRef.current) {
      clearInterval(scrollIntervalRef.current);
      scrollIntervalRef.current = null;
    }

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

  // Calculate visible column count for colSpan
  const visibleColumnCount = COLUMN_CONFIG.filter(c => isColumnVisible(c.key ?? '')).length;

  return (
    <div ref={containerRef} className="flex flex-col bg-white border border-gray-200 rounded-lg overflow-hidden h-[calc(100vh-220px)] min-h-[400px]">
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
          <colgroup><col style={{ width: '40px' }} /><col />{isColumnVisible('deps') && <col style={{ width: '5%' }} />}{isColumnVisible('checklist') && <col style={{ width: '6%' }} />}{isColumnVisible('tags') && <col style={{ width: '10%' }} />}{isColumnVisible('assignee') && <col style={{ width: '17%' }} />}{isColumnVisible('est_hours') && <col style={{ width: '6%' }} />}{isColumnVisible('actual_hours') && <col style={{ width: '7%' }} />}{isColumnVisible('due_date') && <col style={{ width: '9%' }} />}{isColumnVisible('attachments') && <col style={{ width: '6%' }} />}<col style={{ width: '8%' }} /></colgroup>
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
              {isColumnVisible('tags') && (
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500">
                  Tags
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
              {isColumnVisible('actual_hours') && (
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500">
                  Actual Hours
                </th>
              )}
              {isColumnVisible('due_date') && (
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500">
                  Due Date
                </th>
              )}
              {isColumnVisible('attachments') && (
                <th className="px-3 py-3 text-left text-xs font-medium text-gray-500">
                  Attachments
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
      <div ref={scrollContainerRef} className="divide-y divide-gray-200 overflow-y-auto flex-1">
        {phaseGroups.map(phaseGroup => {
          const isPhaseExpanded = expandedPhases.has(phaseGroup.phase.phase_id);

          return (
            <div key={phaseGroup.phase.phase_id}>
              <table className="w-full table-fixed">
                <colgroup><col style={{ width: '40px' }} /><col />{isColumnVisible('deps') && <col style={{ width: '5%' }} />}{isColumnVisible('checklist') && <col style={{ width: '6%' }} />}{isColumnVisible('tags') && <col style={{ width: '10%' }} />}{isColumnVisible('assignee') && <col style={{ width: '17%' }} />}{isColumnVisible('est_hours') && <col style={{ width: '6%' }} />}{isColumnVisible('actual_hours') && <col style={{ width: '7%' }} />}{isColumnVisible('due_date') && <col style={{ width: '9%' }} />}{isColumnVisible('attachments') && <col style={{ width: '6%' }} />}<col style={{ width: '8%' }} /></colgroup>

                {/* Phase header row */}
                <thead>
                  <tr
                    className="bg-white hover:bg-gray-50 cursor-pointer transition-colors"
                    onClick={() => togglePhase(phaseGroup.phase.phase_id)}
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
                                <h4 className="font-semibold text-gray-900">{phaseGroup.phase.phase_name}</h4>
                                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-700">
                                  {phaseGroup.totalTasks} {phaseGroup.totalTasks === 1 ? 'task' : 'tasks'}
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
                                  variant="default"
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
                            const checklist = checklistItems[task.task_id];
                            const docCount = documentCounts[task.task_id] || 0;
                            const isDragging = draggedTask?.task_id === task.task_id;
                            const showDropIndicator = isDropTarget && dropIndicatorIndex === taskIndex;

                            return (
                              <React.Fragment key={task.task_id}>
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
                                    <div>
                                      <button
                                        type="button"
                                        className={`text-sm font-medium text-gray-900 hover:text-primary-600 hover:underline cursor-pointer text-left max-w-full block ${!expandedTitles.has(task.task_id) ? 'truncate' : ''}`}
                                        onClick={() => onTaskClick(task)}
                                        title={!expandedTitles.has(task.task_id) ? task.task_name : undefined}
                                      >
                                        {highlightSearchMatch(task.task_name, searchQuery, searchCaseSensitive)}
                                      </button>
                                      {task.task_name.length > 50 && (
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setExpandedTitles(prev => {
                                              const newSet = new Set(prev);
                                              if (newSet.has(task.task_id)) {
                                                newSet.delete(task.task_id);
                                              } else {
                                                newSet.add(task.task_id);
                                              }
                                              return newSet;
                                            });
                                          }}
                                          className="text-xs text-purple-600 hover:text-purple-700 font-medium mt-0.5"
                                        >
                                          {expandedTitles.has(task.task_id) ? 'See less' : 'See more'}
                                        </button>
                                      )}
                                    </div>
                                    {task.description && (
                                      <div className="mt-0.5">
                                        <p
                                          className={`text-xs text-gray-500 ${!expandedDescriptions.has(task.task_id) ? 'line-clamp-1' : ''}`}
                                          title={!expandedDescriptions.has(task.task_id) ? task.description : undefined}
                                        >
                                          {highlightSearchMatch(task.description, searchQuery, searchCaseSensitive)}
                                        </p>
                                        {task.description.length > 80 && (
                                          <button
                                            type="button"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              setExpandedDescriptions(prev => {
                                                const newSet = new Set(prev);
                                                if (newSet.has(task.task_id)) {
                                                  newSet.delete(task.task_id);
                                                } else {
                                                  newSet.add(task.task_id);
                                                }
                                                return newSet;
                                              });
                                            }}
                                            className="text-xs text-purple-600 hover:text-purple-700 font-medium mt-0.5"
                                          >
                                            {expandedDescriptions.has(task.task_id) ? 'See less' : 'See more'}
                                          </button>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                </td>

                                {/* Dependencies */}
                                {isColumnVisible('deps') && (
                                  <td className="py-3 px-3">
                                    {(() => {
                                      const deps = taskDependencies[task.task_id];
                                      const hasDependencies = deps && (deps.predecessors.length > 0 || deps.successors.length > 0);
                                      const dependencyTooltipContent = renderDependenciesTooltipContent(task.task_id);
                                      if (!hasDependencies || !dependencyTooltipContent) return null;
                                      return (
                                        <Tooltip content={dependencyTooltipContent}>
                                          <div className="flex items-center gap-1 cursor-help">
                                            {getDependencyIcon(task.task_id)}
                                            <span className="text-xs text-gray-500">
                                              {(deps?.predecessors.length || 0) + (deps?.successors.length || 0)}
                                            </span>
                                          </div>
                                        </Tooltip>
                                      );
                                    })()}
                                  </td>
                                )}

                                {/* Checklist */}
                                {isColumnVisible('checklist') && (
                                  <td className="py-3 px-3">
                                    {checklist && checklist.total > 0 && (
                                      <Tooltip
                                        content={
                                          checklist.items && checklist.items.length > 0 ? (
                                            <div className="text-xs space-y-1 max-w-xs">
                                              <div className="font-medium text-gray-300 mb-1">Checklist Items:</div>
                                              {checklist.items.map((item, i) => (
                                                <div key={i} className="flex items-center gap-1.5">
                                                  {item.completed ? (
                                                    <CheckSquare className="h-3 w-3 text-green-400" />
                                                  ) : (
                                                    <CheckSquare className="h-3 w-3 text-gray-400" />
                                                  )}
                                                  <span className={item.completed ? 'line-through text-gray-400' : ''}>{item.item_name}</span>
                                                </div>
                                              ))}
                                            </div>
                                          ) : (
                                            <span>{checklist.completed} of {checklist.total} complete</span>
                                          )
                                        }
                                      >
                                        <div className="flex items-center gap-1 text-gray-600 cursor-help">
                                          <CheckSquare className="h-3.5 w-3.5" />
                                          <span className="text-xs">
                                            {checklist.completed}/{checklist.total}
                                          </span>
                                        </div>
                                      </Tooltip>
                                    )}
                                  </td>
                                )}

                                {/* Tags */}
                                {isColumnVisible('tags') && (
                                  <td className="py-3 px-3" onClick={(e) => e.stopPropagation()}>
                                    {onTaskTagsChange ? (
                                      <TagManager
                                        id={`task-tags-list-${task.task_id}`}
                                        entityId={task.task_id}
                                        entityType="project_task"
                                        initialTags={tags}
                                        onTagsChange={(newTags) => onTaskTagsChange(task.task_id, newTags)}
                                      />
                                    ) : tags.length > 0 ? (
                                      <TagList
                                        tags={tags}
                                        maxDisplay={2}
                                      />
                                    ) : null}
                                  </td>
                                )}

                                {/* Assignee */}
                                {isColumnVisible('assignee') && (
                                  <td className="py-3 px-3" onClick={(e) => e.stopPropagation()}>
                                    <div className="flex items-center gap-1.5">
                                      {onAssigneeChange ? (
                                        <UserPicker
                                          value={task.assigned_to || ''}
                                          onValueChange={(newAssigneeId) => onAssigneeChange(task.task_id, newAssigneeId)}
                                          size="sm"
                                          users={users.filter(u =>
                                            !resources.some(r => r.additional_user_id === u.user_id)
                                          )}
                                        />
                                      ) : (
                                        (() => {
                                          const user = task.assigned_to ? users.find(u => u.user_id === task.assigned_to) : null;
                                          if (user) {
                                            return (
                                              <>
                                                <UserAvatar
                                                  userId={user.user_id}
                                                  userName={`${user.first_name} ${user.last_name}`}
                                                  avatarUrl={avatarUrls[user.user_id] ?? null}
                                                  size="xs"
                                                />
                                                <span className="text-sm text-gray-700 truncate">
                                                  {user.first_name} {user.last_name}
                                                </span>
                                              </>
                                            );
                                          }
                                          return (
                                            <span className="text-sm text-gray-400">Unassigned</span>
                                          );
                                        })()
                                      )}
                                      {additionalCount > 0 && (
                                        <Tooltip
                                          content={
                                            <div className="text-xs space-y-1.5">
                                              <div className="font-medium text-gray-300 mb-1">Additional Agents:</div>
                                              {resources.map((resource, i) => {
                                                const resourceUser = users.find(u => u.user_id === resource.additional_user_id);
                                                const userName = resourceUser ? `${resourceUser.first_name} ${resourceUser.last_name}` : 'Unknown';
                                                return (
                                                  <div key={i} className="flex items-center gap-2">
                                                    <UserAvatar
                                                      userId={resource.additional_user_id}
                                                      userName={userName}
                                                      avatarUrl={avatarUrls[resource.additional_user_id] ?? null}
                                                      size="xs"
                                                    />
                                                    <span>
                                                      {userName}
                                                      {resource.role && <span className="text-gray-400"> ({resource.role})</span>}
                                                    </span>
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
                                            +{additionalCount}
                                          </span>
                                        </Tooltip>
                                      )}
                                    </div>
                                  </td>
                                )}

                                {/* Est. Hours */}
                                {isColumnVisible('est_hours') && (
                                  <td className="py-3 px-3">
                                    <span className="text-sm text-gray-700">
                                      {task.estimated_hours != null ? (task.estimated_hours / 60).toFixed(1) : '-'}
                                    </span>
                                  </td>
                                )}

                                {/* Actual Hours */}
                                {isColumnVisible('actual_hours') && (
                                  <td className="py-3 px-3">
                                    <span className="text-sm text-gray-700">
                                      {task.actual_hours != null ? (task.actual_hours / 60).toFixed(1) : '-'}
                                    </span>
                                  </td>
                                )}

                                {/* Due Date */}
                                {isColumnVisible('due_date') && (
                                  <td className="py-3 px-3">
                                    {task.due_date && (
                                      <span className="text-sm text-gray-700">
                                        {format(new Date(task.due_date), 'MMM d, yyyy')}
                                      </span>
                                    )}
                                  </td>
                                )}

                                {/* Attachments */}
                                {isColumnVisible('attachments') && (
                                  <td className="py-3 px-3">
                                    {docCount > 0 && (
                                      <div className="flex items-center gap-1 text-gray-600">
                                        <Paperclip className="h-3.5 w-3.5" />
                                        <span className="text-xs">{docCount}</span>
                                      </div>
                                    )}
                                  </td>
                                )}

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
                              <td colSpan={visibleColumnCount} className="h-2">
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
              variant="default"
              size="sm"
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
                variant="default"
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
