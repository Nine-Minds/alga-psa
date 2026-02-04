'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { IProject, IProjectPhase, IProjectTask, IProjectTicketLink, IProjectTicketLinkWithDetails, ProjectStatus, ITaskType, IProjectTaskDependency } from '@alga-psa/types';
import { IUserWithRoles } from '@alga-psa/types';
import { IPriority, IStandardPriority } from '@alga-psa/types';
import { ITag } from '@alga-psa/types';
import { ITaskResource } from '@alga-psa/types';
import { useDrawer } from "@alga-psa/ui";
import { getAllPriorities } from '@alga-psa/reference-data/actions';
import { getTaskTypes } from '../actions/projectTaskActions';
import { findTagsByEntityId, findTagsByEntityIds } from '@alga-psa/tags/actions';
import { getDocumentCountsForEntities } from '@alga-psa/documents/actions/documentActions';
import { TagFilter } from '@alga-psa/ui/components';
import { TagManager } from '@alga-psa/tags/components';
import { useTags } from '@alga-psa/tags/context';
import { useTagPermissions } from '@alga-psa/tags/hooks';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import MultiUserPicker from '@alga-psa/ui/components/MultiUserPicker';
import { Button } from '@alga-psa/ui/components/Button';
import TaskQuickAdd from './TaskQuickAdd';
import TaskEdit from './TaskEdit';
import PhaseQuickAdd from './PhaseQuickAdd';
import TaskListView from './TaskListView';
import ViewSwitcher from '@alga-psa/ui/components/ViewSwitcher';
import { getProjectTaskStatuses, updatePhase, deletePhase, getProjectTreeData, reorderPhase } from '../actions/projectActions';
import { updateTaskStatus, reorderTask, reorderTasksInStatus, moveTaskToPhase, updateTaskWithChecklist, getTaskChecklistItems, getTaskResourcesAction, getTaskTicketLinksAction, duplicateTaskToPhase, deleteTask as deleteTaskAction, getTasksForPhase, getTaskById, getAllProjectTasksForListView, getPhaseTaskCounts } from '../actions/projectTaskActions';
import styles from './ProjectDetail.module.css';
import { Toaster, toast } from 'react-hot-toast';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import DuplicateTaskDialog, { DuplicateOptions } from './DuplicateTaskDialog';
import MoveTaskDialog from './MoveTaskDialog';
import ProjectPhases from './ProjectPhases';
import PhaseTaskImportDialog from './PhaseTaskImportDialog';
import KanbanBoard from './KanbanBoard';
import KanbanZoomControl from './KanbanZoomControl';
import DonutChart from './DonutChart';
import { calculateProjectCompletion } from '@alga-psa/projects/lib/projectUtils';
import { IClient } from '@alga-psa/types';
import { ChevronRight, HelpCircle, LayoutGrid, List, Search, Pin, X, XCircle, CheckSquare, Bug, Sparkles, TrendingUp, Flag, BookOpen } from 'lucide-react';
import { Tooltip } from '@alga-psa/ui/components/Tooltip';
import { generateKeyBetween } from 'fractional-indexing';
import KanbanBoardSkeleton from '@alga-psa/ui/components/skeletons/KanbanBoardSkeleton';
import { useUserPreference } from '@alga-psa/users/hooks';
import { getUserAvatarUrlsBatchAction } from '@alga-psa/users/actions';

const PROJECT_VIEW_MODE_SETTING = 'project_detail_view_mode';
const PROJECT_PHASES_PANEL_VISIBLE_SETTING = 'project_phases_panel_visible';
const PROJECT_KANBAN_ZOOM_LEVEL_SETTING = 'project_kanban_zoom_level';
const PROJECT_HEADER_PINNED_SETTING = 'project_header_pinned';

// Task type icons for the filter dropdown
const taskTypeIcons: Record<string, React.ComponentType<any>> = {
  task: CheckSquare,
  bug: Bug,
  feature: Sparkles,
  improvement: TrendingUp,
  epic: Flag,
  story: BookOpen
};

// Auto-scroll configuration for drag operations
const SCROLL_THRESHOLD = 100; // Pixels from edge to start scrolling
const MAX_SCROLL_SPEED = 20; // Maximum scroll speed in pixels per frame

interface ProjectDetailProps {
  project: IProject;
  phases: IProjectPhase[];
  statuses: ProjectStatus[];
  users: IUserWithRoles[];
  clients: IClient[];
  contact?: { full_name: string };
  assignedUser?: IUserWithRoles;
  onTagsUpdate?: (tags: ITag[], allTagTexts: string[]) => void;
  initialTaskId?: string | null;
  initialPhaseId?: string | null;
  onUrlUpdate?: (phaseId: string | null, taskId: string | null) => void;
}

export default function ProjectDetail({
  project,
  phases,
  statuses: initialStatuses,
  users,
  clients,
  contact,
  assignedUser,
  onTagsUpdate,
  initialTaskId,
  initialPhaseId,
  onUrlUpdate
}: ProjectDetailProps) {
  useTagPermissions(['project', 'project_task']);

  // View mode state with persistence
  type ProjectViewMode = 'kanban' | 'list';
  const {
    value: viewMode,
    setValue: setViewMode,
    isLoading: isViewModeLoading
  } = useUserPreference<ProjectViewMode>(
    PROJECT_VIEW_MODE_SETTING,
    {
      defaultValue: 'kanban',
      localStorageKey: PROJECT_VIEW_MODE_SETTING,
      debounceMs: 300
    }
  );

  // Phases panel visibility state with persistence (default: visible)
  const {
    value: isPhasesPanelVisible,
    setValue: setIsPhasesPanelVisible,
  } = useUserPreference<boolean>(
    PROJECT_PHASES_PANEL_VISIBLE_SETTING,
    {
      defaultValue: true,
      localStorageKey: PROJECT_PHASES_PANEL_VISIBLE_SETTING,
      debounceMs: 300
    }
  );

  // Kanban zoom level state with persistence (default: 50 = 350px columns)
  const {
    value: kanbanZoomLevel,
    setValue: setKanbanZoomLevel,
  } = useUserPreference<number>(
    PROJECT_KANBAN_ZOOM_LEVEL_SETTING,
    {
      defaultValue: 50,
      localStorageKey: PROJECT_KANBAN_ZOOM_LEVEL_SETTING,
      debounceMs: 300
    }
  );

  // Header pinned state with persistence (default: false - not pinned/sticky)
  const {
    value: isHeaderPinned,
    setValue: setIsHeaderPinned,
  } = useUserPreference<boolean>(
    PROJECT_HEADER_PINNED_SETTING,
    {
      defaultValue: false,
      localStorageKey: PROJECT_HEADER_PINNED_SETTING,
      debounceMs: 300
    }
  );

  // Kanban view state (existing - phase-scoped)
  const [selectedTask, setSelectedTask] = useState<IProjectTask | null>(null);
  const selectedTaskIdRef = useRef<string | null>(null); // Ref for reliable access in callbacks
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [showPhaseQuickAdd, setShowPhaseQuickAdd] = useState(false);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [currentPhase, setCurrentPhase] = useState<IProjectPhase | null>(null);
  const [selectedPhase, setSelectedPhase] = useState<IProjectPhase | null>(null);

  // List view state (separate - project-scoped)
  const [listViewData, setListViewData] = useState<{
    phases: IProjectPhase[];
    tasks: IProjectTask[];
    statuses: ProjectStatus[];
    ticketLinks: Record<string, IProjectTicketLinkWithDetails[]>;
    taskResources: Record<string, ITaskResource[]>;
    checklistItems: Record<string, any[]>;
    taskTags: Record<string, ITag[]>;
    taskDependencies: Record<string, { predecessors: IProjectTaskDependency[]; successors: IProjectTaskDependency[] }>;
  } | null>(null);
  const [listViewLoading, setListViewLoading] = useState(false);
  const { openDrawer: _openDrawer, closeDrawer: _closeDrawer } = useDrawer();
  const [projectTasks, setProjectTasks] = useState<IProjectTask[]>([]);
  const [phaseTicketLinks, setPhaseTicketLinks] = useState<{ [taskId: string]: IProjectTicketLinkWithDetails[] }>({});
  const [phaseTaskResources, setPhaseTaskResources] = useState<{ [taskId: string]: any[] }>({});
  const [phaseTaskDependencies, setPhaseTaskDependencies] = useState<{ [taskId: string]: { predecessors: IProjectTaskDependency[]; successors: IProjectTaskDependency[] } }>({});
  const [avatarUrls, setAvatarUrls] = useState<Record<string, string | null>>({});
  const [projectPhases, setProjectPhases] = useState<IProjectPhase[]>(phases);
  const [projectStatuses, setProjectStatuses] = useState<ProjectStatus[]>(initialStatuses);
  const [isLoadingTasks, setIsLoadingTasks] = useState(false);
  const [isAddingTask, setIsAddingTask] = useState(false);
  const [defaultStatus, setDefaultStatus] = useState<ProjectStatus | null>(null);
  const [editingPhaseId, setEditingPhaseId] = useState<string | null>(null);
  const [editingPhaseName, setEditingPhaseName] = useState('');
  const [editingStartDate, setEditingStartDate] = useState<Date | undefined>(undefined);
  const [editingEndDate, setEditingEndDate] = useState<Date | undefined>(undefined);
  const [editingPhaseDescription, setEditingPhaseDescription] = useState<string | null>(null);
  const [phaseDropTarget, setPhaseDropTarget] = useState<{
    phaseId: string;
    position: 'before' | 'after';
  } | null>(null);
  const [moveConfirmation, setMoveConfirmation] = useState<{
    taskId: string;
    taskName: string;
    sourcePhase: IProjectPhase;
    targetPhase: IProjectPhase;
  } | null>(null);

  const [deletePhaseConfirmation, setDeletePhaseConfirmation] = useState<{
    phaseId: string;
    phaseName: string;
  } | null>(null);
  
  const [projectMetrics, setProjectMetrics] = useState<{
    taskCompletionPercentage: number;
    hoursCompletionPercentage: number;
    budgetedHours: number;
    spentHours: number;
    remainingHours: number;
  } | null>(null);
 
  // State for the Move Task Dialog
  const [isMoveTaskDialogOpen, setIsMoveTaskDialogOpen] = useState(false);
  const [taskToMove, setTaskToMove] = useState<IProjectTask | null>(null);
  const [isDuplicateDialogOpen, setIsDuplicateDialogOpen] = useState(false);
  const [taskToDuplicate, setTaskToDuplicate] = useState<IProjectTask | null>(null);
  const [animatingTasks, setAnimatingTasks] = useState<Set<string>>(new Set());
  const [animatingPhases, setAnimatingPhases] = useState<Set<string>>(new Set());
  const [taskDraggingOverPhaseId, setTaskDraggingOverPhaseId] = useState<string | null>(null); // Added state

  // All project tasks for phase count filtering (like list view)
  const [allProjectTasks, setAllProjectTasks] = useState<IProjectTask[]>([]);
  const [allProjectTaskResources, setAllProjectTaskResources] = useState<Record<string, ITaskResource[]>>({});
  const [allProjectTaskTags, setAllProjectTaskTags] = useState<Record<string, ITag[]>>({});

  // Tag-related state
  const [projectTags, setProjectTags] = useState<ITag[]>([]);
  const { tags: allTags } = useTags();
  const hasNotifiedParent = useRef(false);
  const hasOpenedInitialTask = useRef(false);
  
  // Auto-select phase based on URL param or default to first phase
  useEffect(() => {
    // Don't auto-select if we have an initialTaskId - that case is handled separately
    if (initialTaskId) return;

    // Only auto-select if we have phases but none is selected yet
    if (projectPhases.length > 0 && !selectedPhase) {
      // Sort phases by order_key
      const sortedPhases = [...projectPhases].sort((a, b) => {
        const aKey = a.order_key || 'zzz';
        const bKey = b.order_key || 'zzz';
        return aKey < bKey ? -1 : aKey > bKey ? 1 : 0;
      });

      // If we have an initialPhaseId from URL, use that phase
      let phaseToSelect = sortedPhases[0];
      if (initialPhaseId) {
        const phaseFromUrl = projectPhases.find(p => p.phase_id === initialPhaseId);
        if (phaseFromUrl) {
          phaseToSelect = phaseFromUrl;
        }
      }

      setSelectedPhase(phaseToSelect);
      setCurrentPhase(phaseToSelect);

      // Update URL if we selected a phase and no phaseId was in the URL
      if (!initialPhaseId && onUrlUpdate) {
        onUrlUpdate(phaseToSelect.phase_id, null);
      }
    }
  }, [projectPhases, initialTaskId, initialPhaseId]); // Intentionally exclude selectedPhase to avoid re-triggering

  // Fetch tags when component mounts
  useEffect(() => {
    const fetchTags = async () => {
      if (!project.project_id) return;

      try {
        const tags = await findTagsByEntityId(project.project_id, 'project').catch((error) => {
          console.warn('Failed to fetch project tags, continuing without tags:', error);
          return [];
        });

        setProjectTags(tags);

        // Notify parent component of tags update only once
        if (onTagsUpdate && !hasNotifiedParent.current) {
          const projectTagTexts = allTags.filter(tag => tag.tagged_type === 'project').map(tag => tag.tag_text);
          onTagsUpdate(tags, projectTagTexts);
          hasNotifiedParent.current = true;
        }
      } catch (error) {
        console.error('Error fetching project tags:', error);
      }
    };
    fetchTags();
  }, [project.project_id]); // Remove onTagsUpdate from dependencies to prevent infinite loop
  const [duplicateTaskToggleDetails, setDuplicateTaskToggleDetails] = useState<{
      hasChecklist: boolean;
      hasPrimaryAssignee: boolean;
      additionalAssigneeCount: number;
      ticketLinkCount: number;
  } | null>(null);

  const [taskToDelete, setTaskToDelete] = useState<IProjectTask | null>(null);
  const [priorities, setPriorities] = useState<(IPriority | IStandardPriority)[]>([]);
  const [taskTypes, setTaskTypes] = useState<ITaskType[]>([]);
  const [selectedPriorityFilter, setSelectedPriorityFilter] = useState<string>('all');
  const [selectedTaskTypeFilter, setSelectedTaskTypeFilter] = useState<string>('all');
  const [selectedTaskTags, setSelectedTaskTags] = useState<string[]>([]);
  const [selectedAgentFilter, setSelectedAgentFilter] = useState<string[]>([]);
  const [includeUnassignedAgents, setIncludeUnassignedAgents] = useState<boolean>(false);
  const [primaryAgentOnly, setPrimaryAgentOnly] = useState<boolean>(false);

  // Reset primaryAgentOnly when agent selection changes away from exactly one agent
  const handleAgentFilterChange = (newValues: string[]) => {
    setSelectedAgentFilter(newValues);
    if (newValues.length !== 1) {
      setPrimaryAgentOnly(false);
    }
  };
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [searchWholeWord, setSearchWholeWord] = useState<boolean>(false);
  const [searchCaseSensitive, setSearchCaseSensitive] = useState<boolean>(false);
  const [taskTags, setTaskTags] = useState<Record<string, ITag[]>>({});
  const [allTaskTags, setAllTaskTags] = useState<ITag[]>([]);
  const [taskDocumentCounts, setTaskDocumentCounts] = useState<Map<string, number>>(new Map());

  const filteredTasks = useMemo(() => {
    if (!selectedPhase) return [];
    let tasks = projectTasks.filter(task => task.wbs_code.startsWith(selectedPhase.wbs_code + '.'));

    // Apply search filter
    if (searchQuery.trim()) {
      const query = searchCaseSensitive ? searchQuery : searchQuery.toLowerCase();
      tasks = tasks.filter(task => {
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
      tasks = tasks.filter(task => task.priority_id === selectedPriorityFilter);
    }

    // Apply task type filter
    if (selectedTaskTypeFilter !== 'all') {
      tasks = tasks.filter(task => task.task_type_key === selectedTaskTypeFilter);
    }

    // Apply tag filter
    if (selectedTaskTags.length > 0) {
      tasks = tasks.filter(task => {
        const tags = taskTags[task.task_id] || [];
        const tagTexts = tags.map(tag => tag.tag_text);
        return selectedTaskTags.some(selectedTag => tagTexts.includes(selectedTag));
      });
    }

    // Apply agent filter
    if (selectedAgentFilter.length > 0 || includeUnassignedAgents) {
      tasks = tasks.filter(task => {
        // Check if task is unassigned (no primary assignee)
        const isUnassigned = !task.assigned_to;

        // If includeUnassignedAgents is selected and task is unassigned, include it
        if (includeUnassignedAgents && isUnassigned) {
          return true;
        }

        // If specific agents are selected, check if task matches
        if (selectedAgentFilter.length > 0) {
          // Check primary assignee
          if (task.assigned_to && selectedAgentFilter.includes(task.assigned_to)) {
            return true;
          }

          // Check additional agents from task resources (only if not filtering for primary only)
          // Primary only filter is only applicable when exactly one agent is selected
          if (!(primaryAgentOnly && selectedAgentFilter.length === 1)) {
            const resources = phaseTaskResources[task.task_id] || [];
            const hasMatchingAdditionalAgent = resources.some(
              resource => resource.additional_user_id && selectedAgentFilter.includes(resource.additional_user_id)
            );
            if (hasMatchingAdditionalAgent) {
              return true;
            }
          }
        }

        return false;
      });
    }

    return tasks;
  }, [projectTasks, selectedPhase, searchQuery, searchWholeWord, searchCaseSensitive, selectedPriorityFilter, selectedTaskTypeFilter, selectedTaskTags, taskTags, selectedAgentFilter, includeUnassignedAgents, primaryAgentOnly, phaseTaskResources]);

  const completedTasksCount = useMemo(() => {
    return filteredTasks.filter(task =>
      projectStatuses.find(status => status.project_status_mapping_id === task.project_status_mapping_id)?.is_closed === true
    ).length;
  }, [filteredTasks, projectStatuses]);

  // Task counts per phase for the phase sidebar (fetched from server)
  const [phaseTaskCounts, setPhaseTaskCounts] = useState<Record<string, number>>({});

  // Fetch task counts for all phases when component loads
  useEffect(() => {
    const fetchTaskCounts = async () => {
      try {
        const counts = await getPhaseTaskCounts(project.project_id);
        setPhaseTaskCounts(counts);
      } catch (error) {
        console.error('Error fetching phase task counts:', error);
      }
    };
    fetchTaskCounts();
  }, [project.project_id]);

  // Load all project tasks for phase count filtering (like list view does)
  useEffect(() => {
    const fetchAllProjectTasks = async () => {
      try {
        const data = await getAllProjectTasksForListView(project.project_id);
        setAllProjectTasks(data.tasks);
        setAllProjectTaskResources(data.taskResources);
        setAllProjectTaskTags(data.taskTags);
      } catch (error) {
        console.error('Error fetching all project tasks:', error);
      }
    };
    fetchAllProjectTasks();
  }, [project.project_id]);

  // Filter all project tasks (same logic as list view) for phase count calculation
  const allFilteredTasks = useMemo(() => {
    let filtered = allProjectTasks;

    // Apply search filter
    if (searchQuery.trim()) {
      const query = searchCaseSensitive ? searchQuery : searchQuery.toLowerCase();
      filtered = filtered.filter(task => {
        const taskName = searchCaseSensitive ? task.task_name : task.task_name.toLowerCase();
        const taskDescription = searchCaseSensitive
          ? (task.description ?? '')
          : (task.description?.toLowerCase() ?? '');

        if (searchWholeWord) {
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

    // Apply task type filter
    if (selectedTaskTypeFilter !== 'all') {
      filtered = filtered.filter(task => task.task_type_key === selectedTaskTypeFilter);
    }

    // Apply tag filter
    if (selectedTaskTags.length > 0) {
      filtered = filtered.filter(task => {
        const tags = allProjectTaskTags[task.task_id] || [];
        const tagTexts = tags.map(tag => tag.tag_text);
        return selectedTaskTags.some(selectedTag => tagTexts.includes(selectedTag));
      });
    }

    // Apply agent filter
    if (selectedAgentFilter.length > 0 || includeUnassignedAgents) {
      filtered = filtered.filter(task => {
        const isUnassigned = !task.assigned_to;

        if (includeUnassignedAgents && isUnassigned) {
          return true;
        }

        if (selectedAgentFilter.length > 0) {
          if (task.assigned_to && selectedAgentFilter.includes(task.assigned_to)) {
            return true;
          }

          if (!(primaryAgentOnly && selectedAgentFilter.length === 1)) {
            const resources = allProjectTaskResources[task.task_id] || [];
            const hasMatchingAdditionalAgent = resources.some(
              resource => resource.additional_user_id && selectedAgentFilter.includes(resource.additional_user_id)
            );
            if (hasMatchingAdditionalAgent) {
              return true;
            }
          }
        }

        return false;
      });
    }

    return filtered;
  }, [allProjectTasks, searchQuery, searchWholeWord, searchCaseSensitive, selectedPriorityFilter, selectedTaskTypeFilter, selectedTaskTags, allProjectTaskTags, selectedAgentFilter, includeUnassignedAgents, primaryAgentOnly, allProjectTaskResources]);

  // Calculate filtered phase task counts (like list view's phaseGroups)
  // Falls back to server-fetched counts while allProjectTasks is loading
  const filteredPhaseTaskCounts = useMemo(() => {
    // If allProjectTasks hasn't loaded yet, use server-fetched counts
    if (allProjectTasks.length === 0 && Object.keys(phaseTaskCounts).length > 0) {
      return phaseTaskCounts;
    }
    const counts: Record<string, number> = {};
    allFilteredTasks.forEach(task => {
      if (task.phase_id) {
        counts[task.phase_id] = (counts[task.phase_id] || 0) + 1;
      }
    });
    return counts;
  }, [allFilteredTasks, allProjectTasks, phaseTaskCounts]);

  const [projectTreeData, setProjectTreeData] = useState<any[]>([]);
  const kanbanBoardRef = useRef<HTMLDivElement>(null);
  const scrollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const scrollSpeedsRef = useRef<{ horizontal: number; vertical: number; column: HTMLElement | null }>({
    horizontal: 0,
    vertical: 0,
    column: null
  });

  useEffect(() => {
    return () => {
      if (scrollIntervalRef.current) {
        clearInterval(scrollIntervalRef.current);
      }
    };
  }, []);

  // Lazy load list view data when switching to list mode
  const loadListViewData = useCallback(async () => {
    if (listViewLoading || listViewData) return;
    setListViewLoading(true);
    try {
      const data = await getAllProjectTasksForListView(project.project_id);
      setListViewData(data);
    } catch (error) {
      console.error('Error loading list view data:', error);
      toast.error('Failed to load list view data');
    } finally {
      setListViewLoading(false);
    }
  }, [project.project_id, listViewData, listViewLoading]);

  useEffect(() => {
    if (viewMode === 'list') {
      loadListViewData();
    }
  }, [viewMode, loadListViewData]);

  // Keep selectedTaskIdRef in sync with selectedTask for reliable access in callbacks
  useEffect(() => {
    selectedTaskIdRef.current = selectedTask?.task_id ?? null;
  }, [selectedTask]);

  // Refresh list view after task mutations
  const refreshListView = useCallback(() => {
    setListViewData(null); // Force reload on next render
  }, []);

  // Handle task move in list view (drag-and-drop)
  const handleListViewTaskMove = useCallback(async (
    taskId: string,
    newStatusMappingId: string,
    newPhaseId: string,
    beforeTaskId: string | null,
    afterTaskId: string | null
  ) => {
    try {
      const task = listViewData?.tasks.find(t => t.task_id === taskId);
      if (!task) {
        console.error('Task not found');
        return;
      }

      // Check if we're moving to a different phase
      if (task.phase_id !== newPhaseId) {
        // Move to different phase with new status
        await moveTaskToPhase(taskId, newPhaseId, newStatusMappingId);
        // Update allProjectTasks for filtered counts
        setAllProjectTasks(prev => prev.map(t =>
          t.task_id === taskId ? { ...t, phase_id: newPhaseId, project_status_mapping_id: newStatusMappingId } : t
        ));
        toast.success('Task moved to new phase');
      } else if (task.project_status_mapping_id !== newStatusMappingId) {
        // Same phase, different status
        await updateTaskStatus(taskId, newStatusMappingId, beforeTaskId, afterTaskId);
        toast.success('Task status updated');
      } else {
        // Same phase and status - just reorder
        await reorderTask(taskId, beforeTaskId, afterTaskId);
        toast.success('Task reordered');
      }

      // Refresh list view to show updated data
      refreshListView();
    } catch (error) {
      console.error('Error moving task:', error);
      toast.error('Failed to move task');
    }
  }, [listViewData, refreshListView]);
  
  // Handle tag changes
  const handleProjectTagsChange = (tags: ITag[]) => {
    setProjectTags(tags);
    if (onTagsUpdate) {
      const projectTagTexts = allTags.filter(tag => tag.tagged_type === 'project').map(tag => tag.tag_text);
      onTagsUpdate(tags, projectTagTexts);
    }
  };
  
  // Handle task tag changes
  const handleTaskTagsChange = (taskId: string, tags: ITag[]) => {
    // Update kanban view tags
    setTaskTags(prev => ({
      ...prev,
      [taskId]: tags
    }));

    // Update all unique tags
    setAllTaskTags(current => {
      const currentTagTexts = new Set(current.map(t => t.tag_text));
      const newTags = tags.filter(tag => !currentTagTexts.has(tag.tag_text));
      return [...current, ...newTags];
    });

    // Update list view data if it exists
    if (listViewData) {
      setListViewData(prev => prev ? {
        ...prev,
        taskTags: {
          ...prev.taskTags,
          [taskId]: tags
        }
      } : null);
    }
  };
  
  // Fetch project completion metrics and project tree data
  useEffect(() => {
    const fetchInitialData = async () => {
      try {
        // Fetch project metrics
        const metrics = await calculateProjectCompletion(project.project_id);
        setProjectMetrics({
          taskCompletionPercentage: metrics.taskCompletionPercentage,
          hoursCompletionPercentage: metrics.hoursCompletionPercentage,
          budgetedHours: metrics.budgetedHours,
          spentHours: metrics.spentHours,
          remainingHours: metrics.remainingHours
        });
        
        // Fetch project tree data once
        const treeData = await getProjectTreeData();
        setProjectTreeData(treeData);
        
        // Fetch priorities for project tasks
        const allPriorities = await getAllPriorities('project_task');
        setPriorities(allPriorities);

        // Fetch task types
        const types = await getTaskTypes();
        setTaskTypes(types);
      } catch (error) {
        console.error('Error fetching initial data:', error);
        toast.error('Failed to load initial data');
      }
    };
    
    fetchInitialData();
  }, [project.project_id]);
  
  // Fetch tags for all tasks
  useEffect(() => {
    const fetchTaskTags = async () => {
      if (projectTasks.length === 0) return;
      
      try {
        const taskIds = projectTasks.map(task => task.task_id);
        // Add error handling for the server action call
        const tags = await findTagsByEntityIds(taskIds, 'project_task').catch((error) => {
          console.warn('Failed to fetch task tags, continuing without tags:', error);
          return [];
        });
        
        // Group tags by task
        const tagsByTask: Record<string, ITag[]> = {};
        tags.forEach((tag: ITag) => {
          if (!tagsByTask[tag.tagged_id]) {
            tagsByTask[tag.tagged_id] = [];
          }
          tagsByTask[tag.tagged_id].push(tag);
        });
        
        setTaskTags(tagsByTask);
        // Get unique task tags by tag_text to prevent duplicates
        const taskTagsMap = new Map<string, ITag>();
        allTags
          .filter(tag => tag.tagged_type === 'project_task')
          .forEach(tag => {
            // Only keep the first occurrence of each tag text
            if (!taskTagsMap.has(tag.tag_text)) {
              taskTagsMap.set(tag.tag_text, tag);
            }
          });
        setAllTaskTags(Array.from(taskTagsMap.values()));
      } catch (error) {
        console.error('Error fetching task tags:', error);
      }
    };
    
    fetchTaskTags();
  }, [projectTasks, allTags]);

  // Update task tags when global tags change (for color updates)
  useEffect(() => {
    if (Object.keys(taskTags).length > 0 && allTags.length > 0) {
      const updatedTaskTags: Record<string, ITag[]> = {};
      let hasChanges = false;
      
      Object.entries(taskTags).forEach(([taskId, tags]) => {
        const updatedTags = tags.map(localTag => {
          const globalTag = allTags.find(gt => gt.tag_text === localTag.tag_text && gt.tagged_type === 'project_task');
          if (globalTag && (globalTag.background_color !== localTag.background_color || globalTag.text_color !== localTag.text_color)) {
            hasChanges = true;
            return { ...localTag, background_color: globalTag.background_color, text_color: globalTag.text_color };
          }
          return localTag;
        });
        updatedTaskTags[taskId] = updatedTags;
      });
      
      if (hasChanges) {
        setTaskTags(updatedTaskTags);
      }
    }
  }, [allTags]);

  // Fetch tasks when phase is selected
  useEffect(() => {
    const fetchPhaseTasks = async () => {
      if (!selectedPhase) {
        setProjectTasks([]);
        setPhaseTicketLinks({});
        setPhaseTaskResources({});
        setPhaseTaskDependencies({});
        return;
      }

      setIsLoadingTasks(true);
      try {
        const { tasks, ticketLinks, taskResources, taskDependencies, checklistItems } = await getTasksForPhase(selectedPhase.phase_id);

        // Add checklist items to tasks from batch-loaded data
        const tasksWithChecklists = tasks.map((task) => ({
          ...task,
          checklist_items: checklistItems[task.task_id] || []
        }));

        setProjectTasks(tasksWithChecklists);
        setPhaseTicketLinks(ticketLinks);
        setPhaseTaskResources(taskResources);
        setPhaseTaskDependencies(taskDependencies);
      } catch (error) {
        console.error('Error fetching phase tasks:', error);
        toast.error('Failed to load tasks for the selected phase');
      } finally {
        setIsLoadingTasks(false);
      }
    };

    fetchPhaseTasks();
  }, [selectedPhase]);

  // Fetch avatar URLs for task resources (additional agents)
  useEffect(() => {
    const fetchAvatarUrls = async () => {
      const userIds = new Set<string>();

      // Collect user IDs from task resources
      Object.values(phaseTaskResources).forEach(resources => {
        resources.forEach(resource => {
          if (resource.additional_user_id) {
            userIds.add(resource.additional_user_id);
          }
        });
      });

      if (userIds.size === 0) return;

      // Get tenant from project
      const tenant = project.tenant;
      if (!tenant) return;

      try {
        const avatarUrlsMap = await getUserAvatarUrlsBatchAction(Array.from(userIds), tenant);
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
  }, [phaseTaskResources, project.tenant]);

  // Handle opening task from URL parameter (e.g., from notifications)
  // First effect: Fetch task and select its phase
  useEffect(() => {
    if (!initialTaskId || projectPhases.length === 0) return;

    // Reset the flag when initialTaskId changes
    hasOpenedInitialTask.current = false;

    const loadTaskAndSelectPhase = async () => {
      try {
        const task = await getTaskById(initialTaskId);
        if (!task) {
          toast.error('Task not found');
          return;
        }

        // Find the phase for this task
        const taskPhase = projectPhases.find(phase => phase.phase_id === task.phase_id);
        if (!taskPhase) {
          toast.error('Task phase not found');
          return;
        }

        // Select the phase (this will trigger loading tasks for that phase)
        if (selectedPhase?.phase_id !== taskPhase.phase_id) {
          setSelectedPhase(taskPhase);
          setCurrentPhase(taskPhase);
        }

        // Update URL to include phaseId if it wasn't already there
        if (onUrlUpdate && !initialPhaseId) {
          onUrlUpdate(taskPhase.phase_id, initialTaskId);
        }
      } catch (error) {
        console.error('Error loading task from notification:', error);
        toast.error('Failed to load task');
      }
    };

    loadTaskAndSelectPhase();
  }, [initialTaskId, projectPhases, initialPhaseId, onUrlUpdate]);

  // Second effect: Once tasks are loaded, open the specific task
  useEffect(() => {
    if (!initialTaskId || projectTasks.length === 0 || showQuickAdd || hasOpenedInitialTask.current) return;

    // Find the task in the loaded tasks
    const taskToOpen = projectTasks.find(task => task.task_id === initialTaskId);

    if (taskToOpen) {
      // Open the task dialog
      setSelectedTask(taskToOpen);
      setCurrentPhase(selectedPhase);
      setShowQuickAdd(true);
      hasOpenedInitialTask.current = true; // Mark that we've opened the task
    }
  }, [initialTaskId, projectTasks, showQuickAdd]);

  // Fetch document counts for tasks in the selected phase
  useEffect(() => {
    const fetchDocumentCounts = async () => {
      if (!selectedPhase || filteredTasks.length === 0) {
        setTaskDocumentCounts(new Map());
        return;
      }
      
      try {
        // Get task IDs for bulk fetch
        const taskIds = filteredTasks.map(task => task.task_id);
        
        // Fetch all document counts in one query
        const countMap = await getDocumentCountsForEntities(taskIds, 'project_task');
        
        // Set the Map directly
        setTaskDocumentCounts(countMap);
      } catch (error) {
        console.error('Error fetching document counts:', error);
        // Set empty counts on error
        const emptyMap = new Map<string, number>();
        filteredTasks.forEach(task => {
          emptyMap.set(task.task_id, 0);
        });
        setTaskDocumentCounts(emptyMap);
      }
    };
    
    fetchDocumentCounts();
  }, [selectedPhase, filteredTasks]);

  const handleDragStart = (e: React.DragEvent, taskId: string) => {
    e.dataTransfer.setData('text/plain', taskId);
    if (e.target instanceof HTMLElement) {
      e.target.classList.add('opacity-50');
    }
    document.body.classList.add('dragging-task');
  };

  const handleDragEnd = (e: React.DragEvent) => {
    if (e.target instanceof HTMLElement) {
      e.target.classList.remove('opacity-50');
    }
    document.body.classList.remove('dragging-task');
    setPhaseDropTarget(null);
    setTaskDraggingOverPhaseId(null); // Clear task dragging over phase

    // Reset scroll speeds and clear interval
    scrollSpeedsRef.current = { horizontal: 0, vertical: 0, column: null };
    if (scrollIntervalRef.current) {
      clearInterval(scrollIntervalRef.current);
      scrollIntervalRef.current = null;
    }
  };

  const handleDrop = async (e: React.DragEvent, targetStatusId: string, draggedTaskId: string, beforeTaskId: string | null, afterTaskId: string | null) => {
    e.preventDefault();
    const task = projectTasks.find(t => t.task_id === draggedTaskId);
    
    if (!task) {
      console.error('Task not found');
      return;
    }

    try {
      // Check if this is a status change or reorder
      if (task.project_status_mapping_id !== targetStatusId) {
        // Status change with position
        const updatedTask = await updateTaskStatus(draggedTaskId, targetStatusId, beforeTaskId, afterTaskId);
        const checklistItems = await getTaskChecklistItems(draggedTaskId);
        const taskWithChecklist = { ...updatedTask, checklist_items: checklistItems };
        
        // Remove from current status and add to new status
        setProjectTasks(prevTasks => {
          const newTasks = prevTasks.filter(t => t.task_id !== draggedTaskId);
          return [...newTasks, taskWithChecklist];
        });
        
        // Add animation state
        setAnimatingTasks(prev => new Set(prev).add(draggedTaskId));
        
        // Remove the entering animation after a delay
        setTimeout(() => {
          setAnimatingTasks(prev => {
            const next = new Set(prev);
            next.delete(draggedTaskId);
            return next;
          });
        }, 500);
        
        toast.success(`Task moved to new status`);
      } else {
        // Reorder within same status - use the new reorderTask function
        await reorderTask(draggedTaskId, beforeTaskId, afterTaskId);
        
        // Update local state to reflect the new order immediately
        // Generate a new order key for the moved task
        
        // Get the order keys from the before/after tasks
        let beforeKey: string | null = null;
        let afterKey: string | null = null;
        
        if (beforeTaskId) {
          const beforeTask = projectTasks.find(t => t.task_id === beforeTaskId);
          beforeKey = beforeTask?.order_key || null;
        }
        
        if (afterTaskId) {
          const afterTask = projectTasks.find(t => t.task_id === afterTaskId);
          afterKey = afterTask?.order_key || null;
        }
        
        const newOrderKey = generateKeyBetween(beforeKey, afterKey);
        
        // Update the task with the new order key
        setProjectTasks(prevTasks =>
          prevTasks.map((t): IProjectTask =>
            t.task_id === draggedTaskId ? { ...t, order_key: newOrderKey } : t
          )
        );
        
        // Add animation state
        setAnimatingTasks(prev => new Set(prev).add(draggedTaskId));
        
        // Remove the entering animation after a delay
        setTimeout(() => {
          setAnimatingTasks(prev => {
            const next = new Set(prev);
            next.delete(draggedTaskId);
            return next;
          });
        }, 500);
      }
    } catch (error) {
      console.error('Error handling drop:', error);
      toast.error('Failed to move task');
    }
  };


  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();

    // kanbanBoardRef points to .kanbanContainer which is the horizontal scroll container
    const kanbanContainer = kanbanBoardRef.current;
    if (!kanbanContainer) return;

    const containerRect = kanbanContainer.getBoundingClientRect();
    const mouseX = e.clientX;
    const mouseY = e.clientY;

    // Check if mouse is within the container bounds
    if (mouseX < containerRect.left || mouseX > containerRect.right ||
        mouseY < containerRect.top || mouseY > containerRect.bottom) {
      // Stop scrolling if outside bounds
      scrollSpeedsRef.current = { horizontal: 0, vertical: 0, column: null };
      return;
    }

    // Calculate horizontal scroll (for kanban container)
    let horizontalScrollSpeed = 0;
    const leftEdge = containerRect.left + SCROLL_THRESHOLD;
    const rightEdge = containerRect.right - SCROLL_THRESHOLD;

    if (mouseX < leftEdge) {
      // Near left edge - scroll left
      const distance = leftEdge - mouseX;
      horizontalScrollSpeed = -Math.min(MAX_SCROLL_SPEED, (distance / SCROLL_THRESHOLD) * MAX_SCROLL_SPEED);
    } else if (mouseX > rightEdge) {
      // Near right edge - scroll right
      const distance = mouseX - rightEdge;
      horizontalScrollSpeed = Math.min(MAX_SCROLL_SPEED, (distance / SCROLL_THRESHOLD) * MAX_SCROLL_SPEED);
    }

    // Find the column being dragged over and calculate vertical scroll
    let verticalScrollSpeed = 0;
    let targetColumn: HTMLElement | null = null;

    // Find the kanban tasks containers using data attribute (more reliable than CSS classes)
    const columns = kanbanContainer.querySelectorAll('[data-kanban-column-tasks="true"]');
    columns.forEach((column) => {
      const columnRect = column.getBoundingClientRect();
      if (mouseX >= columnRect.left && mouseX <= columnRect.right &&
          mouseY >= columnRect.top && mouseY <= columnRect.bottom) {
        targetColumn = column as HTMLElement;

        const topEdge = columnRect.top + SCROLL_THRESHOLD;
        const bottomEdge = columnRect.bottom - SCROLL_THRESHOLD;

        if (mouseY < topEdge) {
          // Near top edge - scroll up
          const distance = topEdge - mouseY;
          verticalScrollSpeed = -Math.min(MAX_SCROLL_SPEED, (distance / SCROLL_THRESHOLD) * MAX_SCROLL_SPEED);
        } else if (mouseY > bottomEdge) {
          // Near bottom edge - scroll down
          const distance = mouseY - bottomEdge;
          verticalScrollSpeed = Math.min(MAX_SCROLL_SPEED, (distance / SCROLL_THRESHOLD) * MAX_SCROLL_SPEED);
        }
      }
    });

    // Update scroll speeds in ref (the interval reads from this)
    scrollSpeedsRef.current = {
      horizontal: horizontalScrollSpeed,
      vertical: verticalScrollSpeed,
      column: targetColumn
    };

    // Start interval if not already running and we need to scroll
    if (!scrollIntervalRef.current && (horizontalScrollSpeed !== 0 || verticalScrollSpeed !== 0)) {
      scrollIntervalRef.current = setInterval(() => {
        const { horizontal, vertical, column } = scrollSpeedsRef.current;
        const container = kanbanBoardRef.current;

        if (container && horizontal !== 0) {
          container.scrollLeft += horizontal;
        }
        if (column && vertical !== 0) {
          column.scrollTop += vertical;
        }

        // Stop interval if both speeds are 0
        if (horizontal === 0 && vertical === 0 && scrollIntervalRef.current) {
          clearInterval(scrollIntervalRef.current);
          scrollIntervalRef.current = null;
        }
      }, 16); // ~60fps
    }
  };

  const handlePhaseDragOver = (e: React.DragEvent, phaseId: string, dropPosition: 'before' | 'after' | '', isOverPhaseItemBody: boolean = false) => {
    e.preventDefault();
    const isPhaseBeingDragged = e.dataTransfer.types.includes('application/json');

    if (isPhaseBeingDragged) {
      // Only show phase drop target (dotted line) if a phase is being dragged over a 'before'/'after' zone
      if (!isOverPhaseItemBody && (dropPosition === 'before' || dropPosition === 'after')) {
        setPhaseDropTarget({ phaseId, position: dropPosition });
      } else {
        setPhaseDropTarget(null); // Don't show dotted line when dragging phase over another phase's body or if dropPosition is ""
      }
      setTaskDraggingOverPhaseId(null);
    } else {
      // Task is being dragged
      setPhaseDropTarget(null); // Don't show dotted line for phase reorder
      if (isOverPhaseItemBody) {
        setTaskDraggingOverPhaseId(phaseId); // Highlight the phase item itself
      } else {
        // Task is over a 'before'/'after' zone, do nothing or clear highlight
        setTaskDraggingOverPhaseId(null);
      }
    }
    handleDragOver(e); // Generic scroll handler
  };

  const handlePhaseDragLeave = () => {
    setPhaseDropTarget(null);
    setTaskDraggingOverPhaseId(null); // Clear task dragging over phase
  };

  const handlePhaseDragStart = (_e: React.DragEvent, _phaseId: string) => {
    // Phase drag start logic - phases handle their own data transfer
    document.body.classList.add('dragging-phase');
  };

  const handlePhaseDragEnd = (_e: React.DragEvent) => {
    // Phase drag end cleanup
    document.body.classList.remove('dragging-phase');
    setPhaseDropTarget(null);
    setTaskDraggingOverPhaseId(null); // Clear task dragging over phase
  };

  const handlePhaseReorder = async (draggedPhaseId: string, beforePhaseId: string | null, afterPhaseId: string | null) => {
    if (!draggedPhaseId) return;
    
    try {
      const draggedPhase = projectPhases.find(p => p.phase_id === draggedPhaseId);
      if (!draggedPhase) return;
      
      await reorderPhase(draggedPhaseId, beforePhaseId, afterPhaseId);
      
      // Calculate the new order key locally for immediate UI update
      
      // Get the order keys for before and after phases
      let beforeKey: string | null = null;
      let afterKey: string | null = null;
      
      if (beforePhaseId) {
        const beforePhase = projectPhases.find(p => p.phase_id === beforePhaseId);
        beforeKey = beforePhase?.order_key || null;
      }
      
      if (afterPhaseId) {
        const afterPhase = projectPhases.find(p => p.phase_id === afterPhaseId);
        afterKey = afterPhase?.order_key || null;
      }
      
      const newOrderKey = generateKeyBetween(
        beforeKey === undefined ? null : beforeKey,
        afterKey === undefined ? null : afterKey
      );
      
      // Update the phases with the new order key
      const updatedPhases = projectPhases.map(p => {
        if (p.phase_id === draggedPhaseId) {
          return { ...p, order_key: newOrderKey };
        }
        return p;
      });
      setProjectPhases(updatedPhases);
      
      // Add animation state
      setAnimatingPhases(prev => new Set(prev).add(draggedPhaseId));
      
      // Remove the entering animation after a delay
      setTimeout(() => {
        setAnimatingPhases(prev => {
          const next = new Set(prev);
          next.delete(draggedPhaseId);
          return next;
        });
      }, 500);
      
      toast.success('Phase reordered successfully');
    } catch (error) {
      console.error('Error reordering phase:', error);
      toast.error('Failed to reorder phase');
    }
  };

  const handlePhaseDropZone = async (e: React.DragEvent, targetPhase: IProjectPhase, beforePhaseId: string | null, afterPhaseId: string | null) => {
    e.preventDefault();
    setPhaseDropTarget(null);
    setTaskDraggingOverPhaseId(null); // Clear highlight on drop
    
    // Debug logging
    console.log('handlePhaseDropZone called:', {
      targetPhase: targetPhase.phase_name,
      beforePhaseId,
      afterPhaseId,
      dataTransferTypes: e.dataTransfer.types
    });
    
    // Check if it's a phase being dropped
    const dropData = e.dataTransfer.getData('application/json');
    const plainData = e.dataTransfer.getData('text/plain');
    
    console.log('Drop data:', { dropData, plainData });
    
    if (dropData) {
      try {
        const parsed = JSON.parse(dropData);
        console.log('Parsed drop data:', parsed);
        if (parsed.type === 'phase' && parsed.phaseId) {
          // Handle phase reordering with the provided before/after IDs
          console.log('Calling handlePhaseReorder with:', { draggedId: parsed.phaseId, beforePhaseId, afterPhaseId });
          await handlePhaseReorder(parsed.phaseId, beforePhaseId, afterPhaseId);
          return;
        }
      } catch (err) {
        console.log('Error parsing drop data:', err);
        // Not JSON data, continue with task drop logic
      }
    }
    
    // Original task drop logic
    const taskId = plainData;
    const task = projectTasks.find(t => t.task_id === taskId);
    const sourcePhase = projectPhases.find(p => p.phase_id === task?.phase_id);
    
    if (task && sourcePhase && targetPhase.phase_id !== sourcePhase.phase_id) {
      setMoveConfirmation({
        taskId,
        taskName: task.task_name,
        sourcePhase,
        targetPhase
      });
    }
  };

  const handleMoveConfirm = async () => {
    if (!moveConfirmation) return;
    
    try {
      // Get the current task to preserve its status
      const task = projectTasks.find(t => t.task_id === moveConfirmation.taskId);
      if (!task) {
        throw new Error('Task not found');
      }

      const updatedTask = await moveTaskToPhase(
        moveConfirmation.taskId,
        moveConfirmation.targetPhase.phase_id,
        task.project_status_mapping_id  // Pass the current status mapping ID
      );
      
      const checklistItems = await getTaskChecklistItems(moveConfirmation.taskId);
      const taskWithChecklist = { ...updatedTask, checklist_items: checklistItems };
      
      setProjectTasks(prevTasks =>
        prevTasks.map((task): IProjectTask =>
          task.task_id === updatedTask.task_id ? taskWithChecklist : task
        )
      );
      // Update allProjectTasks for filtered counts
      setAllProjectTasks(prev => prev.map(t =>
        t.task_id === updatedTask.task_id ? { ...t, phase_id: moveConfirmation.targetPhase.phase_id } : t
      ));

      toast.success(`Task moved to ${moveConfirmation.targetPhase.phase_name}`);
    } catch (error) {
      console.error('Error moving task:', error);
      toast.error('Failed to move task');
    } finally {
      setMoveConfirmation(null);
    }
  };

  const handleAddTask = useCallback(async (newTask: IProjectTask | null) => {
    if (!newTask) return;

    setIsAddingTask(true);
    try {
      // Use currentPhase as fallback for list view where selectedPhase might be null
      const activePhase = selectedPhase || currentPhase;

      if (activePhase && newTask.wbs_code.startsWith(activePhase.wbs_code)) {
        const checklistItems = await getTaskChecklistItems(newTask.task_id);
        const taskWithChecklist = { ...newTask, checklist_items: checklistItems };

        setProjectTasks((prevTasks) => [...prevTasks, taskWithChecklist]);

        // Also update list view data if it exists
        if (listViewData) {
          setListViewData(prev => prev ? {
            ...prev,
            tasks: [...prev.tasks, taskWithChecklist],
            checklistItems: {
              ...prev.checklistItems,
              [newTask.task_id]: checklistItems
            },
            taskTags: {
              ...prev.taskTags,
              [newTask.task_id]: newTask.tags || []
            },
            taskResources: {
              ...prev.taskResources,
              [newTask.task_id]: []
            },
            taskDependencies: {
              ...prev.taskDependencies,
              [newTask.task_id]: { predecessors: [], successors: [] }
            }
          } : null);
        }

        // Add to allProjectTasks for filtered counts
        setAllProjectTasks(prev => [...prev, taskWithChecklist]);
        setShowQuickAdd(false);
        toast.success('New task added successfully!');
      } else {
        console.error('New task does not match selected phase');
        toast.error('Error adding new task: Phase mismatch');
      }
    } catch (error) {
      console.error('Error adding new task:', error);
      toast.error('Error adding new task. Please try again.');
    } finally {
      setIsAddingTask(false);
    }
  }, [selectedPhase, currentPhase, listViewData]);

  const handleCloseQuickAdd = useCallback(() => {
    setShowQuickAdd(false);
    setDefaultStatus(null);
    setIsAddingTask(false);
    setSelectedTask(null);
    // Update URL to remove taskId while keeping phaseId
    if (onUrlUpdate && selectedPhase) {
      onUrlUpdate(selectedPhase.phase_id, null);
    }
  }, [onUrlUpdate, selectedPhase]);

  const handlePhaseAdded = useCallback((newPhase: IProjectPhase) => {
    setProjectPhases((prevPhases) => [...prevPhases, newPhase]);
    setSelectedPhase(newPhase);
    setCurrentPhase(newPhase);
    // Update URL with new phase
    if (onUrlUpdate) {
      onUrlUpdate(newPhase.phase_id, null);
    }
    toast.success('New phase added successfully!');
  }, [onUrlUpdate]);

  const handleAddCard = useCallback((status: ProjectStatus) => {
    if (!selectedPhase) {
      toast.error('Please select a phase before adding a card.');
      return;
    }
    
    setIsAddingTask(true);
    setDefaultStatus(status);
    setCurrentPhase(selectedPhase);
    setSelectedTask(null);
    setShowQuickAdd(true);
  }, [selectedPhase]);

  const handleTaskUpdated = useCallback(async (updatedTask: IProjectTask | null) => {
    if (updatedTask) {
      try {
        // Fetch checklist items and task resources in parallel
        const [checklistItems, taskResources] = await Promise.all([
          getTaskChecklistItems(updatedTask.task_id),
          getTaskResourcesAction(updatedTask.task_id)
        ]);
        const taskWithChecklist = { ...updatedTask, checklist_items: checklistItems };

        // Update kanban view data
        setProjectTasks((prevTasks) => {
          const taskExists = prevTasks.some(task => task.task_id === updatedTask.task_id);

          if (taskExists) {
            return prevTasks.map((task): IProjectTask =>
              task.task_id === updatedTask.task_id ? taskWithChecklist : task
            );
          } else {
            return [...prevTasks, taskWithChecklist];
          }
        });

        // Update task resources for kanban view
        setPhaseTaskResources(prev => ({
          ...prev,
          [updatedTask.task_id]: taskResources
        }));

        // Update list view data if it exists
        setListViewData(prev => {
          if (!prev) return null;
          const taskExists = prev.tasks.some(t => t.task_id === updatedTask.task_id);
          return {
            ...prev,
            tasks: taskExists
              ? prev.tasks.map(t => t.task_id === updatedTask.task_id ? taskWithChecklist : t)
              : [...prev.tasks, taskWithChecklist],
            checklistItems: {
              ...prev.checklistItems,
              [updatedTask.task_id]: checklistItems
            },
            taskResources: {
              ...prev.taskResources,
              [updatedTask.task_id]: taskResources
            }
          };
        });

        toast.success(taskWithChecklist.task_id ? 'Task updated successfully!' : 'Task added successfully!');
      } catch (error) {
        console.error('Error updating task:', error);
        toast.error('Failed to update task');
      }
    } else {
      // Task deleted - use ref for reliable access
      const deletedTaskId = selectedTaskIdRef.current;
      if (deletedTaskId) {
        setProjectTasks((prevTasks) =>
          prevTasks.filter((task) => task.task_id !== deletedTaskId)
        );

        // Also remove from list view data
        setListViewData(prev => prev ? {
          ...prev,
          tasks: prev.tasks.filter(t => t.task_id !== deletedTaskId)
        } : null);

        toast.success('Task deleted successfully!');
      }
    }
    setShowQuickAdd(false);
    setSelectedTask(null);
    setIsAddingTask(false);
  }, []);

  const handleTaskSelected = useCallback((task: IProjectTask) => {
    // Log that we're using the cached project tree data for editing
    console.log('Using cached project tree data for edit task dialog');

    setSelectedTask(task);
    const taskPhase = phases.find(phase => phase.phase_id === task.phase_id) || null;
    setCurrentPhase(taskPhase);
    setShowQuickAdd(true);
    // Update URL with task and phase
    if (onUrlUpdate && taskPhase) {
      onUrlUpdate(taskPhase.phase_id, task.task_id);
    }
  }, [phases, onUrlUpdate]);

  const handleAssigneeChange = async (taskId: string, newAssigneeId: string | null, newTaskName?: string) => {
    try {
      // Find task in either kanban data or list view data
      const task = projectTasks.find(t => t.task_id === taskId) || listViewData?.tasks.find(t => t.task_id === taskId);
      if (!task) {
        throw new Error('Task not found');
      }

      const updatedTask = await updateTaskWithChecklist(taskId, {
        ...task,
        assigned_to: !newAssigneeId || newAssigneeId === 'unassigned' || newAssigneeId === '' ? null : newAssigneeId,
        task_name: newTaskName || task.task_name,
        estimated_hours: Number(task.estimated_hours) || 0,
        actual_hours: Number(task.actual_hours) || 0,
        checklist_items: task.checklist_items
      });

      if (updatedTask) {
        const checklistItems = await getTaskChecklistItems(taskId);
        const taskWithChecklist = { ...updatedTask, checklist_items: checklistItems };

        // Update kanban view data
        setProjectTasks(prevTasks =>
          prevTasks.map((task): IProjectTask =>
            task.task_id === taskId ? taskWithChecklist : task
          )
        );

        // Update list view data if it exists
        if (listViewData) {
          setListViewData(prev => prev ? {
            ...prev,
            tasks: prev.tasks.map(t =>
              t.task_id === taskId ? taskWithChecklist : t
            )
          } : null);
        }

        toast.success('Task assignee updated successfully!');
      }
    } catch (error) {
      console.error('Error updating task assignee:', error);
      toast.error('Failed to update task assignee. Please try again.');
    }
  };

  const handleEditPhase = (phase: IProjectPhase) => {
    setEditingPhaseId(phase.phase_id);
    setEditingPhaseName(phase.phase_name);
    setEditingPhaseDescription(phase.description);
    // Always create new Date objects from the timestamps to ensure consistent format
    setEditingStartDate(phase.start_date ? new Date(phase.start_date) : undefined);
    setEditingEndDate(phase.end_date ? new Date(phase.end_date) : undefined);
  };

  const handleSavePhase = async (phase: IProjectPhase) => {
    try {
      if (!editingPhaseName.trim()) {
        toast.error('Phase name cannot be empty');
        return;
      }
  
      const updatedPhase = await updatePhase(phase.phase_id, {
        phase_name: editingPhaseName,
        description: editingPhaseDescription,
        start_date: editingStartDate || null,
        end_date: editingEndDate || null
      });
  
      setProjectPhases(prevPhases =>
        prevPhases.map((p): IProjectPhase =>
          p.phase_id === phase.phase_id
            ? { 
                ...p, 
                phase_name: editingPhaseName,
                description: updatedPhase.description,
                start_date: updatedPhase.start_date,
                end_date: updatedPhase.end_date
              }
            : p
        )
      );

      if (selectedPhase?.phase_id === updatedPhase.phase_id) {
        setSelectedPhase(updatedPhase);
      }
      
      setEditingPhaseId(null);
      setEditingPhaseName('');
      setEditingPhaseDescription(null);
      setEditingStartDate(undefined);
      setEditingEndDate(undefined);
      toast.success('Phase updated successfully!');
    } catch (error) {
      console.error('Error updating phase:', error);
      toast.error('Failed to update phase. Please try again.');
    }
  };

  const handleCancelEdit = () => {
    setEditingPhaseId(null);
    setEditingPhaseName('');
    setEditingPhaseDescription(null);
    setEditingStartDate(undefined);
    setEditingEndDate(undefined);
  };

  const handleDeletePhase = async () => {
    if (!deletePhaseConfirmation) return;

    try {
      await deletePhase(deletePhaseConfirmation.phaseId);
      setProjectPhases(prevPhases => 
        prevPhases.filter(phase => phase.phase_id !== deletePhaseConfirmation.phaseId)
      );
      if (selectedPhase?.phase_id === deletePhaseConfirmation.phaseId) {
        setSelectedPhase(null);
      }
      toast.success('Phase deleted successfully!');
    } catch (error) {
      console.error('Error deleting phase:', error);
      toast.error('Failed to delete phase. Please try again.');
    } finally {
      setDeletePhaseConfirmation(null);
    }
  };

  const handleEmptyTaskUpdate = async (_: IProjectTask | null) => {
    return Promise.resolve();
  };

  const handlePhaseSelect = (phase: IProjectPhase) => {
    setSelectedPhase(phase);
    setCurrentPhase(phase);
    // Update URL with new phase selection
    if (onUrlUpdate) {
      onUrlUpdate(phase.phase_id, null);
    }
  };

  const handleDeletePhaseClick = (phase: IProjectPhase) => {
    setDeletePhaseConfirmation({
      phaseId: phase.phase_id,
      phaseName: phase.phase_name
    });
  };

  const handleReorderTasks = async (updates: { taskId: string, newWbsCode: string }[]) => {
    try {
      await reorderTasksInStatus(updates);
      // Update local state to reflect the new order
      const updatedTasks = [...projectTasks];
      updates.forEach(({taskId, newWbsCode}) => {
        const taskIndex = updatedTasks.findIndex(t => t.task_id === taskId);
        if (taskIndex !== -1) {
          updatedTasks[taskIndex] = {
            ...updatedTasks[taskIndex],
            wbs_code: newWbsCode
          };
        }
      });
      setProjectTasks(updatedTasks);
      toast.success('Tasks reordered successfully');
    } catch (error) {
      console.error('Error reordering tasks:', error);
      toast.error('Failed to reorder tasks');
    }
  };

  const handleMoveTaskClick = (task: IProjectTask) => {
    console.log("Move Task action clicked in ProjectDetail:", task);
    setTaskToMove(task);
    setIsMoveTaskDialogOpen(true);
  };

  const handleDuplicateTaskClick = async (task: IProjectTask) => {
    console.log("Duplicate clicked in ProjectDetail:", task);

    const placeholderTargetPhase = projectPhases.find(p => p.phase_id !== task.phase_id) || projectPhases[0]; // Just picking another phase for demo
    if (!placeholderTargetPhase) {
        toast.error("Could not find a target phase to duplicate to.");
        return;
    }
    // Using placeholderTargetPhase directly in the dialog

    try {
        // Fetch necessary details for the dialog toggles
        const [resources, links, checklist] = await Promise.all([
            getTaskResourcesAction(task.task_id),
            getTaskTicketLinksAction(task.task_id),
            getTaskChecklistItems(task.task_id)
        ]);

        setTaskToDuplicate(task);
        setDuplicateTaskToggleDetails({
            hasChecklist: (checklist || []).length > 0,
            hasPrimaryAssignee: !!task.assigned_to,
            additionalAssigneeCount: (resources || []).length,
            ticketLinkCount: (links || []).length,
        });
        setIsDuplicateDialogOpen(true);
    } catch (error) {
        console.error("Error preparing duplicate dialog:", error);
        toast.error("Failed to load task details for duplication.");
    }
  };

  // Placeholder for delete handler (will add later)
  const handleDeleteTaskClick = (task: IProjectTask) => {
    console.log("Delete clicked in ProjectDetail:", task);
    setTaskToDelete(task);
  };
 
  // Handler for MoveTaskDialog confirmation
  const handleDialogMoveConfirm = async (targetPhaseId: string, targetStatusId: string | undefined) => {
    if (!taskToMove) return;

    console.log(`Moving task ${taskToMove.task_id} to phase ${targetPhaseId} with status ${targetStatusId}`);
    try {
      const movedTask = await moveTaskToPhase(
        taskToMove.task_id,
        targetPhaseId,
        targetStatusId
      );

      if (movedTask) {
        const checklistItems = await getTaskChecklistItems(movedTask.task_id);
        const taskWithDetails = { ...movedTask, checklist_items: checklistItems };

        // Check if the task was moved to a different phase than the currently selected one
        const movedToDifferentPhase = selectedPhase && movedTask.phase_id !== selectedPhase.phase_id;

        if (movedToDifferentPhase) {
          // Remove the task from the current view since it's no longer in this phase
          setProjectTasks(prevTasks =>
            prevTasks.filter(t => t.task_id !== movedTask.task_id)
          );
          // Update allProjectTasks for filtered counts
          setAllProjectTasks(prev => prev.map(t =>
            t.task_id === movedTask.task_id ? { ...t, phase_id: targetPhaseId, project_status_mapping_id: targetStatusId || t.project_status_mapping_id } : t
          ));
          toast.success(`Task "${taskToMove.task_name}" moved to different phase successfully! Switch to the target phase to see it.`);
        } else {
          // Task moved within the same phase (to different status) - update in place
          setProjectTasks(prevTasks =>
            prevTasks.map(t => t.task_id === movedTask.task_id ? taskWithDetails : t)
          );
          toast.success(`Task "${taskToMove.task_name}" moved successfully!`);
        }
      } else {
        toast.error("Failed to move task. Please try again.");
      }
    } catch (error) {
      console.error("Error moving task via dialog:", error);
      toast.error(`Failed to move task: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsMoveTaskDialogOpen(false);
      setTaskToMove(null);
    }
  };

  // Render the sticky header with title, view switcher, search, and filters
  const renderHeader = () => {
    const completionPercentage = (completedTasksCount / filteredTasks.length) * 100 || 0;

    if (viewMode === 'list') {
      return (
        <div className="mb-4 space-y-3 flex-shrink-0">
          {/* Top row: Title + Pin + View Switcher */}
          <div className="flex justify-between items-center">
            <h2 className="text-xl font-bold">Task List</h2>
            <div className="flex items-center gap-4">
              <Tooltip content={isHeaderPinned ? "Unpin header" : "Pin header to top"}>
                <button
                  onClick={() => setIsHeaderPinned(!isHeaderPinned)}
                  className={`p-1.5 rounded-md transition-colors ${
                    isHeaderPinned
                      ? 'bg-primary-100 text-primary-600'
                      : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
                  }`}
                  aria-label={isHeaderPinned ? "Unpin header" : "Pin header to top"}
                >
                  <Pin className={`h-4 w-4 ${isHeaderPinned ? 'fill-current' : ''}`} />
                </button>
              </Tooltip>
              <ViewSwitcher
                currentView={viewMode}
                onChange={setViewMode}
                options={[
                  { value: 'kanban', label: 'Kanban', icon: LayoutGrid },
                  { value: 'list', label: 'List', icon: List }
                ]}
              />
            </div>
          </div>

          {/* Bottom row: Search + Filters */}
          <div className="flex items-center gap-3 flex-wrap">
            {/* Search Input with Options */}
            <div className="flex items-center gap-1">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  id="task-search-list"
                  type="text"
                  placeholder="Search tasks..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-8 pr-8 py-1.5 text-sm border border-gray-300 rounded-md w-64 focus:outline-none focus:ring-1 focus:ring-primary-500 focus:border-primary-500"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    aria-label="Clear search"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
              <Button
                id="search-whole-word-list"
                variant={searchWholeWord ? 'soft' : 'outline'}
                size="xs"
                onClick={() => setSearchWholeWord(!searchWholeWord)}
                title="Whole word"
              >
                Word
              </Button>
              <Button
                id="search-case-sensitive-list"
                variant={searchCaseSensitive ? 'soft' : 'outline'}
                size="xs"
                onClick={() => setSearchCaseSensitive(!searchCaseSensitive)}
                title="Case sensitive"
              >
                Aa
              </Button>
            </div>

            {/* Tag Filter */}
            <TagFilter
              tags={allTaskTags}
              selectedTags={selectedTaskTags}
              onToggleTag={(tag) => {
                setSelectedTaskTags(prev =>
                  prev.includes(tag)
                    ? prev.filter(t => t !== tag)
                    : [...prev, tag]
                );
              }}
              onClearTags={() => setSelectedTaskTags([])}
            />

            {/* Agent Filter */}
            <div className="flex items-center gap-2">
              <div className="[&_button]:bg-white [&_button>span]:!text-gray-700">
                <MultiUserPicker
                  id="task-agent-filter-list"
                  values={selectedAgentFilter}
                  onValuesChange={handleAgentFilterChange}
                  users={users}
                  getUserAvatarUrlsBatch={getUserAvatarUrlsBatchAction}
                  filterMode={true}
                  includeUnassigned={includeUnassignedAgents}
                  onUnassignedChange={setIncludeUnassignedAgents}
                  compactDisplay={true}
                  placeholder="All Agents"
                />
              </div>
              {selectedAgentFilter.length === 1 && (
                <Button
                  id="primary-agent-only-list"
                  variant={primaryAgentOnly ? 'soft' : 'outline'}
                  size="xs"
                  onClick={() => setPrimaryAgentOnly(!primaryAgentOnly)}
                  title="Only show tasks where selected agent is the primary assignee"
                >
                  Primary
                </Button>
              )}
            </div>

            {/* Priority Filter */}
            <CustomSelect
              value={selectedPriorityFilter}
              onValueChange={setSelectedPriorityFilter}
              options={[
                { value: 'all', label: 'All Priorities' },
                ...priorities.map(p => ({
                  value: p.priority_id,
                  label: p.priority_name,
                  color: p.color
                }))
              ]}
              className="w-40"
              placeholder="Priority"
            />

            {/* Task Type Filter */}
            <CustomSelect
              value={selectedTaskTypeFilter}
              onValueChange={setSelectedTaskTypeFilter}
              options={[
                { value: 'all', label: 'All Types' },
                ...taskTypes.map(t => {
                  const Icon = taskTypeIcons[t.type_key] || CheckSquare;
                  return {
                    value: t.type_key,
                    label: (
                      <div className="flex items-center gap-2">
                        <Icon
                          className="w-4 h-4"
                          style={{ color: t.color || '#6B7280' }}
                        />
                        <span>{t.type_name}</span>
                      </div>
                    )
                  };
                })
              ]}
              className="w-40"
              placeholder="Task Type"
            />

            {/* Clear all filters button */}
            {(searchQuery || searchWholeWord || searchCaseSensitive ||
              selectedTaskTags.length > 0 || selectedAgentFilter.length > 0 ||
              includeUnassignedAgents || primaryAgentOnly || selectedPriorityFilter !== 'all' ||
              selectedTaskTypeFilter !== 'all') && (
              <Tooltip content="Clear all filters">
                <Button
                  id="clear-task-filters-list"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSearchQuery('');
                    setSearchWholeWord(false);
                    setSearchCaseSensitive(false);
                    setSelectedTaskTags([]);
                    setSelectedAgentFilter([]);
                    setIncludeUnassignedAgents(false);
                    setPrimaryAgentOnly(false);
                    setSelectedPriorityFilter('all');
                    setSelectedTaskTypeFilter('all');
                  }}
                  className="-ml-1 shrink-0 text-gray-500 hover:text-gray-700"
                >
                  <XCircle className="h-4 w-4" />
                </Button>
              </Tooltip>
            )}
          </div>
        </div>
      );
    }

    // Kanban view header
    return (
      <div className="mb-4 space-y-3 flex-shrink-0">
        {/* Top row: Title + Zoom Control + View Switcher */}
        <div className="flex justify-between items-center">
          <div>
            <h2 className="text-xl font-bold">
              {selectedPhase ? `Kanban Board: ${selectedPhase.phase_name}` : 'Kanban Board'}
            </h2>
            {selectedPhase?.description && (
              <p className="text-sm text-gray-600 mt-0.5">{selectedPhase.description}</p>
            )}
          </div>
          <div className="flex items-center gap-4">
            <KanbanZoomControl
              zoomLevel={kanbanZoomLevel}
              onZoomChange={setKanbanZoomLevel}
            />
            <Tooltip content={isHeaderPinned ? "Unpin header" : "Pin header to top"}>
              <button
                onClick={() => setIsHeaderPinned(!isHeaderPinned)}
                className={`p-1.5 rounded-md transition-colors ${
                  isHeaderPinned
                    ? 'bg-primary-100 text-primary-600'
                    : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
                }`}
                aria-label={isHeaderPinned ? "Unpin header" : "Pin header to top"}
              >
                <Pin className={`h-4 w-4 ${isHeaderPinned ? 'fill-current' : ''}`} />
              </button>
            </Tooltip>
            <ViewSwitcher
              currentView={viewMode}
              onChange={setViewMode}
              options={[
                { value: 'kanban', label: 'Kanban', icon: LayoutGrid },
                { value: 'list', label: 'List', icon: List }
              ]}
            />
          </div>
        </div>

        {/* Bottom row: Search + Filters + Completion */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 flex-wrap">
            {/* Search Input with Options */}
            <div className="flex items-center gap-1">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  id="task-search-kanban"
                  type="text"
                  placeholder="Search tasks..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-8 pr-8 py-1.5 text-sm border border-gray-300 rounded-md w-64 focus:outline-none focus:ring-1 focus:ring-primary-500 focus:border-primary-500"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    aria-label="Clear search"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
              <Button
                id="search-whole-word-kanban"
                variant={searchWholeWord ? 'soft' : 'outline'}
                size="xs"
                onClick={() => setSearchWholeWord(!searchWholeWord)}
                title="Whole word"
              >
                Word
              </Button>
              <Button
                id="search-case-sensitive-kanban"
                variant={searchCaseSensitive ? 'soft' : 'outline'}
                size="xs"
                onClick={() => setSearchCaseSensitive(!searchCaseSensitive)}
                title="Case sensitive"
              >
                Aa
              </Button>
            </div>

            {/* Tag Filter */}
            <TagFilter
              tags={allTaskTags}
              selectedTags={selectedTaskTags}
              onToggleTag={(tag) => {
                setSelectedTaskTags(prev =>
                  prev.includes(tag)
                    ? prev.filter(t => t !== tag)
                    : [...prev, tag]
                );
              }}
              onClearTags={() => setSelectedTaskTags([])}
            />

            {/* Agent Filter */}
            <div className="flex items-center gap-2">
              <div className="[&_button]:bg-white [&_button>span]:!text-gray-700">
                <MultiUserPicker
                  id="task-agent-filter-kanban"
                  values={selectedAgentFilter}
                  onValuesChange={handleAgentFilterChange}
                  users={users}
                  getUserAvatarUrlsBatch={getUserAvatarUrlsBatchAction}
                  filterMode={true}
                  includeUnassigned={includeUnassignedAgents}
                  onUnassignedChange={setIncludeUnassignedAgents}
                  compactDisplay={true}
                  placeholder="All Agents"
                />
              </div>
              {selectedAgentFilter.length === 1 && (
                <Button
                  id="primary-agent-only-kanban"
                  variant={primaryAgentOnly ? 'soft' : 'outline'}
                  size="xs"
                  onClick={() => setPrimaryAgentOnly(!primaryAgentOnly)}
                  title="Only show tasks where selected agent is the primary assignee"
                >
                  Primary
                </Button>
              )}
            </div>

            {/* Priority Filter */}
            <CustomSelect
              value={selectedPriorityFilter}
              onValueChange={setSelectedPriorityFilter}
              options={[
                { value: 'all', label: 'All Priorities' },
                ...priorities.map(p => ({
                  value: p.priority_id,
                  label: p.priority_name,
                  color: p.color
                }))
              ]}
              className="w-40"
              placeholder="Priority"
            />

            {/* Task Type Filter */}
            <CustomSelect
              value={selectedTaskTypeFilter}
              onValueChange={setSelectedTaskTypeFilter}
              options={[
                { value: 'all', label: 'All Types' },
                ...taskTypes.map(t => {
                  const Icon = taskTypeIcons[t.type_key] || CheckSquare;
                  return {
                    value: t.type_key,
                    label: (
                      <div className="flex items-center gap-2">
                        <Icon
                          className="w-4 h-4"
                          style={{ color: t.color || '#6B7280' }}
                        />
                        <span>{t.type_name}</span>
                      </div>
                    )
                  };
                })
              ]}
              className="w-40"
              placeholder="Task Type"
            />

            {/* Clear all filters button */}
            {(searchQuery || searchWholeWord || searchCaseSensitive ||
              selectedTaskTags.length > 0 || selectedAgentFilter.length > 0 ||
              includeUnassignedAgents || primaryAgentOnly || selectedPriorityFilter !== 'all' ||
              selectedTaskTypeFilter !== 'all') && (
              <Tooltip content="Clear all filters">
                <Button
                  id="clear-task-filters-kanban"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSearchQuery('');
                    setSearchWholeWord(false);
                    setSearchCaseSensitive(false);
                    setSelectedTaskTags([]);
                    setSelectedAgentFilter([]);
                    setIncludeUnassignedAgents(false);
                    setPrimaryAgentOnly(false);
                    setSelectedPriorityFilter('all');
                    setSelectedTaskTypeFilter('all');
                  }}
                  className="-ml-1 shrink-0 text-gray-500 hover:text-gray-700"
                >
                  <XCircle className="h-4 w-4" />
                </Button>
              </Tooltip>
            )}
          </div>

          {/* Completion Stats */}
          {selectedPhase && (
            <div className="flex items-center gap-2">
              <DonutChart
                percentage={completionPercentage}
                tooltipContent={`Shows the percentage of completed tasks for the selected phase "${selectedPhase.phase_name}" only`}
              />
              <span className="text-sm font-medium text-gray-600">
                {completedTasksCount} / {filteredTasks.length} Done
              </span>
            </div>
          )}
        </div>
      </div>
    );
  };

  // Render the scrollable content (kanban board or list view)
  const renderContent = () => {
    // List view rendering
    if (viewMode === 'list') {
      if (listViewLoading) {
        return (
          <div className="flex items-center justify-center h-64">
            <div className="text-gray-500">Loading list view...</div>
          </div>
        );
      }

      if (!listViewData) {
        return (
          <div className="flex items-center justify-center h-64">
            <div className="text-gray-500">No data available</div>
          </div>
        );
      }

      return (
        <TaskListView
          phases={listViewData.phases}
          tasks={listViewData.tasks}
          statuses={listViewData.statuses}
          taskResources={listViewData.taskResources}
          taskTags={listViewData.taskTags}
          taskDependencies={listViewData.taskDependencies}
          checklistItems={Object.entries(listViewData.checklistItems).reduce((acc, [taskId, items]) => {
            acc[taskId] = {
              total: items.length,
              completed: items.filter(item => item.completed).length,
              items: items.map(item => ({ item_name: item.item_name, completed: item.completed }))
            };
            return acc;
          }, {} as Record<string, { total: number; completed: number; items?: Array<{ item_name: string; completed: boolean }> }>)}
          documentCounts={{}}
          onTaskClick={handleTaskSelected}
          onTaskDelete={handleDeleteTaskClick}
          onTaskDuplicate={handleDuplicateTaskClick}
          onTaskMove={handleListViewTaskMove}
          onAddPhase={() => setShowPhaseQuickAdd(true)}
          onAddTask={(phaseId) => {
            const phase = listViewData.phases.find(p => p.phase_id === phaseId);
            if (phase) {
              setCurrentPhase(phase);
              setShowQuickAdd(true);
            }
          }}
          onTaskTagsChange={handleTaskTagsChange}
          onAssigneeChange={(taskId, newAssigneeId) => handleAssigneeChange(taskId, newAssigneeId)}
          users={users}
          selectedPriorityFilter={selectedPriorityFilter}
          selectedTaskTags={selectedTaskTags}
          selectedAgentFilter={selectedAgentFilter}
          includeUnassignedAgents={includeUnassignedAgents}
          primaryAgentOnly={primaryAgentOnly}
          searchQuery={searchQuery}
          searchWholeWord={searchWholeWord}
          searchCaseSensitive={searchCaseSensitive}
        />
      );
    }

    // Kanban view rendering
    if (!selectedPhase) {
      return (
        <div className="flex items-center justify-center h-64 bg-gray-100 rounded-lg">
          <div className="text-center">
            <p className="text-xl text-gray-600 flex items-center justify-center gap-2">
              Please select or create a phase to view the Kanban board.
              <Tooltip content="A phase is a distinct stage or milestone in your project timeline. Each phase can contain multiple tasks and helps organize work into manageable sections.">
                <HelpCircle className="w-5 h-5 text-gray-500 cursor-help" />
              </Tooltip>
            </p>
          </div>
        </div>
      );
    }

    return (
      <div className={styles.kanbanWrapper}>
        {isLoadingTasks ? (
          <KanbanBoardSkeleton />
        ) : (
          <KanbanBoard
            tasks={projectTasks}
            phaseTasks={filteredTasks}
            users={users}
            taskTypes={taskTypes}
            statuses={projectStatuses}
            isAddingTask={isAddingTask}
            selectedPhase={!!selectedPhase}
            ticketLinks={phaseTicketLinks}
            taskResources={phaseTaskResources}
            taskDependencies={phaseTaskDependencies}
            taskTags={taskTags}
            taskDocumentCounts={taskDocumentCounts}
            allTaskTags={allTaskTags}
            priorities={priorities}
            projectTreeData={projectTreeData}
            animatingTasks={animatingTasks}
            avatarUrls={avatarUrls}
            searchQuery={searchQuery}
            searchCaseSensitive={searchCaseSensitive}
            searchWholeWord={searchWholeWord}
            zoomLevel={kanbanZoomLevel}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onAddCard={handleAddCard}
            onTaskSelected={handleTaskSelected}
            onAssigneeChange={handleAssigneeChange}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onReorderTasks={handleReorderTasks}
            onMoveTaskClick={handleMoveTaskClick}
            onDuplicateTaskClick={handleDuplicateTaskClick}
            onEditTaskClick={handleTaskSelected}
            onDeleteTaskClick={handleDeleteTaskClick}
            onTaskTagsChange={handleTaskTagsChange}
          />
        )}
      </div>
    );
  };

  return (
    <div className={styles.pageContainer}>
      <Toaster position="top-right" />
      <div 
        className={styles.mainContent}
        onDragOver={handleDragOver}
      >
        <div className={styles.contentWrapper}>
          {/* Phases panel - collapsible in kanban view */}
          {viewMode === 'kanban' && (
            <div className={`${styles.phasesContainer} ${isPhasesPanelVisible ? styles.phasesContainerExpanded : styles.phasesContainerCollapsed}`}>
              {/* Toggle button */}
              <button
                onClick={() => setIsPhasesPanelVisible(!isPhasesPanelVisible)}
                className={styles.phasesPanelToggle}
                title={isPhasesPanelVisible ? 'Hide phases panel' : 'Show phases panel'}
                aria-label={isPhasesPanelVisible ? 'Hide phases panel' : 'Show phases panel'}
              >
                <ChevronRight className={`w-4 h-4 transition-transform duration-300 ${isPhasesPanelVisible ? 'rotate-180' : ''}`} />
              </button>

              {/* Phases panel content */}
              <div className={`${styles.phasesList} ${isPhasesPanelVisible ? styles.phasesListVisible : styles.phasesListHidden}`}>
                <ProjectPhases
                  phases={projectPhases}
                  selectedPhase={selectedPhase}
                  isAddingTask={isAddingTask}
                  editingPhaseId={editingPhaseId}
                  editingPhaseName={editingPhaseName}
                  editingPhaseDescription={editingPhaseDescription}
                  editingStartDate={editingStartDate}
                  editingEndDate={editingEndDate}
                  phaseTaskCounts={filteredPhaseTaskCounts}
                  phaseDropTarget={phaseDropTarget}
                  taskDraggingOverPhaseId={taskDraggingOverPhaseId}
                  animatingPhases={animatingPhases}
                  onPhaseSelect={handlePhaseSelect}
                  onAddTask={() => {
                    if (!selectedPhase) {
                      toast.error('Please select a phase before adding a task.');
                      return;
                    }
                    setCurrentPhase(selectedPhase);
                    setShowQuickAdd(true);
                  }}
                  onAddPhase={() => setShowPhaseQuickAdd(true)}
                  onEditPhase={handleEditPhase}
                  onSavePhase={handleSavePhase}
                  onCancelEdit={handleCancelEdit}
                  onDeletePhase={handleDeletePhaseClick}
                  onEditingPhaseNameChange={setEditingPhaseName}
                  onEditingPhaseDescriptionChange={setEditingPhaseDescription}
                  onEditingStartDateChange={setEditingStartDate}
                  onEditingEndDateChange={setEditingEndDate}
                  onDragOver={handlePhaseDragOver}
                  onDragLeave={handlePhaseDragLeave}
                  onDrop={handlePhaseDropZone}
                  onDragStart={handlePhaseDragStart}
                  onDragEnd={handlePhaseDragEnd}
                  onImport={() => setShowImportDialog(true)}
                />
              </div>
            </div>
          )}
          <div className={styles.kanbanArea}>
            {/* Header - optionally sticky when pinned */}
            <div className={`${styles.kanbanHeader} ${isHeaderPinned ? styles.kanbanHeaderPinned : ''}`}>
              {renderHeader()}
            </div>
            {/* Scrollable content area */}
            <div className={styles.kanbanContainer} ref={kanbanBoardRef} data-kanban-container="true">
              {renderContent()}
            </div>
          </div>
        </div>
      </div>

      {(showQuickAdd && (currentPhase || selectedPhase)) && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-lg shadow-lg relative w-full max-w-3xl">
            <button
              onClick={handleCloseQuickAdd}
              className="absolute top-2 right-2 text-gray-500 hover:text-gray-700"
              aria-label="Close"
            >
              ×
            </button>
            {selectedTask ? (
              <TaskEdit
                task={selectedTask}
                phase={currentPhase || selectedPhase!}
                phases={projectPhases}
                onClose={handleCloseQuickAdd}
                onTaskUpdated={handleTaskUpdated}
                projectStatuses={projectStatuses}
                users={users}
                projectTreeData={projectTreeData}
              />
            ) : (
              <TaskQuickAdd
                phase={currentPhase || selectedPhase!}
                onClose={handleCloseQuickAdd}
                onTaskAdded={handleAddTask}
                onTaskUpdated={handleEmptyTaskUpdate}
                projectStatuses={projectStatuses}
                defaultStatus={defaultStatus || undefined}
                onCancel={() => setIsAddingTask(false)}
                users={users}
                task={selectedTask || undefined}
                projectTreeData={projectTreeData}
              />
            )}
          </div>
        </div>
      )}

      {showPhaseQuickAdd && (
        <PhaseQuickAdd
          projectId={project.project_id}
          onClose={() => setShowPhaseQuickAdd(false)}
          onPhaseAdded={handlePhaseAdded}
          onCancel={() => setShowPhaseQuickAdd(false)}
        />
      )}

      {moveConfirmation && (
        <ConfirmationDialog
          isOpen={true}
          onClose={() => setMoveConfirmation(null)}
          onConfirm={handleMoveConfirm}
          title="Move Task"
          message={`Are you sure you want to move task "${moveConfirmation.taskName}" from phase "${moveConfirmation.sourcePhase.phase_name}" to "${moveConfirmation.targetPhase.phase_name}"?`}
          confirmLabel="Move"
          cancelLabel="Cancel"
        />
      )}

      {deletePhaseConfirmation && (
        <ConfirmationDialog
          isOpen={true}
          onClose={() => setDeletePhaseConfirmation(null)}
          onConfirm={handleDeletePhase}
          title="Delete Phase"
          message={`Are you sure you want to delete phase "${deletePhaseConfirmation.phaseName}"? This will also delete all tasks and their checklists in this phase.`}
          confirmLabel="Delete"
          cancelLabel="Cancel"
        />
      )}

      {/* Duplicate Task Dialog */}
      {isDuplicateDialogOpen && taskToDuplicate && duplicateTaskToggleDetails && (
        <DuplicateTaskDialog
          isOpen={isDuplicateDialogOpen}
          onClose={() => { 
              setIsDuplicateDialogOpen(false);
              setTaskToDuplicate(null);
              setDuplicateTaskToggleDetails(null);
          }}
          taskDetails={{
              originalTaskId: taskToDuplicate.task_id,
              originalTaskName: taskToDuplicate.task_name,
              ...duplicateTaskToggleDetails
          }}
          projectTreeData={projectTreeData}
          onConfirm={async (targetPhaseId: string, options: DuplicateOptions) => {
            if (!taskToDuplicate) return;
            try {
              const newTask = await duplicateTaskToPhase(
                taskToDuplicate.task_id,
                targetPhaseId,
                options
              );
              
              const checklistItems = await getTaskChecklistItems(newTask.task_id);
              const taskWithChecklist = { ...newTask, checklist_items: checklistItems };
              setProjectTasks(prev => [...prev, taskWithChecklist]);
              // Add to allProjectTasks for filtered counts
              setAllProjectTasks(prev => [...prev, taskWithChecklist]);

              toast.success(`Task "${newTask.task_name}" duplicated successfully!`);
              setIsDuplicateDialogOpen(false);
              setTaskToDuplicate(null);
              setDuplicateTaskToggleDetails(null);
            } catch (error) {
              console.error("Error duplicating task:", error);
              toast.error("Failed to duplicate task.");
            }
          }}
        />
      )}
 
      {/* Move Task Dialog */}
      {isMoveTaskDialogOpen && taskToMove && (
        <MoveTaskDialog
          isOpen={isMoveTaskDialogOpen}
          onClose={() => {
            setIsMoveTaskDialogOpen(false);
            setTaskToMove(null);
          }}
          task={taskToMove}
          currentProjectId={project.project_id}
          projectTreeData={projectTreeData}
          onConfirm={handleDialogMoveConfirm}
        />
      )}

      {/* Delete Task Confirmation Dialog */}
      {taskToDelete && (
        <ConfirmationDialog
          isOpen={!!taskToDelete}
          onClose={() => setTaskToDelete(null)}
          onConfirm={async () => {
            if (!taskToDelete) return;
            try {
              await deleteTaskAction(taskToDelete.task_id);
              setProjectTasks(prev => prev.filter(t => t.task_id !== taskToDelete.task_id));
              // Remove from allProjectTasks for filtered counts
              setAllProjectTasks(prev => prev.filter(t => t.task_id !== taskToDelete.task_id));
              toast.success(`Task "${taskToDelete.task_name}" deleted successfully!`);
              setTaskToDelete(null);
            } catch (error) {
              console.error("Error deleting task:", error);
              toast.error("Failed to delete task.");
              setTaskToDelete(null);
            }
          }}
          title="Delete Task"
          message={`Are you sure you want to delete task "${taskToDelete.task_name}"? This action cannot be undone.`}
          confirmLabel="Delete"
          cancelLabel="Cancel"
        />
      )}

      {/* Phase/Task Import Dialog */}
      <PhaseTaskImportDialog
        isOpen={showImportDialog}
        onClose={() => setShowImportDialog(false)}
        projectId={project.project_id}
        onImportComplete={(result) => {
          setShowImportDialog(false);
          if (result.success || result.tasksCreated > 0) {
            toast.success(`Imported ${result.phasesCreated} phases and ${result.tasksCreated} tasks`);
            // Refresh the page to show imported data
            window.location.reload();
          } else if (result.errors.length > 0) {
            toast.error(`Import failed: ${result.errors[0]}`);
          }
        }}
      />
    </div>
  );
}
