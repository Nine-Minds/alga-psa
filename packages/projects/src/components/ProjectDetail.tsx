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
import { findTagsByEntityId } from '@alga-psa/tags/actions';
import { getDocumentCountsForEntities } from '@alga-psa/documents/actions/documentActions';
import { getTaskCommentCountsBatch } from '../actions/projectTaskCommentActions';
import { TagFilter } from '@alga-psa/ui/components';
import { TagManager } from '@alga-psa/tags/components';
import { useTags } from '@alga-psa/tags/context';
import { useTagPermissions } from '@alga-psa/tags/hooks';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import MultiUserPicker from '@alga-psa/ui/components/MultiUserPicker';
import { Button } from '@alga-psa/ui/components/Button';
import { CollapseToggleButton } from '@alga-psa/ui/components/CollapseToggleButton';
import TaskQuickAdd from './TaskQuickAdd';
import TaskEdit from './TaskEdit';
import PhaseQuickAdd from './PhaseQuickAdd';
import TaskListView from './TaskListView';
import ViewSwitcher from '@alga-psa/ui/components/ViewSwitcher';
import { getProjectTaskStatuses, updatePhase, deletePhase, getProjectTreeData, reorderPhase } from '../actions/projectActions';
import { updateTaskStatus, reorderTask, reorderTasksInStatus, moveTaskToPhase, updateTaskWithChecklist, getTaskChecklistItems, getTaskResourcesAction, getTaskTicketLinksAction, duplicateTaskToPhase, deleteTask as deleteTaskAction, getTasksForPhase, getTaskById, getProjectTaskData } from '../actions/projectTaskActions';
import styles from './ProjectDetail.module.css';
import { Toaster, toast } from 'react-hot-toast';
import { handleError, isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import DuplicateTaskDialog, { DuplicateOptions } from './DuplicateTaskDialog';
import MoveTaskDialog from './MoveTaskDialog';
import ProjectPhases from './ProjectPhases';
import PhaseTaskImportDialog from './PhaseTaskImportDialog';
import KanbanBoard from './KanbanBoard';
import KanbanZoomControl, { calculateColumnWidth } from './KanbanZoomControl';
import DonutChart from './DonutChart';
import { calculateProjectCompletion } from '@alga-psa/projects/lib/projectUtils';
import { IClient } from '@alga-psa/types';
import { HelpCircle, LayoutGrid, List, Search, Pin, X, XCircle, CheckSquare, Bug, Sparkles, TrendingUp, Flag, BookOpen, Columns3, Plus } from 'lucide-react';
import { Tooltip } from '@alga-psa/ui/components/Tooltip';
import { generateKeyBetween } from 'fractional-indexing';
import KanbanBoardSkeleton from '@alga-psa/ui/components/skeletons/KanbanBoardSkeleton';
import { useUserPreferencesBatch } from '@alga-psa/user-composition/hooks';
import { getUserAvatarUrlsBatchAction } from '@alga-psa/user-composition/actions';
import { getTeamsBasic, getTeamAvatarUrlsBatchAction } from '@alga-psa/teams/actions';
import { useFeatureFlag } from '@alga-psa/ui/hooks';
import { useTheme } from 'next-themes';

const PROJECT_VIEW_MODE_SETTING = 'project_detail_view_mode';
const PROJECT_PHASES_PANEL_VISIBLE_SETTING = 'project_phases_panel_visible';
const PROJECT_KANBAN_ZOOM_LEVEL_SETTING = 'project_kanban_zoom_level';
const PROJECT_HEADER_PINNED_SETTING = 'project_header_pinned';
const PROJECT_KANBAN_STICKY_STATUS_NAMES_SETTING = 'project_kanban_sticky_status_names';

const STATUS_FALLBACK_BACKGROUNDS = ['#f3f4f6', '#e0e7ff', '#dcfce7', '#fef9c3'];
const STATUS_FALLBACK_BADGES = ['#e5e7eb', '#c7d2fe', '#bbf7d0', '#fef08a'];
const STATUS_FALLBACK_BORDERS = ['#d1d5db', '#a5b4fc', '#86efac', '#fde047'];

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

const normalizeHexColor = (color: string): string | null => {
  const value = color.trim();
  if (!value.startsWith('#')) return null;
  const hex = value.slice(1);
  if (hex.length === 3) {
    return `#${hex.split('').map((ch) => ch + ch).join('')}`;
  }
  if (hex.length === 6) {
    return value;
  }
  return null;
};

const hexToRgb = (hex: string): [number, number, number] | null => {
  const normalized = normalizeHexColor(hex);
  if (!normalized) return null;
  const raw = normalized.slice(1);
  const num = Number.parseInt(raw, 16);
  if (Number.isNaN(num)) return null;
  return [
    (num >> 16) & 0xff,
    (num >> 8) & 0xff,
    num & 0xff
  ];
};

const hexToRgba = (hex: string, alpha: number): string | null => {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const [r, g, b] = rgb;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

const lightenHexColor = (hex: string, amount: number): string | null => {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const [r, g, b] = rgb;
  const blend = (channel: number) => Math.min(255, Math.round(channel + (255 - channel) * amount));
  const next = [blend(r), blend(g), blend(b)]
    .map((channel) => channel.toString(16).padStart(2, '0'))
    .join('');
  return `#${next}`;
};

const darkenHexColor = (hex: string, amount: number): string | null => {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const [r, g, b] = rgb;
  const blend = (channel: number) => Math.max(0, Math.round(channel * (1 - amount)));
  const next = [blend(r), blend(g), blend(b)]
    .map((channel) => channel.toString(16).padStart(2, '0'))
    .join('');
  return `#${next}`;
};

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
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  // Batch-load all user preferences in a single server action (instead of 5 separate calls)
  type ProjectViewMode = 'kanban' | 'list';
  const prefs = useUserPreferencesBatch([
    { key: PROJECT_VIEW_MODE_SETTING, defaultValue: 'kanban' as ProjectViewMode, debounceMs: 300 },
    { key: PROJECT_PHASES_PANEL_VISIBLE_SETTING, defaultValue: true, debounceMs: 300 },
    { key: PROJECT_KANBAN_ZOOM_LEVEL_SETTING, defaultValue: 50, debounceMs: 300 },
    { key: PROJECT_HEADER_PINNED_SETTING, defaultValue: false, debounceMs: 300 },
    { key: PROJECT_KANBAN_STICKY_STATUS_NAMES_SETTING, defaultValue: false, debounceMs: 300 },
  ]);
  const { value: viewMode, setValue: setViewMode, isLoading: isViewModeLoading } = prefs[PROJECT_VIEW_MODE_SETTING];
  const { value: isPhasesPanelVisible, setValue: setIsPhasesPanelVisible } = prefs[PROJECT_PHASES_PANEL_VISIBLE_SETTING];
  const { value: kanbanZoomLevel, setValue: setKanbanZoomLevel } = prefs[PROJECT_KANBAN_ZOOM_LEVEL_SETTING];
  const { value: isHeaderPinned, setValue: setIsHeaderPinned } = prefs[PROJECT_HEADER_PINNED_SETTING];
  const { value: showStickyStatusNames, setValue: setShowStickyStatusNames } = prefs[PROJECT_KANBAN_STICKY_STATUS_NAMES_SETTING];

  const { enabled: teamsV2Enabled } = useFeatureFlag('teams-v2', { defaultValue: false });

  // Kanban view state (existing - phase-scoped)
  const [selectedTask, setSelectedTask] = useState<IProjectTask | null>(null);
  const selectedTaskIdRef = useRef<string | null>(null); // Ref for reliable access in callbacks
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [showPhaseQuickAdd, setShowPhaseQuickAdd] = useState(false);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [currentPhase, setCurrentPhase] = useState<IProjectPhase | null>(null);
  const [selectedPhase, setSelectedPhase] = useState<IProjectPhase | null>(null);

  // Shared project-wide task data (used by list view, sidebar counts, and filtering)
  const [projectTaskDataLoaded, setProjectTaskDataLoaded] = useState(false);
  const { openDrawer: _openDrawer, closeDrawer: _closeDrawer } = useDrawer();
  const [projectTasks, setProjectTasks] = useState<IProjectTask[]>([]);
  const [phaseTicketLinks, setPhaseTicketLinks] = useState<{ [taskId: string]: IProjectTicketLinkWithDetails[] }>({});
  const [phaseTaskResources, setPhaseTaskResources] = useState<{ [taskId: string]: any[] }>({});
  const [phaseTaskDependencies, setPhaseTaskDependencies] = useState<{ [taskId: string]: { predecessors: IProjectTaskDependency[]; successors: IProjectTaskDependency[] } }>({});
  const [avatarUrls, setAvatarUrls] = useState<Record<string, string | null>>({});
  const [teamNames, setTeamNames] = useState<Record<string, string>>({});
  const [teamAvatarUrls, setTeamAvatarUrls] = useState<Record<string, string | null>>({});
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

  // All project tasks — shared by sidebar counts, list view, and filtering
  const [allProjectTasks, setAllProjectTasks] = useState<IProjectTask[]>([]);
  const [allProjectTaskResources, setAllProjectTaskResources] = useState<Record<string, ITaskResource[]>>({});
  const [allProjectTaskTags, setAllProjectTaskTags] = useState<Record<string, ITag[]>>({});
  const [allChecklistItems, setAllChecklistItems] = useState<Record<string, any[]>>({});
  const [allTaskDependencies, setAllTaskDependencies] = useState<Record<string, { predecessors: IProjectTaskDependency[]; successors: IProjectTaskDependency[] }>>({});

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
    let stale = false;
    const fetchTags = async () => {
      if (!project.project_id) return;

      try {
        const tags = await findTagsByEntityId(project.project_id, 'project').catch((error) => {
          console.warn('Failed to fetch project tags, continuing without tags:', error);
          return [];
        });
        if (stale) return;

        setProjectTags(tags);

        // Notify parent component of tags update only once
        if (onTagsUpdate && !hasNotifiedParent.current) {
          const projectTagTexts = allTags.filter(tag => tag.tagged_type === 'project').map(tag => tag.tag_text);
          onTagsUpdate(tags, projectTagTexts);
          hasNotifiedParent.current = true;
        }
      } catch (error) {
        if (!stale) console.error('Error fetching project tags:', error);
      }
    };
    fetchTags();
    return () => { stale = true; };
  }, [project.project_id]);
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
  const [taskCommentCounts, setTaskCommentCounts] = useState<Record<string, number>>({});

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

  // Fetch all project task data on mount (shared by list view, sidebar counts, and filtering)
  useEffect(() => {
    let stale = false;
    const fetchAllTaskData = async () => {
      try {
        const data = await getProjectTaskData(project.project_id);
        if (stale) return;
        setAllProjectTasks(data.tasks);
        setAllProjectTaskResources(data.taskResources);
        setAllProjectTaskTags(data.taskTags);
        setAllChecklistItems(data.checklistItems);
        setAllTaskDependencies(data.taskDependencies);
        setProjectTaskDataLoaded(true);
      } catch (error) {
        if (!stale) handleError(error, 'Failed to load project tasks');
      }
    };
    fetchAllTaskData();
    return () => { stale = true; };
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
    if (allProjectTasks.length === 0) return {};
    const counts: Record<string, number> = {};
    allFilteredTasks.forEach(task => {
      if (task.phase_id) {
        counts[task.phase_id] = (counts[task.phase_id] || 0) + 1;
      }
    });
    return counts;
  }, [allFilteredTasks, allProjectTasks]);

  const [projectTreeData, setProjectTreeData] = useState<any[]>([]);
  const kanbanBoardRef = useRef<HTMLDivElement>(null);
  const kanbanHeaderRef = useRef<HTMLDivElement>(null);
  const scrollbarProxyRef = useRef<HTMLDivElement>(null);
  const stickyStatusStripRef = useRef<HTMLDivElement>(null);
  const [boardScrollWidth, setBoardScrollWidth] = useState(0);
  const [kanbanHeaderHeight, setKanbanHeaderHeight] = useState(0);
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

  const kanbanColumnWidth = useMemo(() => calculateColumnWidth(kanbanZoomLevel), [kanbanZoomLevel]);
  const visibleKanbanStatuses = useMemo(
    () => projectStatuses.filter((status) => status.is_visible),
    [projectStatuses]
  );
  const statusTaskCounts = useMemo(() => {
    return filteredTasks.reduce<Record<string, number>>((counts, task) => {
      const statusId = task.project_status_mapping_id;
      counts[statusId] = (counts[statusId] ?? 0) + 1;
      return counts;
    }, {});
  }, [filteredTasks]);

  const getStatusStripStyles = useCallback((status: ProjectStatus, index: number) => {
    if (status.color) {
      const base = status.color;
      if (isDark) {
        const itemBgHex = darkenHexColor(base, 0.75) ?? base;
        const itemBorderHex = darkenHexColor(base, 0.55) ?? base;
        const badgeBgHex = darkenHexColor(base, 0.65) ?? base;
        const textColor = lightenHexColor(base, 0.40) ?? base;

        return {
          itemStyle: {
            backgroundColor: hexToRgba(itemBgHex, 0.72) ?? itemBgHex,
            borderColor: hexToRgba(itemBorderHex, 0.8) ?? itemBorderHex,
            color: textColor,
          } as React.CSSProperties,
          countStyle: {
            backgroundColor: hexToRgba(badgeBgHex, 0.82) ?? badgeBgHex,
            color: textColor,
          } as React.CSSProperties,
        };
      }
      const itemBgHex = lightenHexColor(base, 0.72) ?? base;
      const itemBorderHex = lightenHexColor(base, 0.45) ?? base;
      const badgeBgHex = lightenHexColor(base, 0.62) ?? base;

      return {
        itemStyle: {
          backgroundColor: hexToRgba(itemBgHex, 0.72) ?? itemBgHex,
          borderColor: hexToRgba(itemBorderHex, 0.8) ?? itemBorderHex,
          color: base,
        } as React.CSSProperties,
        countStyle: {
          backgroundColor: hexToRgba(badgeBgHex, 0.82) ?? badgeBgHex,
          color: base,
        } as React.CSSProperties,
      };
    }

    if (isDark) {
      return {
        itemStyle: {
          backgroundColor: 'rgb(var(--color-border-100))',
          borderColor: 'rgb(var(--color-border-200))',
          color: 'rgb(var(--color-text-700))',
        } as React.CSSProperties,
        countStyle: {
          backgroundColor: 'rgb(var(--color-border-200))',
          color: 'rgb(var(--color-text-700))',
        } as React.CSSProperties,
      };
    }

    const paletteIndex = index % STATUS_FALLBACK_BACKGROUNDS.length;
    const itemBg = STATUS_FALLBACK_BACKGROUNDS[paletteIndex];
    const badgeBg = STATUS_FALLBACK_BADGES[paletteIndex];
    const border = STATUS_FALLBACK_BORDERS[paletteIndex];
    return {
      itemStyle: {
        backgroundColor: hexToRgba(itemBg, 0.72) ?? itemBg,
        borderColor: hexToRgba(border, 0.85) ?? border,
        color: 'rgb(var(--color-text-700))',
      } as React.CSSProperties,
      countStyle: {
        backgroundColor: hexToRgba(badgeBg, 0.82) ?? badgeBg,
        color: 'rgb(var(--color-text-700))',
      } as React.CSSProperties,
    };
  }, [isDark]);

  // Proxy scrollbar and sticky status strip: keep horizontal scroll positions in sync.
  useEffect(() => {
    const container = kanbanBoardRef.current;
    const proxy = scrollbarProxyRef.current;
    const stickyStrip = stickyStatusStripRef.current;
    if (!container || !proxy) return;

    let isSyncing = false;

    const syncScrollPositions = (source: 'container' | 'proxy' | 'sticky') => {
      if (isSyncing) return;
      isSyncing = true;
      const nextLeft = source === 'container'
        ? container.scrollLeft
        : source === 'proxy'
          ? proxy.scrollLeft
          : (stickyStrip?.scrollLeft ?? 0);

      if (source !== 'container') container.scrollLeft = nextLeft;
      if (source !== 'proxy') proxy.scrollLeft = nextLeft;
      if (stickyStrip && source !== 'sticky') stickyStrip.scrollLeft = nextLeft;
      isSyncing = false;
    };

    const onContainerScroll = () => syncScrollPositions('container');
    const onProxyScroll = () => syncScrollPositions('proxy');
    const onStickyStripScroll = () => syncScrollPositions('sticky');

    container.addEventListener('scroll', onContainerScroll);
    proxy.addEventListener('scroll', onProxyScroll);
    if (stickyStrip) {
      stickyStrip.addEventListener('scroll', onStickyStripScroll);
    }
    syncScrollPositions('container');

    // Track the board's scroll width with ResizeObserver
    const updateWidth = () => {
      setBoardScrollWidth(container.scrollWidth);
    };
    updateWidth();

    const ro = new ResizeObserver(updateWidth);
    ro.observe(container);
    // Also observe the first child (the kanban board) if it exists
    if (container.firstElementChild) {
      ro.observe(container.firstElementChild);
    }

    return () => {
      container.removeEventListener('scroll', onContainerScroll);
      proxy.removeEventListener('scroll', onProxyScroll);
      if (stickyStrip) {
        stickyStrip.removeEventListener('scroll', onStickyStripScroll);
      }
      ro.disconnect();
    };
  }, [showStickyStatusNames, viewMode]);

  // Track header height so the sticky status strip can stack below it when both are active
  useEffect(() => {
    const header = kanbanHeaderRef.current;
    if (!header) return;

    const updateHeight = () => {
      setKanbanHeaderHeight(header.getBoundingClientRect().height);
    };
    updateHeight();

    const ro = new ResizeObserver(updateHeight);
    ro.observe(header);
    return () => ro.disconnect();
  }, [viewMode]);

  // Keep selectedTaskIdRef in sync with selectedTask for reliable access in callbacks
  useEffect(() => {
    selectedTaskIdRef.current = selectedTask?.task_id ?? null;
  }, [selectedTask]);

  // Handle task move in list view (drag-and-drop)
  const handleListViewTaskMove = useCallback(async (
    taskId: string,
    newStatusMappingId: string,
    newPhaseId: string,
    beforeTaskId: string | null,
    afterTaskId: string | null
  ) => {
    try {
      const task = allProjectTasks.find(t => t.task_id === taskId);
      if (!task) {
        console.error('Task not found');
        return;
      }

      // Check if we're moving to a different phase
      if (task.phase_id !== newPhaseId) {
        // Move to different phase with new status
        await moveTaskToPhase(taskId, newPhaseId, newStatusMappingId);
        setAllProjectTasks(prev => prev.map(t =>
          t.task_id === taskId ? { ...t, phase_id: newPhaseId, project_status_mapping_id: newStatusMappingId } : t
        ));
        toast.success('Task moved to new phase');
      } else if (task.project_status_mapping_id !== newStatusMappingId) {
        // Same phase, different status
        await updateTaskStatus(taskId, newStatusMappingId, beforeTaskId, afterTaskId);
        setAllProjectTasks(prev => prev.map(t =>
          t.task_id === taskId ? { ...t, project_status_mapping_id: newStatusMappingId } : t
        ));
        toast.success('Task status updated');
      } else {
        // Same phase and status - just reorder
        await reorderTask(taskId, beforeTaskId, afterTaskId);
        toast.success('Task reordered');
      }
    } catch (error) {
      handleError(error, 'Failed to move task');
    }
  }, [allProjectTasks]);
  
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

    // Update shared project-wide tags
    setAllProjectTaskTags(prev => ({
      ...prev,
      [taskId]: tags
    }));
  };

  const handleCommentCountChange = useCallback((taskId: string, count: number) => {
    setTaskCommentCounts(prev => ({
      ...prev,
      [taskId]: count
    }));
  }, []);
  
  // Fetch project completion metrics, tree data, priorities, and task types in parallel
  useEffect(() => {
    let stale = false;
    const fetchInitialData = async () => {
      try {
        const [metrics, treeData, allPriorities, types] = await Promise.all([
          calculateProjectCompletion(project.project_id),
          getProjectTreeData(),
          getAllPriorities('project_task'),
          getTaskTypes(),
        ]);
        if (stale) return;

        setProjectMetrics({
          taskCompletionPercentage: metrics.taskCompletionPercentage,
          hoursCompletionPercentage: metrics.hoursCompletionPercentage,
          budgetedHours: metrics.budgetedHours,
          spentHours: metrics.spentHours,
          remainingHours: metrics.remainingHours
        });

        if (!isActionPermissionError(treeData)) {
          setProjectTreeData(treeData);
        }

        setPriorities(allPriorities);
        setTaskTypes(types);
      } catch (error) {
        if (!stale) handleError(error, 'Failed to load initial data');
      }
    };

    fetchInitialData();
    return () => { stale = true; };
  }, [project.project_id]);
  
  // When project-wide tags load, merge them into kanban tags (covers all phases)
  useEffect(() => {
    if (Object.keys(allProjectTaskTags).length === 0) return;
    setTaskTags(prev => ({ ...allProjectTaskTags, ...prev }));
  }, [allProjectTaskTags]);

  // Derive unique task tag options for the filter dropdown from allTags
  useEffect(() => {
    const taskTagsMap = new Map<string, ITag>();
    allTags
      .filter(tag => tag.tagged_type === 'project_task')
      .forEach(tag => {
        if (!taskTagsMap.has(tag.tag_text)) {
          taskTagsMap.set(tag.tag_text, tag);
        }
      });
    setAllTaskTags(Array.from(taskTagsMap.values()));
  }, [allTags]);

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
    let stale = false;
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
        const { tasks, ticketLinks, taskResources, taskDependencies, checklistItems, taskTags: phaseTags } = await getTasksForPhase(selectedPhase.phase_id);
        if (stale) return;

        // Add checklist items to tasks from batch-loaded data
        const tasksWithChecklists = tasks.map((task) => ({
          ...task,
          checklist_items: checklistItems[task.task_id] || []
        }));

        setProjectTasks(tasksWithChecklists);
        setPhaseTicketLinks(ticketLinks);
        setPhaseTaskResources(taskResources);
        setPhaseTaskDependencies(taskDependencies);

        // Merge phase tags into kanban tags
        setTaskTags(prev => ({ ...prev, ...phaseTags }));
      } catch (error) {
        if (!stale) handleError(error, 'Failed to load tasks for the selected phase');
      } finally {
        if (!stale) setIsLoadingTasks(false);
      }
    };

    fetchPhaseTasks();
    return () => { stale = true; };
  }, [selectedPhase]);

  // Fetch avatar URLs for task resources (additional agents)
  useEffect(() => {
    let stale = false;
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

      const tenant = project.tenant;
      if (!tenant) return;

      try {
        const avatarUrlsMap = await getUserAvatarUrlsBatchAction(Array.from(userIds), tenant);
        if (stale) return;
        const urlsRecord: Record<string, string | null> = {};
        avatarUrlsMap.forEach((url, id) => {
          urlsRecord[id] = url;
        });
        setAvatarUrls(urlsRecord);
      } catch (error) {
        if (!stale) console.error('Failed to fetch avatar URLs:', error);
      }
    };

    fetchAvatarUrls();
    return () => { stale = true; };
  }, [phaseTaskResources, project.tenant]);

  // Fetch team names and avatar URLs for tasks with assigned teams
  useEffect(() => {
    if (!teamsV2Enabled) return;
    let stale = false;

    const fetchTeamData = async () => {
      const tenant = project.tenant;
      if (!tenant) return;

      try {
        const allTeams = await getTeamsBasic();
        if (stale) return;
        const namesMap: Record<string, string> = {};
        allTeams.forEach(team => {
          namesMap[team.team_id] = team.team_name;
        });
        setTeamNames(namesMap);

        const teamIds = allTeams.map(t => t.team_id);
        if (teamIds.length > 0) {
          const avatarUrlsMap = await getTeamAvatarUrlsBatchAction(teamIds, tenant);
          if (stale) return;
          const urlsRecord: Record<string, string | null> = {};
          if (avatarUrlsMap instanceof Map) {
            avatarUrlsMap.forEach((url, id) => { urlsRecord[id] = url; });
          } else {
            Object.entries(avatarUrlsMap as Record<string, string | null>).forEach(([id, url]) => { urlsRecord[id] = url; });
          }
          setTeamAvatarUrls(urlsRecord);
        }
      } catch (error) {
        if (!stale) console.error('Failed to fetch team data:', error);
      }
    };

    fetchTeamData();
    return () => { stale = true; };
  }, [teamsV2Enabled, project.tenant]);

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
        handleError(error, 'Failed to load task');
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

  // Fetch document counts once when phase tasks load (not on filter changes)
  const phaseTaskIds = useMemo(() => projectTasks.map(t => t.task_id).sort().join(','), [projectTasks]);
  useEffect(() => {
    let stale = false;
    const fetchDocumentCounts = async () => {
      if (!selectedPhase || projectTasks.length === 0) {
        setTaskDocumentCounts(new Map());
        return;
      }

      try {
        const taskIds = projectTasks.map(task => task.task_id);
        const countMap = await getDocumentCountsForEntities(taskIds, 'project_task');
        if (!stale) setTaskDocumentCounts(countMap);
      } catch (error) {
        if (!stale) {
          console.error('Error fetching document counts:', error);
          setTaskDocumentCounts(new Map());
        }
      }
    };

    fetchDocumentCounts();
    return () => { stale = true; };
  }, [selectedPhase, phaseTaskIds]);

  // Fetch comment counts once when phase tasks load
  useEffect(() => {
    let stale = false;
    const fetchCommentCounts = async () => {
      if (!selectedPhase || projectTasks.length === 0) {
        setTaskCommentCounts({});
        return;
      }

      try {
        const taskIds = projectTasks.map(task => task.task_id);
        const counts = await getTaskCommentCountsBatch(taskIds);
        if (!stale) setTaskCommentCounts(counts);
      } catch (error) {
        if (!stale) {
          console.error('Error fetching comment counts:', error);
          setTaskCommentCounts({});
        }
      }
    };

    fetchCommentCounts();
    return () => { stale = true; };
  }, [selectedPhase, phaseTaskIds]);

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
      handleError(error, 'Failed to move task');
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
      
      const reorderResult = await reorderPhase(draggedPhaseId, beforePhaseId, afterPhaseId);
      if (isActionPermissionError(reorderResult)) {
        handleError(reorderResult.permissionError);
        return;
      }

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
      handleError(error, 'Failed to reorder phase');
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
      handleError(error, 'Failed to move task');
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
        const [checklistItems, taskResources] = await Promise.all([
          getTaskChecklistItems(newTask.task_id),
          getTaskResourcesAction(newTask.task_id)
        ]);
        const taskWithChecklist = { ...newTask, checklist_items: checklistItems };

        setProjectTasks((prevTasks) => [...prevTasks, taskWithChecklist]);

        // Update shared project-wide state
        setAllProjectTasks(prev => [...prev, taskWithChecklist]);
        setAllChecklistItems(prev => ({
          ...prev,
          [newTask.task_id]: checklistItems
        }));
        setAllProjectTaskTags(prev => ({
          ...prev,
          [newTask.task_id]: newTask.tags || []
        }));
        setPhaseTaskResources(prev => ({
          ...prev,
          [newTask.task_id]: taskResources
        }));
        setAllProjectTaskResources(prev => ({
          ...prev,
          [newTask.task_id]: taskResources
        }));
        setAllTaskDependencies(prev => ({
          ...prev,
          [newTask.task_id]: { predecessors: [], successors: [] }
        }));

        setShowQuickAdd(false);
        toast.success('New task added successfully!');
      } else {
        console.error('New task does not match selected phase');
        toast.error('Error adding new task: Phase mismatch');
      }
    } catch (error) {
      handleError(error, 'Error adding new task. Please try again.');
    } finally {
      setIsAddingTask(false);
    }
  }, [selectedPhase, currentPhase]);

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

        // Update shared project-wide state
        setAllProjectTasks(prev => {
          const exists = prev.some(t => t.task_id === updatedTask.task_id);
          return exists
            ? prev.map(t => t.task_id === updatedTask.task_id ? taskWithChecklist : t)
            : [...prev, taskWithChecklist];
        });
        setAllChecklistItems(prev => ({
          ...prev,
          [updatedTask.task_id]: checklistItems
        }));
        setAllProjectTaskResources(prev => ({
          ...prev,
          [updatedTask.task_id]: taskResources
        }));

        toast.success(taskWithChecklist.task_id ? 'Task updated successfully!' : 'Task added successfully!');
      } catch (error) {
        handleError(error, 'Failed to update task');
      }
    } else {
      // Task deleted - use ref for reliable access
      const deletedTaskId = selectedTaskIdRef.current;
      if (deletedTaskId) {
        setProjectTasks((prevTasks) =>
          prevTasks.filter((task) => task.task_id !== deletedTaskId)
        );

        // Remove from shared project-wide state
        setAllProjectTasks(prev => prev.filter(t => t.task_id !== deletedTaskId));

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
      const task = projectTasks.find(t => t.task_id === taskId) || allProjectTasks.find(t => t.task_id === taskId);
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

        // Update shared project-wide state
        setAllProjectTasks(prev => prev.map(t =>
          t.task_id === taskId ? taskWithChecklist : t
        ));

        toast.success('Task assignee updated successfully!');
      }
    } catch (error) {
      handleError(error, 'Failed to update task assignee. Please try again.');
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
      if (isActionPermissionError(updatedPhase)) {
        handleError(updatedPhase.permissionError);
        return;
      }

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
      handleError(error, 'Failed to update phase. Please try again.');
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
      const deleteResult = await deletePhase(deletePhaseConfirmation.phaseId);
      if (isActionPermissionError(deleteResult)) {
        handleError(deleteResult.permissionError);
        return;
      }
      setProjectPhases(prevPhases =>
        prevPhases.filter(phase => phase.phase_id !== deletePhaseConfirmation.phaseId)
      );
      if (selectedPhase?.phase_id === deletePhaseConfirmation.phaseId) {
        setSelectedPhase(null);
      }
      toast.success('Phase deleted successfully!');
    } catch (error) {
      handleError(error, 'Failed to delete phase. Please try again.');
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
      handleError(error, 'Failed to reorder tasks');
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
        handleError(error, "Failed to load task details for duplication.");
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
      handleError(error, 'Failed to move task');
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
                <Button
                  id="pin-header-toggle-list"
                  variant="ghost"
                  size="sm"
                  className={`p-1.5 h-auto w-auto transition-colors ${
                    isHeaderPinned
                      ? 'bg-primary-100 text-primary-600'
                      : 'text-gray-400 hover:text-gray-600'
                  }`}
                  onClick={() => setIsHeaderPinned(!isHeaderPinned)}
                  aria-label={isHeaderPinned ? "Unpin header" : "Pin header to top"}
                >
                  <Pin className={`h-4 w-4 ${isHeaderPinned ? 'fill-current' : ''}`} />
                </Button>
              </Tooltip>
              <ViewSwitcher
                currentView={viewMode}
                onChange={(v) => setViewMode(v as ProjectViewMode)}
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
                  className="pl-8 pr-8 py-1.5 text-sm border border-gray-300 dark:border-[rgb(var(--color-border-200))] rounded-md w-64 bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary-500 focus:border-primary-500"
                />
                {searchQuery && (
                  <Button
                    id="clear-search"
                    variant="ghost"
                    size="sm"
                    className="absolute right-1 top-1/2 -translate-y-1/2 p-1 h-auto w-auto text-gray-400 hover:text-gray-600"
                    onClick={() => setSearchQuery('')}
                    aria-label="Clear search"
                  >
                    <X className="h-4 w-4" />
                  </Button>
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
              <div className="[&_button]:bg-background [&_button]:dark:bg-[rgb(var(--color-card))] [&_button>span]:!text-gray-700 [&_button>span]:dark:!text-gray-300">
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

            {/* Reset filters button */}
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
              className={`shrink-0 flex items-center gap-1 ${(searchQuery || searchWholeWord || searchCaseSensitive || selectedTaskTags.length > 0 || selectedAgentFilter.length > 0 || includeUnassignedAgents || primaryAgentOnly || selectedPriorityFilter !== 'all' || selectedTaskTypeFilter !== 'all') ? 'text-gray-500 hover:text-gray-700' : 'invisible'}`}
              disabled={!(searchQuery || searchWholeWord || searchCaseSensitive || selectedTaskTags.length > 0 || selectedAgentFilter.length > 0 || includeUnassignedAgents || primaryAgentOnly || selectedPriorityFilter !== 'all' || selectedTaskTypeFilter !== 'all')}
            >
              <XCircle className="h-4 w-4" />
              Reset
            </Button>
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
            <Tooltip content={showStickyStatusNames ? "Hide sticky status names" : "Show sticky status names"}>
              <Button
                id="sticky-status-names-toggle-kanban"
                variant="ghost"
                size="sm"
                className={`p-1.5 h-auto w-auto transition-colors ${
                  showStickyStatusNames
                    ? 'bg-primary-100 text-primary-600'
                    : 'text-gray-400 hover:text-gray-600'
                }`}
                onClick={() => setShowStickyStatusNames(!showStickyStatusNames)}
                aria-label={showStickyStatusNames ? "Hide sticky status names" : "Show sticky status names"}
              >
                <Columns3 className="h-4 w-4" />
              </Button>
            </Tooltip>
            <Tooltip content={isHeaderPinned ? "Unpin header" : "Pin header to top"}>
              <Button
                id="pin-header-toggle-kanban"
                variant="ghost"
                size="sm"
                className={`p-1.5 h-auto w-auto transition-colors ${
                  isHeaderPinned
                    ? 'bg-primary-100 text-primary-600'
                    : 'text-gray-400 hover:text-gray-600'
                }`}
                onClick={() => setIsHeaderPinned(!isHeaderPinned)}
                aria-label={isHeaderPinned ? "Unpin header" : "Pin header to top"}
              >
                <Pin className={`h-4 w-4 ${isHeaderPinned ? 'fill-current' : ''}`} />
              </Button>
            </Tooltip>
            <ViewSwitcher
              currentView={viewMode}
              onChange={(v) => setViewMode(v as ProjectViewMode)}
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
                  className="pl-8 pr-8 py-1.5 text-sm border border-gray-300 dark:border-[rgb(var(--color-border-200))] rounded-md w-64 bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary-500 focus:border-primary-500"
                />
                {searchQuery && (
                  <Button
                    id="clear-search"
                    variant="ghost"
                    size="sm"
                    className="absolute right-1 top-1/2 -translate-y-1/2 p-1 h-auto w-auto text-gray-400 hover:text-gray-600"
                    onClick={() => setSearchQuery('')}
                    aria-label="Clear search"
                  >
                    <X className="h-4 w-4" />
                  </Button>
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
              <div className="[&_button]:bg-background [&_button]:dark:bg-[rgb(var(--color-card))] [&_button>span]:!text-gray-700 [&_button>span]:dark:!text-gray-300">
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

            {/* Reset filters button */}
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
              className={`shrink-0 flex items-center gap-1 ${(searchQuery || searchWholeWord || searchCaseSensitive || selectedTaskTags.length > 0 || selectedAgentFilter.length > 0 || includeUnassignedAgents || primaryAgentOnly || selectedPriorityFilter !== 'all' || selectedTaskTypeFilter !== 'all') ? 'text-gray-500 hover:text-gray-700' : 'invisible'}`}
              disabled={!(searchQuery || searchWholeWord || searchCaseSensitive || selectedTaskTags.length > 0 || selectedAgentFilter.length > 0 || includeUnassignedAgents || primaryAgentOnly || selectedPriorityFilter !== 'all' || selectedTaskTypeFilter !== 'all')}
            >
              <XCircle className="h-4 w-4" />
              Reset
            </Button>
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
      if (!projectTaskDataLoaded) {
        return (
          <div className="flex items-center justify-center h-64">
            <div className="text-gray-500">Loading list view...</div>
          </div>
        );
      }

      return (
        <TaskListView
          phases={projectPhases}
          tasks={allProjectTasks}
          statuses={projectStatuses}
          taskResources={allProjectTaskResources}
          taskTags={allProjectTaskTags}
          taskDependencies={allTaskDependencies}
          checklistItems={Object.entries(allChecklistItems).reduce((acc, [taskId, items]) => {
            acc[taskId] = {
              total: items.length,
              completed: items.filter((item: any) => item.completed).length,
              items: items.map((item: any) => ({ item_name: item.item_name, completed: item.completed }))
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
            const phase = projectPhases.find(p => p.phase_id === phaseId);
            if (phase) {
              setCurrentPhase(phase);
              setShowQuickAdd(true);
            }
          }}
          onTaskTagsChange={handleTaskTagsChange}
          onAssigneeChange={(taskId, newAssigneeId) => handleAssigneeChange(taskId, newAssigneeId)}
          users={users}
          teamNames={teamNames}
          teamAvatarUrls={teamAvatarUrls}
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
            taskCommentCounts={taskCommentCounts}
            allTaskTags={allTaskTags}
            priorities={priorities}
            projectTreeData={projectTreeData}
            animatingTasks={animatingTasks}
            avatarUrls={avatarUrls}
            teamNames={teamNames}
            teamAvatarUrls={teamAvatarUrls}
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
              <CollapseToggleButton
                id="toggle-phases-panel"
                isCollapsed={!isPhasesPanelVisible}
                collapsedLabel="Show phases panel"
                expandedLabel="Hide phases panel"
                className={styles.phasesPanelToggle}
                onClick={() => setIsPhasesPanelVisible(!isPhasesPanelVisible)}
              />

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
            <div
              ref={kanbanHeaderRef}
              className={`${styles.kanbanHeader} ${isHeaderPinned ? styles.kanbanHeaderPinned : ''}`}
            >
              {renderHeader()}
              {/* Proxy scrollbar — sits at the bottom edge of the header */}
              <div className={styles.kanbanScrollbarProxy} ref={scrollbarProxyRef}>
                <div className={styles.kanbanScrollbarProxyInner} style={{ width: boardScrollWidth }} />
              </div>
            </div>
            {/* Independent sticky status strip */}
            {showStickyStatusNames && viewMode === 'kanban' && (
              <div
                className={styles.kanbanStatusStripSticky}
                style={{ top: isHeaderPinned ? `${kanbanHeaderHeight}px` : 0 }}
              >
                <div className={styles.kanbanStatusStripScroller} ref={stickyStatusStripRef}>
                  <div className={styles.kanbanStatusStripTrack}>
                    {visibleKanbanStatuses.map((status, index) => {
                      const { itemStyle, countStyle } = getStatusStripStyles(status, index);
                      return (
                        <div
                          key={status.project_status_mapping_id}
                          className={styles.kanbanStatusStripItem}
                          style={{
                            ...itemStyle,
                            width: `${kanbanColumnWidth}px`,
                            minWidth: `${kanbanColumnWidth}px`,
                            maxWidth: `${kanbanColumnWidth}px`,
                          }}
                          title={status.custom_name || status.name}
                        >
                          <span className={styles.kanbanStatusStripName}>
                            {status.custom_name || status.name}
                          </span>
                          <Button
                            id={`sticky-add-task-button-${status.project_status_mapping_id}`}
                            variant="default"
                            size="sm"
                            onClick={() => handleAddCard(status)}
                            disabled={isAddingTask || !selectedPhase}
                            tooltipText="Add Task"
                            tooltip={true}
                            className="!w-5 !h-5 !p-0 !min-w-0 flex-shrink-0"
                          >
                            <Plus className="w-3 h-3 text-white" />
                          </Button>
                          <span className={styles.kanbanStatusStripCount} style={countStyle}>
                            {statusTaskCounts[status.project_status_mapping_id] ?? 0}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
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
            <Button
              id="close-quick-add"
              variant="ghost"
              size="sm"
              className="absolute top-2 right-2 p-1 h-auto w-auto text-gray-500 hover:text-gray-700"
              onClick={handleCloseQuickAdd}
              aria-label="Close"
            >
              ×
            </Button>
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
                onCommentCountChange={handleCommentCountChange}
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
              handleError(error, "Failed to duplicate task.");
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
              handleError(error, "Failed to delete task.");
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
