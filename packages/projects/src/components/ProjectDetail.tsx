'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { IProject, IProjectPhase, IProjectTask, IProjectTicketLink, IProjectTicketLinkWithDetails, ProjectStatus, ITaskType, IProjectTaskDependency } from '@alga-psa/types';
import { IUserWithRoles } from '@alga-psa/types';
import { IPriority, IStandardPriority } from '@alga-psa/types';
import { ITag } from '@alga-psa/types';
import { ITaskResource } from '@alga-psa/types';
import { useDrawer } from "@alga-psa/ui";
import { extractTaskDescriptionText } from '../lib/taskRichText';
import {
  projectKanbanHiddenStatusesKey,
  getKanbanStatusIdentity,
  normalizeHiddenStatusIds,
  toggleHiddenStatusId,
} from '../lib/kanbanPreferences';
import { getAllPriorities } from '@alga-psa/reference-data/actions';
import { getTaskTypes } from '../actions/projectTaskActions';
import { findTagsByEntityId, findTagsByEntityIds, isTagActionError } from '@alga-psa/tags/actions';
import { useDocumentsCrossFeature } from '@alga-psa/core/context/DocumentsCrossFeatureContext';
import { getTaskCommentCountsBatch } from '../actions/projectTaskCommentActions';
import { TagFilter } from '@alga-psa/ui/components';
import { TagManager } from '@alga-psa/tags/components';
import { useTags } from '@alga-psa/tags/context';
import { useTagPermissions } from '@alga-psa/tags/hooks';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import MultiUserAndTeamPicker from '@alga-psa/ui/components/MultiUserAndTeamPicker';
import { Button } from '@alga-psa/ui/components/Button';
import { CollapseToggleButton } from '@alga-psa/ui/components/CollapseToggleButton';
import TaskQuickAdd from './TaskQuickAdd';
import TaskEdit from './TaskEdit';
import PhaseQuickAdd from './PhaseQuickAdd';
import TaskListView from './TaskListView';
import ViewSwitcher from '@alga-psa/ui/components/ViewSwitcher';
import { getProjectTaskStatuses, getProjectStatusesByPhase, updatePhase, deletePhase, getProjectTreeData, reorderPhase } from '../actions/projectActions';
import { updateTaskStatus, reorderTask, reorderTasksInStatus, moveTaskToPhase, updateTaskWithChecklist, getTaskChecklistItems, getTaskResourcesAction, getTaskTicketLinksAction, duplicateTaskToPhase, deleteTask as deleteTaskAction, getTasksForPhase, getTaskById, getProjectTaskData, assignTeamToProjectTask, removeTeamFromProjectTask, bulkAddTagsToTasks } from '../actions/projectTaskActions';
import styles from './ProjectDetail.module.css';
import { toast } from 'react-hot-toast';
import {
  getErrorMessage,
  handleError,
  isActionMessageError,
  isActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import DuplicateTaskDialog, { DuplicateOptions } from './DuplicateTaskDialog';
import MoveTaskDialog from './MoveTaskDialog';
import BulkMoveTaskDialog from './BulkMoveTaskDialog';
import BulkAssignDialog from './BulkAssignDialog';
import BulkAddTagsToTasksDialog from './BulkAddTagsToTasksDialog';
import BulkTaskActionBar from './BulkTaskActionBar';
import { useTaskSelection } from './TaskSelectionContext';
import ProjectPhases from './ProjectPhases';
import PhaseTaskImportDialog from './PhaseTaskImportDialog';
import KanbanBoard from './KanbanBoard';
import { useKanbanPan } from './useKanbanPan';
import KanbanZoomControl, { calculateColumnWidth } from './KanbanZoomControl';
import ViewDensityControl from '@alga-psa/ui/components/ViewDensityControl';
import DonutChart from './DonutChart';
import { calculateProjectCompletion } from '@alga-psa/projects/lib/projectUtils';
import { IClient } from '@alga-psa/types';
import { HelpCircle, LayoutGrid, List, Search, Pin, X, XCircle, ClipboardList, Bug, Sparkles, TrendingUp, Flag, BookOpen, Columns3, Plus, EyeOff, Eye } from 'lucide-react';
import { Tooltip } from '@alga-psa/ui/components/Tooltip';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import { Popover, PopoverTrigger, PopoverContent } from '@alga-psa/ui/components/Popover';
import { generateKeyBetween } from 'fractional-indexing';
import KanbanBoardSkeleton from '@alga-psa/ui/components/skeletons/KanbanBoardSkeleton';
import { useUserPreferencesBatch } from '@alga-psa/user-composition/hooks';
import { getUserAvatarUrlsBatchAction } from '@alga-psa/user-composition/actions';
import { getTeams, getTeamAvatarUrlsBatchAction, isTeamActionError } from '@alga-psa/teams/actions';
import type { ITeam } from '@alga-psa/types';
import RemoveTeamDialog from './RemoveTeamDialog';
import { useTheme } from 'next-themes';
import { useTranslation } from 'react-i18next';

const PROJECT_VIEW_MODE_SETTING = 'project_detail_view_mode';
const PROJECT_PHASES_PANEL_VISIBLE_SETTING = 'project_phases_panel_visible';
const PROJECT_KANBAN_ZOOM_LEVEL_SETTING = 'project_kanban_zoom_level';
const PROJECT_HEADER_PINNED_SETTING = 'project_header_pinned';
const PROJECT_KANBAN_STICKY_STATUS_NAMES_SETTING = 'project_kanban_sticky_status_names';
// Per-user, per-project set of status identities the user has chosen to hide
// from the kanban board (see kanbanPreferences for the setting name / value shape).
// Purely visual (does not change the admin `is_visible` config) — it just
// declutters the board to make dragging across columns easier.
const PROJECT_LIST_DENSITY_LEVEL_SETTING = 'project_list_density_level';
const PROJECT_LIST_COLUMN_WIDTHS_SETTING = 'project_list_column_widths';
// Legacy localStorage key previously used by TaskListView; reused for one-time
// hydration so existing per-project widths survive the move to server prefs.
const projectListColumnWidthsLegacyKey = (projectId: string) =>
  `tasklistview-column-sizing:${projectId}`;

function isReturnedActionError(value: unknown): value is { actionError: string } | { permissionError: string } {
  return isActionMessageError(value) || isActionPermissionError(value);
}

function unwrapActionResult<T>(value: T | { actionError: string } | { permissionError: string }): T {
  if (isReturnedActionError(value)) {
    throw new Error(getErrorMessage(value));
  }
  return value;
}

// Row density (zoom) presets for the list view, mirroring the tickets table.
// Indexed by level/10 (0..10); each scales row vertical padding + font size,
// plus the in-cell tag/picker/avatar sizes so those controls resize with zoom.
// `[&>td_*]:!text-[Xpx]` forces descendant text to follow the row size.
// The `row` strings MUST be literal so Tailwind's scanner emits the utilities.
const PROJECT_LIST_DENSITY_STEP = 10;
const PROJECT_LIST_DENSITY_DEFAULT = 50; // matches the tickets table default
interface ProjectListDensityPreset {
  /** Cell vertical padding + font size (px) for this level. */
  cellPadding: string;
  fontPx: number;
  /** Column width multiplier — fewer columns fit as it grows. */
  scale: number;
  tagSize: 'sm' | 'md' | 'lg';
  pickerSize: 'xs' | 'sm' | 'lg';
  avatarSize: 'xs' | 'sm' | 'md';
}
const PROJECT_LIST_DENSITY_PRESETS: readonly ProjectListDensityPreset[] = [
  { cellPadding: '2px',  fontPx: 11, scale: 0.79, tagSize: 'sm', pickerSize: 'xs', avatarSize: 'xs' },
  { cellPadding: '4px',  fontPx: 12, scale: 0.86, tagSize: 'sm', pickerSize: 'xs', avatarSize: 'xs' },
  { cellPadding: '6px',  fontPx: 12, scale: 0.86, tagSize: 'sm', pickerSize: 'xs', avatarSize: 'xs' },
  { cellPadding: '8px',  fontPx: 13, scale: 0.93, tagSize: 'sm', pickerSize: 'sm', avatarSize: 'sm' },
  { cellPadding: '10px', fontPx: 13, scale: 0.93, tagSize: 'sm', pickerSize: 'sm', avatarSize: 'sm' },
  { cellPadding: '12px', fontPx: 14, scale: 1.0,  tagSize: 'md', pickerSize: 'sm', avatarSize: 'sm' },
  { cellPadding: '14px', fontPx: 14, scale: 1.0,  tagSize: 'md', pickerSize: 'sm', avatarSize: 'sm' },
  { cellPadding: '16px', fontPx: 15, scale: 1.07, tagSize: 'md', pickerSize: 'lg', avatarSize: 'md' },
  { cellPadding: '20px', fontPx: 15, scale: 1.07, tagSize: 'md', pickerSize: 'lg', avatarSize: 'md' },
  { cellPadding: '24px', fontPx: 16, scale: 1.14, tagSize: 'md', pickerSize: 'lg', avatarSize: 'md' },
  { cellPadding: '28px', fontPx: 17, scale: 1.21, tagSize: 'md', pickerSize: 'lg', avatarSize: 'md' },
];

const STATUS_FALLBACK_BACKGROUNDS = ['#f3f4f6', '#e0e7ff', '#dcfce7', '#fef9c3'];
const STATUS_FALLBACK_BADGES = ['#e5e7eb', '#c7d2fe', '#bbf7d0', '#fef08a'];
const STATUS_FALLBACK_BORDERS = ['#d1d5db', '#a5b4fc', '#86efac', '#fde047'];
type TaskLayoutSnapshot = Map<string, { left: number; top: number }>;

// Task type icons for the filter dropdown
const taskTypeIcons: Record<string, React.ComponentType<any>> = {
  task: ClipboardList,
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
  const { t } = useTranslation(['features/projects', 'common']);
  useTagPermissions(['project', 'project_task']);
  const { getDocumentCountsForEntities } = useDocumentsCrossFeature();
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  // Batch-load all user preferences in a single server action (instead of 5 separate calls)
  type ProjectViewMode = 'kanban' | 'list';
  // Column widths are scoped per project (each project can show different
  // columns), so the preference key includes the project id.
  const columnWidthsPrefKey = `${PROJECT_LIST_COLUMN_WIDTHS_SETTING}:${project.project_id}`;
  // Hidden kanban columns are scoped per project and keyed by the underlying
  // status identity (`standard_status_id` for standard statuses, `status_id` for
  // custom statuses). This survives phase customization/reversion because those
  // flows replace mapping rows while preserving the underlying status identity.
  const hiddenStatusesPrefKey = projectKanbanHiddenStatusesKey(project.project_id);
  const prefs = useUserPreferencesBatch([
    { key: PROJECT_VIEW_MODE_SETTING, defaultValue: 'kanban' as ProjectViewMode, debounceMs: 300 },
    { key: PROJECT_PHASES_PANEL_VISIBLE_SETTING, defaultValue: true, debounceMs: 300 },
    { key: PROJECT_KANBAN_ZOOM_LEVEL_SETTING, defaultValue: 50, debounceMs: 300 },
    { key: PROJECT_HEADER_PINNED_SETTING, defaultValue: false, debounceMs: 300 },
    { key: PROJECT_KANBAN_STICKY_STATUS_NAMES_SETTING, defaultValue: false, debounceMs: 300 },
    { key: hiddenStatusesPrefKey, defaultValue: [] as string[], debounceMs: 300 },
    { key: PROJECT_LIST_DENSITY_LEVEL_SETTING, defaultValue: PROJECT_LIST_DENSITY_DEFAULT, debounceMs: 300 },
    {
      key: columnWidthsPrefKey,
      defaultValue: {} as Record<string, number>,
      localStorageKey: projectListColumnWidthsLegacyKey(project.project_id),
      debounceMs: 500,
    },
  ]);
  const { value: viewMode, setValue: setViewMode, isLoading: isViewModeLoading } = prefs[PROJECT_VIEW_MODE_SETTING];
  const { value: isPhasesPanelVisible, setValue: setIsPhasesPanelVisible } = prefs[PROJECT_PHASES_PANEL_VISIBLE_SETTING];
  const { value: kanbanZoomLevel, setValue: setKanbanZoomLevel } = prefs[PROJECT_KANBAN_ZOOM_LEVEL_SETTING];
  const { value: isHeaderPinned, setValue: setIsHeaderPinned } = prefs[PROJECT_HEADER_PINNED_SETTING];
  const { value: showStickyStatusNames, setValue: setShowStickyStatusNames } = prefs[PROJECT_KANBAN_STICKY_STATUS_NAMES_SETTING];
  const { value: hiddenKanbanStatusIds, setValue: setHiddenKanbanStatusIds } = prefs[hiddenStatusesPrefKey];
  const { value: listDensityLevel, setValue: setListDensityLevel } = prefs[PROJECT_LIST_DENSITY_LEVEL_SETTING];
  const { value: listColumnWidths, setValue: setListColumnWidths } = prefs[columnWidthsPrefKey];
  const listDensity = useMemo(() => {
    const index = Math.min(
      PROJECT_LIST_DENSITY_PRESETS.length - 1,
      Math.max(0, Math.round((listDensityLevel ?? PROJECT_LIST_DENSITY_DEFAULT) / PROJECT_LIST_DENSITY_STEP))
    );
    return PROJECT_LIST_DENSITY_PRESETS[index];
  }, [listDensityLevel]);

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
  const [teams, setTeams] = useState<ITeam[]>([]);
  const [teamNames, setTeamNames] = useState<Record<string, string>>({});
  const [teamAvatarUrls, setTeamAvatarUrls] = useState<Record<string, string | null>>({});
  const [pendingTeamAssign, setPendingTeamAssign] = useState<{ taskId: string; teamId: string } | null>(null);
  const [pendingTaskTeamMembers, setPendingTaskTeamMembers] = useState<any[]>([]);
  const [isTeamSwitchDialogOpen, setIsTeamSwitchDialogOpen] = useState(false);
  const [projectPhases, setProjectPhases] = useState<IProjectPhase[]>(phases);
  const [projectStatuses, setProjectStatuses] = useState<ProjectStatus[]>(initialStatuses);
  const [statusVersion, setStatusVersion] = useState(0);
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
    /** When present, this is a bulk move of all these task IDs (taskId is the grabbed one). */
    taskIds?: string[];
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

  // Bulk task selection / actions
  const { selectedTaskIds, clearSelection, setTasksSelected } = useTaskSelection();
  const [isBulkMoveOpen, setIsBulkMoveOpen] = useState(false);
  const [isBulkAssignOpen, setIsBulkAssignOpen] = useState(false);
  const [isBulkTagsOpen, setIsBulkTagsOpen] = useState(false);
  const [bulkTagsErrors, setBulkTagsErrors] = useState<Array<{ taskId: string; message: string }>>([]);
  const [isBulkAddingTags, setIsBulkAddingTags] = useState(false);
  const [isBulkDeleteOpen, setIsBulkDeleteOpen] = useState(false);

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
  // Effective status mappings per phase — the list view renders every phase at
  // once, and status mapping IDs are phase-specific, so a single phase's
  // statuses cannot bucket tasks from other phases.
  const [statusesByPhase, setStatusesByPhase] = useState<Record<string, ProjectStatus[]>>({});

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

  useEffect(() => {
    let stale = false;

    const fetchStatusesForPhase = async () => {
      if (!selectedPhase) {
        setProjectStatuses(initialStatuses);
        return;
      }

      try {
        const statuses = await getProjectTaskStatuses(project.project_id, selectedPhase.phase_id);
        if (!stale) {
          setProjectStatuses(statuses);
        }
      } catch (error) {
        if (!stale) {
          console.error('Error fetching phase-effective statuses:', error);
        }
      }
    };

    fetchStatusesForPhase();
    return () => { stale = true; };
  }, [initialStatuses, project.project_id, selectedPhase?.phase_id, statusVersion]);

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
        if (isTagActionError(tags)) {
          console.warn('Failed to fetch project tags, continuing without tags:', tags);
          setProjectTags([]);
          return;
        }

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
  const [selectedTeamFilter, setSelectedTeamFilter] = useState<string[]>([]);
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

  const matchesSearch = useCallback((task: IProjectTask): boolean => {
    if (!searchQuery.trim()) return true;
    const query = searchCaseSensitive ? searchQuery : searchQuery.toLowerCase();
    const taskName = searchCaseSensitive ? task.task_name : task.task_name.toLowerCase();
    const descText = extractTaskDescriptionText(task.description_rich_text ?? task.description);
    const taskDescription = searchCaseSensitive ? descText : descText.toLowerCase();

    if (searchWholeWord) {
      const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const wordRegex = new RegExp(`\\b${escapedQuery}\\b`, searchCaseSensitive ? '' : 'i');
      return wordRegex.test(task.task_name) || wordRegex.test(descText);
    }
    return taskName.includes(query) || taskDescription.includes(query);
  }, [searchQuery, searchCaseSensitive, searchWholeWord]);

  const filteredTasks = useMemo(() => {
    if (!selectedPhase) return [];
    let tasks = projectTasks.filter(task => task.wbs_code.startsWith(selectedPhase.wbs_code + '.'));

    // Apply search filter
    if (searchQuery.trim()) {
      tasks = tasks.filter(matchesSearch);
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

    // Apply agent / team filter
    if (selectedAgentFilter.length > 0 || selectedTeamFilter.length > 0 || includeUnassignedAgents) {
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

        // If specific teams are selected, match by the task's assigned team
        if (selectedTeamFilter.length > 0 && task.assigned_team_id && selectedTeamFilter.includes(task.assigned_team_id)) {
          return true;
        }

        return false;
      });
    }

    return tasks;
  }, [projectTasks, selectedPhase, matchesSearch, searchQuery, selectedPriorityFilter, selectedTaskTypeFilter, selectedTaskTags, taskTags, selectedAgentFilter, selectedTeamFilter, includeUnassignedAgents, primaryAgentOnly, phaseTaskResources]);

  const phaseStatusLookup = useMemo(
    () => new Map(projectStatuses.map((status) => [status.project_status_mapping_id, status])),
    [projectStatuses]
  );

  const completedTasksCount = useMemo(() => {
    return filteredTasks.filter(task =>
      phaseStatusLookup.get(task.project_status_mapping_id)?.is_closed === true
    ).length;
  }, [filteredTasks, phaseStatusLookup]);

  // Fetch all project task data on mount (shared by list view, sidebar counts, and filtering)
  useEffect(() => {
    let stale = false;
    const fetchAllTaskData = async () => {
      try {
        const [data, phaseStatuses] = await Promise.all([
          getProjectTaskData(project.project_id),
          getProjectStatusesByPhase(project.project_id),
        ]);
        if (stale) return;
        if (isReturnedActionError(data)) {
          handleError(data);
          return;
        }
        if (isReturnedActionError(phaseStatuses)) {
          handleError(phaseStatuses);
          return;
        }
        setAllProjectTasks(data.tasks);
        setAllProjectTaskResources(data.taskResources);
        setAllProjectTaskTags(data.taskTags);
        setAllChecklistItems(data.checklistItems);
        setAllTaskDependencies(data.taskDependencies);
        setStatusesByPhase(phaseStatuses);
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
      filtered = filtered.filter(matchesSearch);
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

    // Apply agent / team filter
    if (selectedAgentFilter.length > 0 || selectedTeamFilter.length > 0 || includeUnassignedAgents) {
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

        if (selectedTeamFilter.length > 0 && task.assigned_team_id && selectedTeamFilter.includes(task.assigned_team_id)) {
          return true;
        }

        return false;
      });
    }

    return filtered;
  }, [allProjectTasks, matchesSearch, searchQuery, selectedPriorityFilter, selectedTaskTypeFilter, selectedTaskTags, allProjectTaskTags, selectedAgentFilter, selectedTeamFilter, includeUnassignedAgents, primaryAgentOnly, allProjectTaskResources]);

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
  useKanbanPan(kanbanBoardRef, viewMode === 'kanban');
  const kanbanHeaderRef = useRef<HTMLDivElement>(null);
  const scrollbarTrackRef = useRef<HTMLDivElement>(null);
  const scrollbarThumbRef = useRef<HTMLDivElement>(null);
  const dragAbortRef = useRef<AbortController | null>(null);
  const stickyStatusStripRef = useRef<HTMLDivElement>(null);
  const taskLayoutAnimationsRef = useRef<Map<string, Animation>>(new Map());
  const [kanbanHeaderHeight, setKanbanHeaderHeight] = useState(0);
  const [phasesPanelHeight, setPhasesPanelHeight] = useState<number | null>(null);
  const scrollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const scrollSpeedsRef = useRef<{ horizontal: number; vertical: number; column: HTMLElement | null }>({
    horizontal: 0,
    vertical: 0,
    column: null
  });
  const phasesContainerRef = useRef<HTMLDivElement>(null);
  const pageContainerRef = useRef<HTMLDivElement>(null);

  const captureTaskLayout = useCallback((): TaskLayoutSnapshot => {
    const container = kanbanBoardRef.current;
    const snapshot: TaskLayoutSnapshot = new Map();
    if (!container) return snapshot;

    container.querySelectorAll<HTMLElement>('[data-kanban-column-tasks="true"] [data-task-id]').forEach((element) => {
      const taskId = element.dataset.taskId;
      if (!taskId) return;

      const rect = element.getBoundingClientRect();
      snapshot.set(taskId, { left: rect.left, top: rect.top });
    });

    return snapshot;
  }, []);

  const playTaskLayoutAnimation = useCallback((beforeLayout: TaskLayoutSnapshot, excludedTaskIds: Set<string>) => {
    if (beforeLayout.size === 0) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    window.requestAnimationFrame(() => {
      const container = kanbanBoardRef.current;
      if (!container) return;

      container.querySelectorAll<HTMLElement>('[data-kanban-column-tasks="true"] [data-task-id]').forEach((element) => {
        const taskId = element.dataset.taskId;
        if (!taskId || excludedTaskIds.has(taskId) || typeof element.animate !== 'function') return;

        const before = beforeLayout.get(taskId);
        if (!before) return;

        const after = element.getBoundingClientRect();
        const deltaX = before.left - after.left;
        const deltaY = before.top - after.top;
        if (Math.abs(deltaX) < 0.5 && Math.abs(deltaY) < 0.5) return;

        taskLayoutAnimationsRef.current.get(taskId)?.cancel();
        element.style.willChange = 'transform';
        const animation = element.animate(
          [
            { transform: `translate(${deltaX}px, ${deltaY}px)` },
            { transform: 'translate(0, 0)' },
          ],
          {
            duration: 180,
            easing: 'cubic-bezier(0.2, 0, 0, 1)',
          },
        );

        taskLayoutAnimationsRef.current.set(taskId, animation);
        const clearAnimation = () => {
          if (taskLayoutAnimationsRef.current.get(taskId) === animation) {
            taskLayoutAnimationsRef.current.delete(taskId);
            element.style.willChange = '';
          }
        };

        animation.addEventListener('finish', clearAnimation, { once: true });
        animation.addEventListener('cancel', clearAnimation, { once: true });
      });
    });
  }, []);

  useEffect(() => {
    const animations = taskLayoutAnimationsRef.current;
    return () => {
      animations.forEach((animation) => animation.cancel());
      animations.clear();
    };
  }, []);

  // Dynamically set min-height on pageContainer so it fills exactly the remaining
  // viewport, eliminating the dead-zone scroll caused by a static min-height: 100vh.
  useEffect(() => {
    const el = pageContainerRef.current;
    if (!el) return;

    const update = () => {
      const top = el.getBoundingClientRect().top + window.scrollY;
      el.style.minHeight = `calc(100dvh - ${top}px)`;
    };

    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  useEffect(() => {
    return () => {
      if (scrollIntervalRef.current) {
        clearInterval(scrollIntervalRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (viewMode !== 'kanban') return;

    const updatePhasesPanelHeight = () => {
      const el = phasesContainerRef.current;
      if (!el) return;

      const rect = el.getBoundingClientRect();
      const bottomGap = 4; // Keep panel nearly flush with viewport bottom.
      const nextHeight = Math.max(260, Math.floor(window.innerHeight - rect.top - bottomGap));
      setPhasesPanelHeight(nextHeight);
    };

    updatePhasesPanelHeight();
    window.addEventListener('resize', updatePhasesPanelHeight);
    window.addEventListener('scroll', updatePhasesPanelHeight, { passive: true });

    return () => {
      window.removeEventListener('resize', updatePhasesPanelHeight);
      window.removeEventListener('scroll', updatePhasesPanelHeight);
    };
  }, [viewMode, isPhasesPanelVisible]);

  const kanbanColumnWidth = useMemo(() => calculateColumnWidth(kanbanZoomLevel), [kanbanZoomLevel]);
  const visibleKanbanStatuses = useMemo(
    () => projectStatuses
      .filter((status) => status.is_visible)
      .sort((a, b) => a.display_order - b.display_order),
    [projectStatuses]
  );
  // Per-user "hidden" columns are a purely visual filter layered on top of the
  // admin-configured visible statuses. Hidden ids are the underlying status
  // identities, not mapping ids, so the preference survives phase customization.
  const hiddenStatusIdentitySet = useMemo(
    () => new Set(normalizeHiddenStatusIds(hiddenKanbanStatusIds)),
    [hiddenKanbanStatusIds]
  );
  const visibleStatusByMappingId = useMemo(
    () => new Map(visibleKanbanStatuses.map((status) => [status.project_status_mapping_id, status])),
    [visibleKanbanStatuses]
  );
  const forceVisibleStatusMappingIds = useMemo(() => {
    const ids = new Set<string>();
    const addIfHidden = (statusMappingId: string) => {
      const status = visibleStatusByMappingId.get(statusMappingId);
      if (status && hiddenStatusIdentitySet.has(getKanbanStatusIdentity(status))) {
        ids.add(statusMappingId);
      }
    };
    if (searchQuery.trim()) {
      for (const task of filteredTasks) {
        addIfHidden(task.project_status_mapping_id);
      }
    }
    if (selectedTask?.project_status_mapping_id) {
      addIfHidden(selectedTask.project_status_mapping_id);
    }
    return ids;
  }, [filteredTasks, hiddenStatusIdentitySet, searchQuery, selectedTask?.project_status_mapping_id, visibleStatusByMappingId]);
  const displayedKanbanStatuses = useMemo(
    () => visibleKanbanStatuses.filter(
      (status) => (
        !hiddenStatusIdentitySet.has(getKanbanStatusIdentity(status)) ||
        forceVisibleStatusMappingIds.has(status.project_status_mapping_id)
      )
    ),
    [visibleKanbanStatuses, hiddenStatusIdentitySet, forceVisibleStatusMappingIds]
  );
  const hiddenVisibleStatusCount = useMemo(
    () => visibleKanbanStatuses.filter(
      (status) => hiddenStatusIdentitySet.has(getKanbanStatusIdentity(status))
    ).length,
    [visibleKanbanStatuses, hiddenStatusIdentitySet]
  );
  const toggleKanbanStatusHidden = useCallback((status: ProjectStatus) => {
    const statusIdentity = getKanbanStatusIdentity(status);
    setHiddenKanbanStatusIds((prev: string[]) => toggleHiddenStatusId(prev, statusIdentity));
  }, [setHiddenKanbanStatusIds]);
  const showAllKanbanStatuses = useCallback(() => {
    setHiddenKanbanStatusIds([]);
  }, [setHiddenKanbanStatusIds]);
  const statusTaskCounts = useMemo(() => {
    return filteredTasks.reduce<Record<string, number>>((counts, task) => {
      const statusId = task.project_status_mapping_id;
      if (!phaseStatusLookup.has(statusId)) {
        return counts;
      }
      counts[statusId] = (counts[statusId] ?? 0) + 1;
      return counts;
    }, {});
  }, [filteredTasks, phaseStatusLookup]);

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

  const getKanbanScrollbarGeometry = useCallback(() => {
    const container = kanbanBoardRef.current;
    const track = scrollbarTrackRef.current;
    if (!container || !track) return null;

    const scrollWidth = Math.max(container.scrollWidth, container.clientWidth);
    const scrollRange = Math.max(0, scrollWidth - container.clientWidth);
    const trackWidth = track.clientWidth;
    if (trackWidth <= 0) return null;

    if (scrollRange === 0) {
      return {
        container,
        scrollRange,
        thumbWidth: trackWidth,
        maxThumbOffset: 0,
        trackWidth
      };
    }

    const proportionalThumbWidth = (container.clientWidth / scrollWidth) * trackWidth;
    const thumbWidth = Math.min(trackWidth, Math.max(proportionalThumbWidth, 48));
    return {
      container,
      scrollRange,
      thumbWidth,
      maxThumbOffset: Math.max(0, trackWidth - thumbWidth),
      trackWidth
    };
  }, []);

  const updateKanbanScrollbarThumb = useCallback(() => {
    const thumb = scrollbarThumbRef.current;
    const geometry = getKanbanScrollbarGeometry();
    if (!thumb || !geometry) return;

    if (geometry.scrollRange === 0 || geometry.maxThumbOffset === 0) {
      thumb.style.width = '100%';
      thumb.style.transform = 'translateX(0)';
      thumb.classList.add(styles.kanbanScrollbarThumbStatic);
      thumb.setAttribute('aria-valuenow', '0');
      return;
    }

    const thumbOffset = (geometry.container.scrollLeft / geometry.scrollRange) * geometry.maxThumbOffset;
    thumb.style.width = `${(geometry.thumbWidth / geometry.trackWidth) * 100}%`;
    thumb.style.transform = `translateX(${thumbOffset}px)`;
    thumb.classList.remove(styles.kanbanScrollbarThumbStatic);
    thumb.setAttribute('aria-valuenow', String(Math.round((geometry.container.scrollLeft / geometry.scrollRange) * 100)));
  }, [getKanbanScrollbarGeometry]);

  const setKanbanScrollFromThumbOffset = useCallback((nextThumbOffset: number) => {
    const geometry = getKanbanScrollbarGeometry();
    if (!geometry) return;

    if (geometry.scrollRange === 0 || geometry.maxThumbOffset === 0) {
      geometry.container.scrollLeft = 0;
      return;
    }

    const clampedThumbOffset = Math.min(Math.max(nextThumbOffset, 0), geometry.maxThumbOffset);
    geometry.container.scrollLeft = (clampedThumbOffset / geometry.maxThumbOffset) * geometry.scrollRange;
  }, [getKanbanScrollbarGeometry]);

  const handleKanbanScrollbarTrackPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).dataset.kanbanScrollbarThumb === 'true') {
      return;
    }

    const track = scrollbarTrackRef.current;
    const geometry = getKanbanScrollbarGeometry();
    if (!track || !geometry) return;

    const rect = track.getBoundingClientRect();
    const clickOffset = event.clientX - rect.left;
    const targetThumbOffset = clickOffset - geometry.thumbWidth / 2;
    setKanbanScrollFromThumbOffset(targetThumbOffset);
  }, [getKanbanScrollbarGeometry, setKanbanScrollFromThumbOffset]);

  const handleKanbanScrollbarThumbPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();

    const geometry = getKanbanScrollbarGeometry();
    if (!geometry || geometry.scrollRange === 0 || geometry.maxThumbOffset === 0) return;

    // Abort any prior drag session still lingering
    dragAbortRef.current?.abort();
    const controller = new AbortController();
    dragAbortRef.current = controller;
    const { signal } = controller;

    const startClientX = event.clientX;
    const startScrollLeft = geometry.container.scrollLeft;

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const deltaX = moveEvent.clientX - startClientX;
      const scrollDelta = (deltaX / geometry.maxThumbOffset) * geometry.scrollRange;
      geometry.container.scrollLeft = startScrollLeft + scrollDelta;
    };

    const cleanUp = () => {
      dragAbortRef.current = null;
      controller.abort();
    };

    window.addEventListener('pointermove', handlePointerMove, { signal });
    window.addEventListener('pointerup', cleanUp, { signal });
    window.addEventListener('pointercancel', cleanUp, { signal });
  }, [getKanbanScrollbarGeometry]);

  const SCROLL_STEP = 60;

  const handleKanbanScrollbarKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    const container = kanbanBoardRef.current;
    if (!container) return;

    let handled = true;
    switch (event.key) {
      case 'ArrowLeft':
        container.scrollLeft -= SCROLL_STEP;
        break;
      case 'ArrowRight':
        container.scrollLeft += SCROLL_STEP;
        break;
      case 'Home':
        container.scrollLeft = 0;
        break;
      case 'End':
        container.scrollLeft = container.scrollWidth;
        break;
      default:
        handled = false;
    }

    if (handled) {
      event.preventDefault();
    }
  }, []);

  // Scrollbar metrics and sticky status strip: keep horizontal scroll positions in sync.
  useEffect(() => {
    const container = kanbanBoardRef.current;
    const stickyStrip = stickyStatusStripRef.current;
    if (!container) return;

    let isSyncing = false;
    let observedBoard: HTMLElement | null = null;

    const ro = new ResizeObserver(() => {
      updateKanbanScrollbarThumb();
    });

    const observeBoard = () => {
      const board = container.querySelector('[data-kanban-board="true"]') as HTMLElement | null;
      if (board === observedBoard) return;

      if (observedBoard) {
        ro.unobserve(observedBoard);
      }
      observedBoard = board;
      if (observedBoard) {
        ro.observe(observedBoard);
      }
    };

    const syncScrollPositions = (source: 'container' | 'sticky') => {
      if (isSyncing) return;
      isSyncing = true;
      const nextLeft = source === 'container'
        ? container.scrollLeft
        : (stickyStrip?.scrollLeft ?? 0);

      if (source !== 'container') container.scrollLeft = nextLeft;
      if (stickyStrip && source !== 'sticky') stickyStrip.scrollLeft = nextLeft;
      updateKanbanScrollbarThumb();
      isSyncing = false;
    };

    const onContainerScroll = () => syncScrollPositions('container');
    const onStickyStripScroll = () => syncScrollPositions('sticky');

    container.addEventListener('scroll', onContainerScroll);
    if (stickyStrip) {
      stickyStrip.addEventListener('scroll', onStickyStripScroll);
    }
    ro.observe(container);
    observeBoard();
    syncScrollPositions('container');

    let nestedRafId: number | null = null;
    const rafId = window.requestAnimationFrame(() => {
      observeBoard();
      updateKanbanScrollbarThumb();
      nestedRafId = window.requestAnimationFrame(() => {
        observeBoard();
        updateKanbanScrollbarThumb();
      });
    });

    return () => {
      container.removeEventListener('scroll', onContainerScroll);
      if (stickyStrip) {
        stickyStrip.removeEventListener('scroll', onStickyStripScroll);
      }
      window.cancelAnimationFrame(rafId);
      if (nestedRafId !== null) {
        window.cancelAnimationFrame(nestedRafId);
      }
      if (observedBoard) {
        ro.unobserve(observedBoard);
      }
      ro.disconnect();
      // Clean up any in-flight drag listeners
      dragAbortRef.current?.abort();
      dragAbortRef.current = null;
    };
  }, [showStickyStatusNames, viewMode, kanbanZoomLevel, displayedKanbanStatuses.length, selectedPhase?.phase_id, isLoadingTasks, updateKanbanScrollbarThumb]);

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
    // Bulk move: when the dragged task is part of a multi-selection, move them all
    if (selectedTaskIds.has(taskId) && selectedTaskIds.size > 1) {
      // Sort selected tasks by current order_key so they land in their existing
      // relative order. Tasks already in the target phase are repositioned;
      // cross-phase tasks are moved in.
      const tasksToMove = allProjectTasks
        .filter(t => selectedTaskIds.has(t.task_id))
        .sort((a, b) => {
          const ka = a.order_key || '';
          const kb = b.order_key || '';
          return ka < kb ? -1 : ka > kb ? 1 : 0;
        });
      if (tasksToMove.length === 0) return;

      // Don't anchor positioning to tasks that are themselves being moved
      const safeBefore = beforeTaskId && selectedTaskIds.has(beforeTaskId) ? null : beforeTaskId;
      const safeAfter = afterTaskId && selectedTaskIds.has(afterTaskId) ? null : afterTaskId;

      let success = 0;
      let failed = 0;
      let crossPhaseMoved = 0;
      // Chain inserts so each subsequent task lands immediately after the
      // previous one, preserving the relative order at the drop position.
      let prevBefore: string | null = safeBefore;
      const statusUpdatedById = new Map<string, IProjectTask>();
      for (const task of tasksToMove) {
        try {
          if (task.phase_id !== newPhaseId) {
            const moveResult = await moveTaskToPhase(
              task.task_id,
              newPhaseId,
              newStatusMappingId,
              undefined,
              prevBefore,
              safeAfter,
            );
            if (isReturnedActionError(moveResult)) {
              toast.error(getErrorMessage(moveResult));
              failed++;
              continue;
            }
            crossPhaseMoved++;
          } else {
            const updatedTask = await updateTaskStatus(
              task.task_id,
              newStatusMappingId,
              prevBefore,
              safeAfter,
            );
            if (isReturnedActionError(updatedTask)) {
              toast.error(getErrorMessage(updatedTask));
              failed++;
              continue;
            }
            statusUpdatedById.set(task.task_id, updatedTask);
          }
          prevBefore = task.task_id;
          success++;
        } catch (error) {
          console.error(`Failed to move task ${task.task_id}:`, error);
          failed++;
        }
      }

      if (crossPhaseMoved > 0) {
        // Cross-phase movement changes which list buckets a task belongs to and
        // can invalidate cached ordering for the target status. Bump the version
        // so the board reloads with correct grouping/ordering.
        setAllProjectTasks(prev => prev.map(t => {
          const u = statusUpdatedById.get(t.task_id);
          if (u) {
            return { ...t, project_status_mapping_id: u.project_status_mapping_id, order_key: u.order_key };
          }
          if (selectedTaskIds.has(t.task_id) && t.phase_id !== newPhaseId) {
            return { ...t, phase_id: newPhaseId, project_status_mapping_id: newStatusMappingId };
          }
          return t;
        }));
        setStatusVersion(v => v + 1);
      } else {
        // Pure same-phase reorder/status change — apply server-returned
        // order_key/status so the list reflects the exact drop position.
        const applyUpdate = (taskItem: IProjectTask): IProjectTask => {
          const u = statusUpdatedById.get(taskItem.task_id);
          return u
            ? { ...taskItem, project_status_mapping_id: u.project_status_mapping_id, order_key: u.order_key }
            : taskItem;
        };
        setProjectTasks(prev => prev.map(applyUpdate));
        setAllProjectTasks(prev => prev.map(applyUpdate));
      }

      if (failed === 0) {
        toast.success(
          t('projectDetail.bulkTasksMovedSuccess', '{{count}} tasks moved', { count: success }),
        );
      } else {
        toast.error(
          t('projectDetail.bulkMovePartial', 'Moved {{moved}} task(s), {{failed}} failed.', {
            moved: success,
            failed,
          }),
        );
      }
      return;
    }

    try {
      const task = allProjectTasks.find(t => t.task_id === taskId);
      if (!task) {
        console.error('Task not found');
        return;
      }

      // Check if we're moving to a different phase
      if (task.phase_id !== newPhaseId) {
        // Move to different phase with new status
        const moveResult = await moveTaskToPhase(taskId, newPhaseId, newStatusMappingId);
        if (isReturnedActionError(moveResult)) {
          toast.error(getErrorMessage(moveResult));
          return;
        }
        setAllProjectTasks(prev => prev.map(t =>
          t.task_id === taskId ? { ...t, phase_id: newPhaseId, project_status_mapping_id: newStatusMappingId } : t
        ));
        toast.success(t('projectDetail.taskMovedToNewPhase', 'Task moved to new phase'));
      } else if (task.project_status_mapping_id !== newStatusMappingId) {
        // Same phase, different status
        const updatedTask = await updateTaskStatus(taskId, newStatusMappingId, beforeTaskId, afterTaskId);
        if (isReturnedActionError(updatedTask)) {
          toast.error(getErrorMessage(updatedTask));
          return;
        }
        setAllProjectTasks(prev => prev.map(t =>
          t.task_id === taskId ? { ...t, project_status_mapping_id: newStatusMappingId } : t
        ));
        toast.success(t('projectDetail.taskStatusUpdated', 'Task status updated'));
      } else {
        // Same phase and status - just reorder
        unwrapActionResult(await reorderTask(taskId, beforeTaskId, afterTaskId));
        toast.success(t('projectDetail.taskReordered', 'Task reordered'));
      }
    } catch (error) {
      handleError(error, 'Failed to move task');
    }
  }, [allProjectTasks, selectedTaskIds, selectedPhase, t]);
  
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
        if (isReturnedActionError(types)) {
          handleError(types);
        } else {
          setTaskTypes(types);
        }
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
        const phaseData = await getTasksForPhase(selectedPhase.phase_id);
        if (isReturnedActionError(phaseData)) {
          handleError(phaseData);
          return;
        }
        const { tasks, ticketLinks, taskResources, taskDependencies, checklistItems, taskTags: phaseTags } = phaseData;
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
  }, [selectedPhase?.phase_id, statusVersion]);

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
    let stale = false;

    const fetchTeamData = async () => {
      const tenant = project.tenant;
      if (!tenant) return;

      try {
        const allTeams = await getTeams();
        if (stale) return;
        if (isTeamActionError(allTeams)) {
          console.warn('Cannot load teams for project task display:', allTeams);
          return;
        }
        setTeams(allTeams);
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
  }, [project.tenant]);

  // Handle opening task from URL parameter (e.g., from notifications)
  // First effect: Fetch task and select its phase
  useEffect(() => {
    if (!initialTaskId || projectPhases.length === 0) return;

    // Reset the flag when initialTaskId changes
    hasOpenedInitialTask.current = false;

    const loadTaskAndSelectPhase = async () => {
      try {
        const task = await getTaskById(initialTaskId);
        if (isReturnedActionError(task)) {
          toast.error(getErrorMessage(task));
          return;
        }
        if (!task) {
          toast.error(t('projectDetail.taskNotFound', 'Task not found'));
          return;
        }

        // Find the phase for this task
        const taskPhase = projectPhases.find(phase => phase.phase_id === task.phase_id);
        if (!taskPhase) {
          toast.error(t('projectDetail.taskPhaseNotFound', 'Task phase not found'));
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
  }, [initialTaskId, projectPhases, initialPhaseId, onUrlUpdate, t]);

  // Second effect: Once tasks are loaded, open the specific task
  useEffect(() => {
    if (!initialTaskId || projectTasks.length === 0 || hasOpenedInitialTask.current) return;

    // Find the task in the loaded tasks
    const taskToOpen = projectTasks.find(task => task.task_id === initialTaskId);

    if (taskToOpen) {
      // Open the task dialog
      setSelectedTask(taskToOpen);
      setCurrentPhase(selectedPhase);
      setShowQuickAdd(true);
      hasOpenedInitialTask.current = true; // Mark that we've opened the task
    }
  }, [initialTaskId, projectTasks]);

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
        if (isReturnedActionError(counts)) {
          if (!stale) {
            toast.error(getErrorMessage(counts));
            setTaskCommentCounts({});
          }
          return;
        }
        if (!stale) setTaskCommentCounts(counts);
      } catch (error) {
        if (!stale) {
          console.error('Error fetching comment counts:', error);
          toast.error(t('projectDetail.commentCountsLoadError', 'Failed to load comment counts'));
          setTaskCommentCounts({});
        }
      }
    };

    fetchCommentCounts();
    return () => { stale = true; };
  }, [selectedPhase, phaseTaskIds, t]);

  const handleDragStart = (e: React.DragEvent, taskId: string) => {
    e.dataTransfer.setData('text/plain', taskId);
    const isBulkDrag = selectedTaskIds.has(taskId) && selectedTaskIds.size > 1;
    if (isBulkDrag) {
      // Dim every selected card so it's clear they all move together
      document.querySelectorAll('[data-task-id]').forEach((el) => {
        const id = el.getAttribute('data-task-id');
        if (id && selectedTaskIds.has(id)) {
          el.classList.add('opacity-50');
        }
      });
    } else if (e.target instanceof HTMLElement) {
      e.target.classList.add('opacity-50');
    }
    document.body.classList.add('dragging-task');
  };

  const handleDragEnd = (e: React.DragEvent) => {
    if (e.target instanceof HTMLElement) {
      e.target.classList.remove('opacity-50');
    }
    document.querySelectorAll('[data-task-id]').forEach((el) => {
      el.classList.remove('opacity-50');
    });
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

  // Move every selected task into the target status of the current kanban phase.
  // Selected tasks already in this phase are repositioned at the drop point;
  // selected tasks from other phases are moved into this phase + target status.
  const handleBulkKanbanDrop = async (
    targetStatusId: string,
    beforeTaskId: string | null,
    afterTaskId: string | null,
  ) => {
    const currentPhaseId = selectedPhase?.phase_id;
    if (!currentPhaseId) return;

    // Selected tasks across every phase (not just the current board)
    const allSelected = allProjectTasks.filter(t => selectedTaskIds.has(t.task_id));
    if (allSelected.length === 0) return;

    const samePhaseTasks = allSelected
      .filter(t => t.phase_id === currentPhaseId)
      .sort((a, b) => {
        const ka = a.order_key || '';
        const kb = b.order_key || '';
        return ka < kb ? -1 : ka > kb ? 1 : 0;
      });
    const otherPhaseTasks = allSelected.filter(t => t.phase_id !== currentPhaseId);

    try {
      const statusUpdatedById = new Map<string, IProjectTask>();
      let movedInCount = 0;
      let failed = 0;

      // Reposition same-phase tasks at the drop location, grouped consecutively
      let prevBefore = beforeTaskId;
      for (const task of samePhaseTasks) {
        try {
          const updatedTask = await updateTaskStatus(task.task_id, targetStatusId, prevBefore, afterTaskId);
          if (isReturnedActionError(updatedTask)) {
            toast.error(getErrorMessage(updatedTask));
            failed++;
            continue;
          }
          statusUpdatedById.set(task.task_id, updatedTask);
          prevBefore = task.task_id;
        } catch (error) {
          console.error(`Failed to move task ${task.task_id}:`, error);
          failed++;
        }
      }

      // Move cross-phase tasks into the current phase at the target status
      for (const task of otherPhaseTasks) {
        try {
          unwrapActionResult(await moveTaskToPhase(task.task_id, currentPhaseId, targetStatusId));
          movedInCount++;
        } catch (error) {
          console.error(`Failed to move task ${task.task_id}:`, error);
          failed++;
        }
      }

      const movedTaskIds = new Set<string>([
        ...statusUpdatedById.keys(),
        ...otherPhaseTasks.map(t => t.task_id),
      ]);
      const beforeLayout = captureTaskLayout();

      if (otherPhaseTasks.length > 0) {
        // Cross-phase tasks now belong to this phase. Update the project-wide list
        // optimistically, then reload the board so they appear with correct
        // ordering, ticket links, resources, etc.
        setAllProjectTasks(prev => prev.map(t => {
          const u = statusUpdatedById.get(t.task_id);
          if (u) {
            return { ...t, project_status_mapping_id: u.project_status_mapping_id, order_key: u.order_key };
          }
          if (selectedTaskIds.has(t.task_id) && t.phase_id !== currentPhaseId) {
            return { ...t, phase_id: currentPhaseId, project_status_mapping_id: targetStatusId };
          }
          return t;
        }));
        setStatusVersion(v => v + 1);
        playTaskLayoutAnimation(beforeLayout, movedTaskIds);
      } else {
        // Pure same-phase status change — update in place to avoid a reload flicker
        const applyUpdate = (t: IProjectTask): IProjectTask => {
          const u = statusUpdatedById.get(t.task_id);
          return u
            ? { ...t, project_status_mapping_id: u.project_status_mapping_id, order_key: u.order_key }
            : t;
        };
        setProjectTasks(prev => prev.map(applyUpdate));
        setAllProjectTasks(prev => prev.map(applyUpdate));
        playTaskLayoutAnimation(beforeLayout, movedTaskIds);

        setAnimatingTasks(prev => {
          const next = new Set(prev);
          statusUpdatedById.forEach((_, id) => next.add(id));
          return next;
        });
        setTimeout(() => {
          setAnimatingTasks(prev => {
            const next = new Set(prev);
            statusUpdatedById.forEach((_, id) => next.delete(id));
            return next;
          });
        }, 500);
      }

      const total = statusUpdatedById.size + movedInCount;
      if (failed === 0) {
        toast.success(
          t('projectDetail.bulkTasksMovedSuccess', '{{count}} tasks moved', { count: total }),
        );
      } else {
        toast.error(
          t('projectDetail.bulkMovePartial', 'Moved {{moved}} task(s), {{failed}} failed.', {
            moved: total,
            failed,
          }),
        );
      }
    } catch (error) {
      handleError(error, 'Failed to move tasks');
    }
  };

  const handleDrop = async (e: React.DragEvent, targetStatusId: string, draggedTaskId: string, beforeTaskId: string | null, afterTaskId: string | null) => {
    e.preventDefault();

    // Bulk drag: when the dragged task is part of a multi-selection, move them all
    if (selectedTaskIds.has(draggedTaskId) && selectedTaskIds.size > 1) {
      // Don't anchor positioning to tasks that are themselves being moved
      const safeBefore = beforeTaskId && selectedTaskIds.has(beforeTaskId) ? null : beforeTaskId;
      const safeAfter = afterTaskId && selectedTaskIds.has(afterTaskId) ? null : afterTaskId;
      await handleBulkKanbanDrop(targetStatusId, safeBefore, safeAfter);
      return;
    }

    const task = projectTasks.find(t => t.task_id === draggedTaskId);

    if (!task) {
      console.error('Task not found');
      return;
    }

    // Capture order keys for the drop position up front (used for both the
    // optimistic update and, on failure, the rollback).
    const beforeTask = beforeTaskId ? projectTasks.find(t => t.task_id === beforeTaskId) : null;
    const afterTask = afterTaskId ? projectTasks.find(t => t.task_id === afterTaskId) : null;
    const newOrderKey = generateKeyBetween(beforeTask?.order_key || null, afterTask?.order_key || null);

    // Helper to play the entry animation in the destination position.
    const animateDroppedTask = () => {
      setAnimatingTasks(prev => new Set(prev).add(draggedTaskId));
      setTimeout(() => {
        setAnimatingTasks(prev => {
          const next = new Set(prev);
          next.delete(draggedTaskId);
          return next;
        });
      }, 500);
    };

    if (task.project_status_mapping_id !== targetStatusId) {
      // Status change with position.
      //
      // Apply the move to local state *immediately* (optimistically) so the
      // card appears in the target column right away. Previously we awaited the
      // server round-trips before updating state, which let the card flash back
      // into its original column (at full opacity, once the drag ghost cleared)
      // until the request resolved.
      const beforeLayout = captureTaskLayout();
      setProjectTasks(prevTasks =>
        prevTasks.map((t): IProjectTask =>
          t.task_id === draggedTaskId
            ? { ...t, project_status_mapping_id: targetStatusId, order_key: newOrderKey }
            : t
        )
      );
      playTaskLayoutAnimation(beforeLayout, new Set([draggedTaskId]));
      animateDroppedTask();

      try {
        const updatedTask = await updateTaskStatus(draggedTaskId, targetStatusId, beforeTaskId, afterTaskId);
        if (isReturnedActionError(updatedTask)) {
          setProjectTasks(prevTasks =>
            prevTasks.map((t): IProjectTask =>
              t.task_id === draggedTaskId
                ? { ...t, project_status_mapping_id: task.project_status_mapping_id, order_key: task.order_key }
                : t
            )
          );
          toast.error(getErrorMessage(updatedTask));
          return;
        }
        const checklistItems = unwrapActionResult(await getTaskChecklistItems(draggedTaskId));
        const taskWithChecklist = { ...updatedTask, checklist_items: checklistItems };

        // Reconcile with the authoritative server values (final order_key, etc.).
        setProjectTasks(prevTasks =>
          prevTasks.map((t): IProjectTask => (t.task_id === draggedTaskId ? taskWithChecklist : t))
        );

        toast.success(t('projectDetail.taskMovedToNewStatus', 'Task moved to new status'));
      } catch (error) {
        // Roll back the optimistic move on failure.
        setProjectTasks(prevTasks =>
          prevTasks.map((t): IProjectTask => (t.task_id === draggedTaskId ? task : t))
        );
        handleError(error, 'Failed to move task');
      }
    } else {
      // Reorder within the same status. Update local order immediately, then
      // persist; roll back if the request fails.
      const beforeLayout = captureTaskLayout();
      setProjectTasks(prevTasks =>
        prevTasks.map((t): IProjectTask =>
          t.task_id === draggedTaskId ? { ...t, order_key: newOrderKey } : t
        )
      );
      playTaskLayoutAnimation(beforeLayout, new Set([draggedTaskId]));
      animateDroppedTask();

      try {
        unwrapActionResult(await reorderTask(draggedTaskId, beforeTaskId, afterTaskId));
      } catch (error) {
        // Roll back the optimistic reorder on failure.
        setProjectTasks(prevTasks =>
          prevTasks.map((t): IProjectTask => (t.task_id === draggedTaskId ? task : t))
        );
        handleError(error, 'Failed to move task');
      }
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
      if (isReturnedActionError(reorderResult)) {
        handleError(getErrorMessage(reorderResult));
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
      
      toast.success(t('projectDetail.phaseReorderedSuccess', 'Phase reordered successfully'));
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
      // Bulk drag: the dragged task is part of a multi-selection. The selection is
      // project-wide, so include selected tasks from every phase, not just the
      // currently visible kanban board.
      if (selectedTaskIds.has(taskId) && selectedTaskIds.size > 1) {
        const bulkTaskIds = allProjectTasks
          .filter(t => selectedTaskIds.has(t.task_id) && t.phase_id !== targetPhase.phase_id)
          .map(t => t.task_id);
        if (bulkTaskIds.length > 0) {
          setMoveConfirmation({
            taskId,
            taskName: task.task_name,
            taskIds: bulkTaskIds,
            sourcePhase,
            targetPhase,
          });
        }
        return;
      }

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

    // Bulk move: move every selected task to the target phase
    if (moveConfirmation.taskIds && moveConfirmation.taskIds.length > 0) {
      const { taskIds: bulkTaskIds, targetPhase } = moveConfirmation;
      let success = 0;
      let failed = 0;
      const movedById = new Map<string, IProjectTask>();

      for (const id of bulkTaskIds) {
        try {
          // Omit the status mapping so moveTaskToPhase performs phase-aware
          // status remapping — passing the source status can land a task on a
          // mapping that isn't valid for the target phase's status set.
          const movedTask = unwrapActionResult(await moveTaskToPhase(id, targetPhase.phase_id));
          movedById.set(id, movedTask);
          success++;
        } catch (error) {
          console.error(`Failed to move task ${id}:`, error);
          failed++;
        }
      }

      // Moved tasks leave the current kanban board; apply the server-resolved
      // phase + status mapping so the list view groups them correctly
      setProjectTasks(prev => prev.filter(t => !movedById.has(t.task_id)));
      setAllProjectTasks(prev => prev.map(t => {
        const moved = movedById.get(t.task_id);
        return moved
          ? {
              ...t,
              phase_id: moved.phase_id,
              project_status_mapping_id: moved.project_status_mapping_id,
              order_key: moved.order_key,
            }
          : t;
      }));

      if (failed === 0) {
        toast.success(
          t('projectDetail.bulkTasksMovedToPhase', '{{count}} tasks moved to {{phaseName}}', {
            count: success,
            phaseName: targetPhase.phase_name,
          }),
        );
      } else {
        toast.error(
          t('projectDetail.bulkMovePartial', 'Moved {{moved}} task(s), {{failed}} failed.', {
            moved: success,
            failed,
          }),
        );
      }
      setMoveConfirmation(null);
      return;
    }

    try {
      const task = projectTasks.find(t => t.task_id === moveConfirmation.taskId);
      if (!task) {
        throw new Error('Task not found');
      }

      // Omit the status mapping so moveTaskToPhase performs phase-aware status
      // remapping — passing the source status can land the task on a mapping
      // that isn't valid for the target phase's status set.
      const updatedTask = unwrapActionResult(await moveTaskToPhase(
        moveConfirmation.taskId,
        moveConfirmation.targetPhase.phase_id,
      ));

      const checklistItems = unwrapActionResult(await getTaskChecklistItems(moveConfirmation.taskId));
      const taskWithChecklist = { ...updatedTask, checklist_items: checklistItems };

      setProjectTasks(prevTasks =>
        prevTasks.map((task): IProjectTask =>
          task.task_id === updatedTask.task_id ? taskWithChecklist : task
        )
      );
      // Apply the server-resolved phase + status mapping so the list view
      // groups the moved task correctly
      setAllProjectTasks(prev => prev.map(t =>
        t.task_id === updatedTask.task_id
          ? {
              ...t,
              phase_id: updatedTask.phase_id,
              project_status_mapping_id: updatedTask.project_status_mapping_id,
              order_key: updatedTask.order_key,
            }
          : t
      ));

      toast.success(
        t('projectDetail.taskMovedToPhase', 'Task moved to {{phaseName}}', {
          phaseName: moveConfirmation.targetPhase.phase_name,
        }),
      );
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
        const [checklistResult, taskResourcesResult] = await Promise.all([
          getTaskChecklistItems(newTask.task_id),
          getTaskResourcesAction(newTask.task_id)
        ]);
        const checklistItems = unwrapActionResult(checklistResult);
        const taskResources = unwrapActionResult(taskResourcesResult);
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
        toast.success(t('projectDetail.taskAddedSuccess', 'New task added successfully!'));
      } else {
        console.error('New task does not match selected phase');
        toast.error(t('projectDetail.taskPhaseMismatch', 'Error adding new task: Phase mismatch'));
      }
    } catch (error) {
      handleError(error, 'Error adding new task. Please try again.');
    } finally {
      setIsAddingTask(false);
    }
  }, [selectedPhase, currentPhase, t]);

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
    toast.success(t('projectDetail.phaseAddedSuccess', 'New phase added successfully!'));
  }, [onUrlUpdate, t]);

  const handleAddCard = useCallback((status: ProjectStatus) => {
    if (!selectedPhase) {
      toast.error(t('projectDetail.selectPhaseToAddCard', 'Please select a phase before adding a card.'));
      return;
    }
    
    setIsAddingTask(true);
    setDefaultStatus(status);
    setCurrentPhase(selectedPhase);
    setSelectedTask(null);
    setShowQuickAdd(true);
  }, [selectedPhase, t]);

  const handleTaskUpdated = useCallback(async (updatedTask: IProjectTask | null) => {
    if (updatedTask) {
      try {
        // Fetch checklist items and task resources in parallel
        const [checklistResult, taskResourcesResult] = await Promise.all([
          getTaskChecklistItems(updatedTask.task_id),
          getTaskResourcesAction(updatedTask.task_id)
        ]);
        const checklistItems = unwrapActionResult(checklistResult);
        const taskResources = unwrapActionResult(taskResourcesResult);
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

        toast.success(
          taskWithChecklist.task_id
            ? t('projectDetail.taskUpdatedSuccess', 'Task updated successfully!')
            : t('projectDetail.taskAddedSuccess', 'New task added successfully!'),
        );
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

        toast.success(t('projectDetail.taskDeletedGeneric', 'Task deleted successfully!'));
      }
    }
    setShowQuickAdd(false);
    setSelectedTask(null);
    setIsAddingTask(false);
  }, [t]);

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
      if (isReturnedActionError(updatedTask)) {
        toast.error(getErrorMessage(updatedTask));
        return;
      }

      if (updatedTask) {
        const checklistItems = unwrapActionResult(await getTaskChecklistItems(taskId));
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

        toast.success(t('projectDetail.taskAssigneeUpdatedSuccess', 'Task assignee updated successfully!'));
      }
    } catch (error) {
      handleError(error, 'Failed to update task assignee. Please try again.');
    }
  };

  // Generic inline-edit handler for the list view (status, priority, type,
  // due date, hours). Mirrors handleAssigneeChange: spread the existing task,
  // apply the partial, persist, then sync both task arrays.
  const handleListTaskUpdate = async (taskId: string, updates: Partial<IProjectTask>) => {
    try {
      const task = projectTasks.find(t => t.task_id === taskId) || allProjectTasks.find(t => t.task_id === taskId);
      if (!task) {
        throw new Error('Task not found');
      }

      const updatedTask = await updateTaskWithChecklist(taskId, {
        ...task,
        estimated_hours: Number(task.estimated_hours) || 0,
        actual_hours: Number(task.actual_hours) || 0,
        checklist_items: task.checklist_items,
        ...updates,
      });
      if (isReturnedActionError(updatedTask)) {
        toast.error(getErrorMessage(updatedTask));
        return;
      }

      if (updatedTask) {
        // Inline list edits (status, priority, due date, hours, etc.) never
        // touch checklist items, so reuse the ones we already have instead of
        // refetching them on every cell edit.
        const taskWithChecklist = { ...updatedTask, checklist_items: task.checklist_items ?? [] };
        setProjectTasks(prev => prev.map(t => (t.task_id === taskId ? taskWithChecklist : t)));
        setAllProjectTasks(prev => prev.map(t => (t.task_id === taskId ? taskWithChecklist : t)));
      }
    } catch (error) {
      handleError(error, 'Failed to update task. Please try again.');
    }
  };

  const refreshTaskAfterTeamChange = async (taskId: string) => {
    const [updatedTaskResult, resourcesResult] = await Promise.all([
      getTaskById(taskId),
      getTaskResourcesAction(taskId),
    ]);
    const updatedTask = unwrapActionResult(updatedTaskResult);
    const resources = unwrapActionResult(resourcesResult);
    if (!updatedTask) return;
    const checklistItems = unwrapActionResult(await getTaskChecklistItems(taskId));
    const taskWithChecklist = { ...updatedTask, checklist_items: checklistItems };

    setProjectTasks(prev => prev.map(t => (t.task_id === taskId ? taskWithChecklist : t)));
    setAllProjectTasks(prev => prev.map(t => (t.task_id === taskId ? taskWithChecklist : t)));
    setPhaseTaskResources(prev => ({ ...prev, [taskId]: resources }));
    // List view + project-wide agent filter read from the project-wide map.
    // Keep it in sync so team-member additions/removals are reflected without
    // a page reload.
    setAllProjectTaskResources(prev => ({ ...prev, [taskId]: resources }));
  };

  const performTeamAssign = async (taskId: string, teamId: string) => {
    try {
      unwrapActionResult(await assignTeamToProjectTask(taskId, teamId));
      await refreshTaskAfterTeamChange(taskId);
      toast.success(t('projectDetail.teamAssignedSuccess', 'Team assigned successfully'));
    } catch (error) {
      handleError(error, t('projectDetail.assignTeamFailed', 'Failed to assign team'));
    }
  };

  const handleTeamAssign = async (taskId: string, teamId: string) => {
    const task = projectTasks.find(x => x.task_id === taskId) || allProjectTasks.find(x => x.task_id === taskId);
    if (!task) return;
    if (task.assigned_team_id === teamId) return;

    if (task.assigned_team_id) {
      try {
        const resources = unwrapActionResult(await getTaskResourcesAction(taskId));
        setPendingTaskTeamMembers(resources.filter((r: any) => r.role === 'team_member'));
      } catch (error) {
        console.error('Failed to load task resources for team switch dialog:', error);
        setPendingTaskTeamMembers([]);
      }
      setPendingTeamAssign({ taskId, teamId });
      setIsTeamSwitchDialogOpen(true);
      return;
    }

    await performTeamAssign(taskId, teamId);
  };

  const handleConfirmTeamSwitch = async (
    mode: 'remove_all' | 'keep_all' | 'selective',
    keepUserIds?: string[]
  ) => {
    if (!pendingTeamAssign) return;
    const { taskId, teamId } = pendingTeamAssign;
    try {
      unwrapActionResult(await removeTeamFromProjectTask(taskId, { mode, keepUserIds }));
      await performTeamAssign(taskId, teamId);
    } catch (error) {
      handleError(error, t('projectDetail.assignTeamFailed', 'Failed to assign team'));
    } finally {
      setPendingTeamAssign(null);
      setPendingTaskTeamMembers([]);
      setIsTeamSwitchDialogOpen(false);
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
        toast.error(t('projectDetail.phaseNameRequired', 'Phase name cannot be empty'));
        return;
      }
  
      const updatedPhase = await updatePhase(phase.phase_id, {
        phase_name: editingPhaseName,
        description: editingPhaseDescription,
        start_date: editingStartDate || null,
        end_date: editingEndDate || null
      });
      if (isReturnedActionError(updatedPhase)) {
        handleError(getErrorMessage(updatedPhase));
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
      toast.success(t('projectDetail.phaseUpdatedSuccess', 'Phase updated successfully!'));
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
      if (isReturnedActionError(deleteResult)) {
        handleError(getErrorMessage(deleteResult));
        return;
      }
      setProjectPhases(prevPhases =>
        prevPhases.filter(phase => phase.phase_id !== deletePhaseConfirmation.phaseId)
      );
      if (selectedPhase?.phase_id === deletePhaseConfirmation.phaseId) {
        setSelectedPhase(null);
      }
      toast.success(t('projectDetail.phaseDeletedSuccess', 'Phase deleted successfully!'));
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
      unwrapActionResult(await reorderTasksInStatus(updates));
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
      toast.success(t('projectDetail.tasksReorderedSuccess', 'Tasks reordered successfully'));
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
        toast.error(t('projectDetail.duplicateNoTargetPhase', 'Could not find a target phase to duplicate to.'));
        return;
    }
    // Using placeholderTargetPhase directly in the dialog

    try {
        // Fetch necessary details for the dialog toggles
        const [resourcesResult, linksResult, checklistResult] = await Promise.all([
            getTaskResourcesAction(task.task_id),
            getTaskTicketLinksAction(task.task_id),
            getTaskChecklistItems(task.task_id)
        ]);
        const resources = unwrapActionResult(resourcesResult);
        const links = unwrapActionResult(linksResult);
        const checklist = unwrapActionResult(checklistResult);

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
      const movedTask = unwrapActionResult(await moveTaskToPhase(
        taskToMove.task_id,
        targetPhaseId,
        targetStatusId
      ));

      if (movedTask) {
        const checklistItems = unwrapActionResult(await getTaskChecklistItems(movedTask.task_id));
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
          toast.success(
            t(
              'projectDetail.taskMovedCrossPhaseSuccess',
              'Task "{{taskName}}" moved to different phase successfully! Switch to the target phase to see it.',
              { taskName: taskToMove.task_name },
            ),
          );
        } else {
          // Task moved within the same phase (to different status) - update in place
          setProjectTasks(prevTasks =>
            prevTasks.map(t => t.task_id === movedTask.task_id ? taskWithDetails : t)
          );
          toast.success(
            t('projectDetail.taskMovedSuccess', 'Task "{{taskName}}" moved successfully!', {
              taskName: taskToMove.task_name,
            }),
          );
        }
      } else {
        toast.error(t('projectDetail.moveTaskFailed', 'Failed to move task. Please try again.'));
      }
    } catch (error) {
      handleError(error, 'Failed to move task');
    } finally {
      setIsMoveTaskDialogOpen(false);
      setTaskToMove(null);
    }
  };

  // Handler for bulk move confirmation
  const handleBulkMoveConfirm = async (targetPhaseId: string, targetStatusId: string | undefined) => {
    const ids = Array.from(selectedTaskIds);
    if (ids.length === 0) return;

    const moved: IProjectTask[] = [];
    const failed: string[] = [];

    for (const taskId of ids) {
      try {
        const movedTask = unwrapActionResult(await moveTaskToPhase(taskId, targetPhaseId, targetStatusId));
        if (movedTask) {
          moved.push(movedTask);
        } else {
          failed.push(taskId);
        }
      } catch (error) {
        console.error(`Failed to move task ${taskId}:`, error);
        failed.push(taskId);
      }
    }

    if (moved.length > 0) {
      const movedMap = new Map(moved.map(m => [m.task_id, m]));
      setProjectTasks(prev => prev.flatMap(t => {
        const m = movedMap.get(t.task_id);
        if (!m) return [t];
        // Drop from the current kanban view when moved out of the selected phase
        if (selectedPhase && m.phase_id !== selectedPhase.phase_id) return [];
        return [{ ...t, ...m }];
      }));
      setAllProjectTasks(prev => prev.map(t => {
        const m = movedMap.get(t.task_id);
        return m
          ? { ...t, phase_id: m.phase_id, project_status_mapping_id: m.project_status_mapping_id }
          : t;
      }));
    }

    if (failed.length === 0) {
      toast.success(
        t('projectDetail.bulkMoveSuccess', '{{count}} task(s) moved successfully!', { count: moved.length }),
      );
    } else {
      toast.error(
        t('projectDetail.bulkMovePartial', 'Moved {{moved}} task(s), {{failed}} failed.', {
          moved: moved.length,
          failed: failed.length,
        }),
      );
    }

    clearSelection();
    setIsBulkMoveOpen(false);
  };

  // Handler for bulk delete confirmation
  const handleBulkDeleteConfirm = async () => {
    const ids = Array.from(selectedTaskIds);
    if (ids.length === 0) return;

    const deleted: string[] = [];
    const failed: string[] = [];

    for (const taskId of ids) {
      try {
        const result = await deleteTaskAction(taskId);
        if (isReturnedActionError(result)) {
          toast.error(getErrorMessage(result));
          failed.push(taskId);
          continue;
        }
        deleted.push(taskId);
      } catch (error) {
        console.error(`Failed to delete task ${taskId}:`, error);
        failed.push(taskId);
      }
    }

    if (deleted.length > 0) {
      const deletedSet = new Set(deleted);
      setProjectTasks(prev => prev.filter(t => !deletedSet.has(t.task_id)));
      setAllProjectTasks(prev => prev.filter(t => !deletedSet.has(t.task_id)));
    }

    if (failed.length === 0) {
      toast.success(
        t('projectDetail.bulkDeleteSuccess', '{{count}} task(s) deleted successfully!', { count: deleted.length }),
      );
    } else {
      toast.error(
        t('projectDetail.bulkDeletePartial', 'Deleted {{deleted}} task(s), {{failed}} failed.', {
          deleted: deleted.length,
          failed: failed.length,
        }),
      );
    }

    clearSelection();
    setIsBulkDeleteOpen(false);
  };

  // Handler for bulk assign confirmation — dispatches to user- or team-assign
  // based on the dialog's selection.
  const handleBulkAssignConfirm = async (
    selection: { kind: 'user'; userId: string | null } | { kind: 'team'; teamId: string },
  ) => {
    const ids = Array.from(selectedTaskIds);
    if (ids.length === 0) return;

    let success = 0;
    let failed = 0;

    if (selection.kind === 'user') {
      const userId = selection.userId;
      // Tasks whose team_member resource rows were just wiped — their cached
      // resources need to be refetched so list-view and the agent filter no
      // longer count the removed members.
      const resourcesToRefresh: string[] = [];

      for (const taskId of ids) {
        const task = projectTasks.find(t => t.task_id === taskId)
          || allProjectTasks.find(t => t.task_id === taskId);
        if (!task) {
          failed++;
          continue;
        }
        try {
          // A user assignment should become the primary assignee. The UI renders the
          // team over the user, so any existing team assignment must be removed first.
          if (task.assigned_team_id) {
            unwrapActionResult(await removeTeamFromProjectTask(taskId, { mode: 'remove_all' }));
            resourcesToRefresh.push(taskId);
          }
          const updatedTask = await updateTaskWithChecklist(taskId, {
            ...task,
            assigned_to: userId,
            assigned_team_id: null,
            estimated_hours: Number(task.estimated_hours) || 0,
            actual_hours: Number(task.actual_hours) || 0,
            checklist_items: task.checklist_items,
          });
          if (isReturnedActionError(updatedTask)) {
            toast.error(getErrorMessage(updatedTask));
            failed++;
            continue;
          }
          if (updatedTask) {
            const checklistItems = unwrapActionResult(await getTaskChecklistItems(taskId));
            const taskWithChecklist = { ...updatedTask, assigned_team_id: null, checklist_items: checklistItems };
            setProjectTasks(prev => prev.map(t => (t.task_id === taskId ? taskWithChecklist : t)));
            setAllProjectTasks(prev => prev.map(t => (t.task_id === taskId ? taskWithChecklist : t)));
            success++;
          } else {
            failed++;
          }
        } catch (error) {
          console.error(`Failed to assign task ${taskId}:`, error);
          failed++;
        }
      }

      if (resourcesToRefresh.length > 0) {
        const refreshed = await Promise.all(
          resourcesToRefresh.map(async (id) => {
            try {
              return [id, unwrapActionResult(await getTaskResourcesAction(id))] as const;
            } catch (error) {
              console.error(`Failed to refresh resources for task ${id}:`, error);
              return null;
            }
          }),
        );
        const updates = refreshed.filter((r): r is readonly [string, ITaskResource[]] => r !== null);
        if (updates.length > 0) {
          setPhaseTaskResources(prev => {
            const next = { ...prev };
            for (const [id, resources] of updates) next[id] = resources;
            return next;
          });
          setAllProjectTaskResources(prev => {
            const next = { ...prev };
            for (const [id, resources] of updates) next[id] = resources;
            return next;
          });
        }
      }

      if (failed === 0) {
        toast.success(
          t('projectDetail.bulkAssignSuccess', '{{count}} task(s) assigned successfully!', { count: success }),
        );
      } else {
        toast.error(
          t('projectDetail.bulkAssignPartial', 'Assigned {{success}} task(s), {{failed}} failed.', {
            success,
            failed,
          }),
        );
      }
    } else {
      const teamId = selection.teamId;
      for (const taskId of ids) {
        const task = projectTasks.find(t => t.task_id === taskId)
          || allProjectTasks.find(t => t.task_id === taskId);
        if (!task) {
          failed++;
          continue;
        }
        if (task.assigned_team_id === teamId) {
          // Already assigned to this team — nothing to do, count as success.
          success++;
          continue;
        }

        try {
          // If a different team is currently assigned, drop it first. Bulk mode
          // can't surface the per-task keep/remove prompt, so we mirror the
          // single-user-assign path (which always removes the prior team).
          if (task.assigned_team_id) {
            unwrapActionResult(await removeTeamFromProjectTask(taskId, { mode: 'remove_all' }));
          }
          unwrapActionResult(await assignTeamToProjectTask(taskId, teamId));
          await refreshTaskAfterTeamChange(taskId);
          success++;
        } catch (error) {
          console.error(`Failed to assign team to task ${taskId}:`, error);
          failed++;
        }
      }

      if (failed === 0) {
        toast.success(
          t('projectDetail.bulkAssignTeamSuccess', '{{count}} task(s) assigned to team successfully!', { count: success }),
        );
      } else {
        toast.error(
          t('projectDetail.bulkAssignTeamPartial', 'Assigned {{success}} task(s) to team, {{failed}} failed.', {
            success,
            failed,
          }),
        );
      }
    }

    clearSelection();
    setIsBulkAssignOpen(false);
  };

  // Handler for bulk tag add confirmation
  const handleBulkAddTagsConfirm = async (tagTexts: string[]) => {
    const ids = Array.from(selectedTaskIds);
    if (ids.length === 0 || tagTexts.length === 0) return;

    setIsBulkAddingTags(true);
    setBulkTagsErrors([]);

    try {
      const result = await bulkAddTagsToTasks(ids, tagTexts);

      if (result.updatedIds.length > 0) {
        // Refetch authoritative tags for the updated tasks and push them into
        // the per-task tag state via the existing handler.
        try {
          const refreshed = await findTagsByEntityIds(result.updatedIds, 'project_task');
          if (isTagActionError(refreshed)) {
            console.error('Failed to refresh task tags after bulk add:', refreshed);
            return;
          }
          const byTask = new Map<string, ITag[]>();
          for (const id of result.updatedIds) byTask.set(id, []);
          for (const tag of refreshed) {
            const list = byTask.get(tag.tagged_id) ?? [];
            list.push(tag);
            byTask.set(tag.tagged_id, list);
          }
          for (const [taskId, tags] of byTask) {
            handleTaskTagsChange(taskId, tags);
          }
        } catch (error) {
          console.error('Failed to refresh task tags after bulk add:', error);
        }
      }

      if (result.failed.length > 0) {
        setBulkTagsErrors(result.failed);
        // Narrow selection to failed tasks so the user can retry on just those.
        setTasksSelected(ids, false);
        setTasksSelected(result.failed.map(f => f.taskId), true);
        if (result.updatedIds.length > 0) {
          toast.success(
            t('projectDetail.bulkTagsSuccess', 'Tags added to {{count}} task(s)', { count: result.updatedIds.length }),
          );
        }
        toast.error(
          t('projectDetail.bulkTagsPartial', 'Tags could not be added to some tasks'),
        );
      } else {
        if (result.updatedIds.length > 0) {
          toast.success(
            t('projectDetail.bulkTagsSuccess', 'Tags added to {{count}} task(s)', { count: result.updatedIds.length }),
          );
        }
        // Keep selection so user can run more bulk actions on the same tasks.
        setIsBulkTagsOpen(false);
      }
    } catch (error) {
      handleError(error, t('projectDetail.bulkTagsFailure', 'Failed to add tags to selected tasks'));
    } finally {
      setIsBulkAddingTags(false);
    }
  };

  // Render the sticky header with title, view switcher, search, and filters
  const renderHeader = () => {
    const completionPercentage = (completedTasksCount / filteredTasks.length) * 100 || 0;

    if (viewMode === 'list') {
      return (
        <div className="mb-4 space-y-3 flex-shrink-0">
          {/* Top row: Title + Density + Pin + View Switcher */}
          <div className="flex justify-between items-center">
            <h2 className="text-xl font-bold">{t('projectDetail.taskList', 'Task List')}</h2>
            <div className="flex items-center gap-4">
              <ViewDensityControl
                idPrefix="project-task-list-density"
                value={listDensityLevel ?? PROJECT_LIST_DENSITY_DEFAULT}
                onChange={setListDensityLevel}
                step={PROJECT_LIST_DENSITY_STEP}
                defaultValue={PROJECT_LIST_DENSITY_DEFAULT}
                compactLabel={t('projectDetail.spacing.compact', 'Compact')}
                spaciousLabel={t('projectDetail.spacing.spacious', 'Spacious')}
                decreaseTitle={t('projectDetail.spacing.decrease', 'Decrease list spacing')}
                increaseTitle={t('projectDetail.spacing.increase', 'Increase list spacing')}
                resetTitle={t('projectDetail.spacing.reset', 'Reset list spacing')}
              />
              <Tooltip content={isHeaderPinned ? t('projectDetail.unpinHeader', 'Unpin header') : t('projectDetail.pinHeader', 'Pin header to top')}>
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
                  aria-label={isHeaderPinned ? t('projectDetail.unpinHeader', 'Unpin header') : t('projectDetail.pinHeader', 'Pin header to top')}
                >
                  <Pin className={`h-4 w-4 ${isHeaderPinned ? 'fill-current' : ''}`} />
                </Button>
              </Tooltip>
              <ViewSwitcher
                currentView={viewMode}
                onChange={(v) => setViewMode(v as ProjectViewMode)}
                options={[
                  { value: 'kanban', label: t('kanbanView', 'Kanban'), icon: LayoutGrid },
                  { value: 'list', label: t('listView', 'List'), icon: List }
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
                  placeholder={t('projectDetail.searchTasksPlaceholder', 'Search tasks...')}
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
                    aria-label={t('projectDetail.clearSearch', 'Clear search')}
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
                title={t('projectDetail.wholeWord', 'Whole word')}
              >
                {t('projectDetail.wholeWordShort', 'Word')}
              </Button>
              <Button
                id="search-case-sensitive-list"
                variant={searchCaseSensitive ? 'soft' : 'outline'}
                size="xs"
                onClick={() => setSearchCaseSensitive(!searchCaseSensitive)}
                title={t('projectDetail.caseSensitive', 'Case sensitive')}
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
                <MultiUserAndTeamPicker
                  id="task-agent-filter-list"
                  values={selectedAgentFilter}
                  onValuesChange={handleAgentFilterChange}
                  users={users}
                  teams={teams}
                  teamValues={selectedTeamFilter}
                  onTeamValuesChange={setSelectedTeamFilter}
                  getUserAvatarUrlsBatch={getUserAvatarUrlsBatchAction}
                  getTeamAvatarUrlsBatch={getTeamAvatarUrlsBatchAction}
                  filterMode={true}
                  includeUnassigned={includeUnassignedAgents}
                  onUnassignedChange={setIncludeUnassignedAgents}
                  compactDisplay={true}
                  placeholder={t('projectDetail.allAgents', 'All Agents')}
                />
              </div>
              {selectedAgentFilter.length === 1 && (
                <Button
                  id="primary-agent-only-list"
                  variant={primaryAgentOnly ? 'soft' : 'outline'}
                  size="xs"
                  onClick={() => setPrimaryAgentOnly(!primaryAgentOnly)}
                  title={t('projectDetail.primaryAssigneeOnly', 'Only show tasks where selected agent is the primary assignee')}
                >
                  {t('projectDetail.primaryShort', 'Primary')}
                </Button>
              )}
            </div>

            {/* Priority Filter */}
            <CustomSelect
              value={selectedPriorityFilter}
              onValueChange={setSelectedPriorityFilter}
              options={[
                { value: 'all', label: t('taskTicketLinks.allPriorities', 'All Priorities') },
                ...priorities.map(p => ({
                  value: p.priority_id,
                  label: p.priority_name,
                  color: p.color
                }))
              ]}
              className="w-40"
              placeholder={t('projectDetail.priority', 'Priority')}
            />

            {/* Task Type Filter */}
            <CustomSelect
              value={selectedTaskTypeFilter}
              onValueChange={setSelectedTaskTypeFilter}
              options={[
                { value: 'all', label: t('projectDetail.allTypes', 'All Types') },
                ...taskTypes.map(t => {
                  const Icon = taskTypeIcons[t.type_key] || ClipboardList;
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
              placeholder={t('projectDetail.taskType', 'Task Type')}
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
                setSelectedTeamFilter([]);
                setIncludeUnassignedAgents(false);
                setPrimaryAgentOnly(false);
                setSelectedPriorityFilter('all');
                setSelectedTaskTypeFilter('all');
              }}
              className={`shrink-0 flex items-center gap-1 ${(searchQuery || searchWholeWord || searchCaseSensitive || selectedTaskTags.length > 0 || selectedAgentFilter.length > 0 || selectedTeamFilter.length > 0 || includeUnassignedAgents || primaryAgentOnly || selectedPriorityFilter !== 'all' || selectedTaskTypeFilter !== 'all') ? 'text-gray-500 hover:text-gray-700' : 'invisible'}`}
              disabled={!(searchQuery || searchWholeWord || searchCaseSensitive || selectedTaskTags.length > 0 || selectedAgentFilter.length > 0 || selectedTeamFilter.length > 0 || includeUnassignedAgents || primaryAgentOnly || selectedPriorityFilter !== 'all' || selectedTaskTypeFilter !== 'all')}
            >
              <XCircle className="h-4 w-4" />
              {t('common:actions.reset', 'Reset')}
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
              {selectedPhase
                ? t('projectDetail.kanbanBoardWithPhase', 'Kanban Board: {{phaseName}}', { phaseName: selectedPhase.phase_name })
                : t('projectDetail.kanbanBoard', 'Kanban Board')}
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
            <Popover>
              <Tooltip content={t('projectDetail.showHideColumns', 'Show/hide columns')}>
                <PopoverTrigger asChild>
                  <Button
                    id="kanban-column-visibility-toggle"
                    variant="ghost"
                    size="sm"
                    className={`relative p-1.5 h-auto w-auto transition-colors ${
                      hiddenVisibleStatusCount > 0
                        ? 'bg-primary-100 text-primary-600'
                        : 'text-gray-400 hover:text-gray-600'
                    }`}
                    aria-label={t('projectDetail.showHideColumns', 'Show/hide columns')}
                  >
                    <EyeOff className="h-4 w-4" />
                    {hiddenVisibleStatusCount > 0 && (
                      <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary-500 px-1 text-[10px] font-semibold leading-none text-white">
                        {hiddenVisibleStatusCount}
                      </span>
                    )}
                  </Button>
                </PopoverTrigger>
              </Tooltip>
              <PopoverContent align="end" className="w-64 p-2">
                <div className="flex items-center justify-between px-1 pb-1.5">
                  <span className="text-sm font-semibold text-[rgb(var(--color-text-900))]">
                    {t('projectDetail.columns', 'Columns')}
                  </span>
                  <Button
                    id="kanban-show-all-columns"
                    variant="ghost"
                    size="xs"
                    onClick={showAllKanbanStatuses}
                    disabled={hiddenVisibleStatusCount === 0}
                    className="text-xs"
                  >
                    {t('projectDetail.showAll', 'Show all')}
                  </Button>
                </div>
                <div className="max-h-72 overflow-y-auto">
                  {visibleKanbanStatuses.length === 0 ? (
                    <p className="px-1 py-2 text-sm text-gray-500">
                      {t('projectDetail.noColumns', 'No columns available')}
                    </p>
                  ) : (
                    visibleKanbanStatuses.map((status) => {
                      const isHidden = hiddenStatusIdentitySet.has(getKanbanStatusIdentity(status));
                      return (
                        <button
                          key={status.project_status_mapping_id}
                          type="button"
                          onClick={() => toggleKanbanStatusHidden(status)}
                          className="flex w-full items-center gap-2 rounded-sm px-1.5 py-1.5 text-left text-sm transition-colors hover:bg-muted"
                        >
                          {isHidden
                            ? <EyeOff className="h-4 w-4 flex-shrink-0 text-gray-400" />
                            : <Eye className="h-4 w-4 flex-shrink-0 text-primary-600" />}
                          {status.color && (
                            <span
                              className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
                              style={{ backgroundColor: status.color }}
                            />
                          )}
                          <span className={`min-w-0 flex-1 truncate ${isHidden ? 'text-gray-400' : 'text-[rgb(var(--color-text-900))]'}`}>
                            {status.custom_name || status.name}
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>
              </PopoverContent>
            </Popover>
            <Tooltip content={showStickyStatusNames ? t('projectDetail.hideStickyStatusNames', 'Hide sticky status names') : t('projectDetail.showStickyStatusNames', 'Show sticky status names')}>
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
                aria-label={showStickyStatusNames ? t('projectDetail.hideStickyStatusNames', 'Hide sticky status names') : t('projectDetail.showStickyStatusNames', 'Show sticky status names')}
              >
                <Columns3 className="h-4 w-4" />
              </Button>
            </Tooltip>
            <Tooltip content={isHeaderPinned ? t('projectDetail.unpinHeader', 'Unpin header') : t('projectDetail.pinHeader', 'Pin header to top')}>
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
                aria-label={isHeaderPinned ? t('projectDetail.unpinHeader', 'Unpin header') : t('projectDetail.pinHeader', 'Pin header to top')}
              >
                <Pin className={`h-4 w-4 ${isHeaderPinned ? 'fill-current' : ''}`} />
              </Button>
            </Tooltip>
            <ViewSwitcher
              currentView={viewMode}
              onChange={(v) => setViewMode(v as ProjectViewMode)}
              options={[
                { value: 'kanban', label: t('kanbanView', 'Kanban'), icon: LayoutGrid },
                { value: 'list', label: t('listView', 'List'), icon: List }
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
                  placeholder={t('projectDetail.searchTasksPlaceholder', 'Search tasks...')}
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
                    aria-label={t('projectDetail.clearSearch', 'Clear search')}
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
                title={t('projectDetail.wholeWord', 'Whole word')}
              >
                {t('projectDetail.wholeWordShort', 'Word')}
              </Button>
              <Button
                id="search-case-sensitive-kanban"
                variant={searchCaseSensitive ? 'soft' : 'outline'}
                size="xs"
                onClick={() => setSearchCaseSensitive(!searchCaseSensitive)}
                title={t('projectDetail.caseSensitive', 'Case sensitive')}
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
                <MultiUserAndTeamPicker
                  id="task-agent-filter-kanban"
                  values={selectedAgentFilter}
                  onValuesChange={handleAgentFilterChange}
                  users={users}
                  teams={teams}
                  teamValues={selectedTeamFilter}
                  onTeamValuesChange={setSelectedTeamFilter}
                  getUserAvatarUrlsBatch={getUserAvatarUrlsBatchAction}
                  getTeamAvatarUrlsBatch={getTeamAvatarUrlsBatchAction}
                  filterMode={true}
                  includeUnassigned={includeUnassignedAgents}
                  onUnassignedChange={setIncludeUnassignedAgents}
                  compactDisplay={true}
                  placeholder={t('projectDetail.allAgents', 'All Agents')}
                />
              </div>
              {selectedAgentFilter.length === 1 && (
                <Button
                  id="primary-agent-only-kanban"
                  variant={primaryAgentOnly ? 'soft' : 'outline'}
                  size="xs"
                  onClick={() => setPrimaryAgentOnly(!primaryAgentOnly)}
                  title={t('projectDetail.primaryAssigneeOnly', 'Only show tasks where selected agent is the primary assignee')}
                >
                  {t('projectDetail.primaryShort', 'Primary')}
                </Button>
              )}
            </div>

            {/* Priority Filter */}
            <CustomSelect
              value={selectedPriorityFilter}
              onValueChange={setSelectedPriorityFilter}
              options={[
                { value: 'all', label: t('taskTicketLinks.allPriorities', 'All Priorities') },
                ...priorities.map(p => ({
                  value: p.priority_id,
                  label: p.priority_name,
                  color: p.color
                }))
              ]}
              className="w-40"
              placeholder={t('projectDetail.priority', 'Priority')}
            />

            {/* Task Type Filter */}
            <CustomSelect
              value={selectedTaskTypeFilter}
              onValueChange={setSelectedTaskTypeFilter}
              options={[
                { value: 'all', label: t('projectDetail.allTypes', 'All Types') },
                ...taskTypes.map(t => {
                  const Icon = taskTypeIcons[t.type_key] || ClipboardList;
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
              placeholder={t('projectDetail.taskType', 'Task Type')}
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
                setSelectedTeamFilter([]);
                setIncludeUnassignedAgents(false);
                setPrimaryAgentOnly(false);
                setSelectedPriorityFilter('all');
                setSelectedTaskTypeFilter('all');
              }}
              className={`shrink-0 flex items-center gap-1 ${(searchQuery || searchWholeWord || searchCaseSensitive || selectedTaskTags.length > 0 || selectedAgentFilter.length > 0 || selectedTeamFilter.length > 0 || includeUnassignedAgents || primaryAgentOnly || selectedPriorityFilter !== 'all' || selectedTaskTypeFilter !== 'all') ? 'text-gray-500 hover:text-gray-700' : 'invisible'}`}
              disabled={!(searchQuery || searchWholeWord || searchCaseSensitive || selectedTaskTags.length > 0 || selectedAgentFilter.length > 0 || selectedTeamFilter.length > 0 || includeUnassignedAgents || primaryAgentOnly || selectedPriorityFilter !== 'all' || selectedTaskTypeFilter !== 'all')}
            >
              <XCircle className="h-4 w-4" />
              {t('common:actions.reset', 'Reset')}
            </Button>
          </div>

          {/* Completion Stats */}
          {selectedPhase && (
            <div className="flex items-center gap-2">
              <DonutChart
                percentage={completionPercentage}
                tooltipContent={t(
                  'projectDetail.selectedPhaseCompletionHelp',
                  'Shows the percentage of completed tasks for the selected phase "{{phaseName}}" only',
                  { phaseName: selectedPhase.phase_name },
                )}
              />
              <span className="text-sm font-medium text-gray-600">
                {t('projectDetail.completionSummary', '{{completed}} / {{total}} Done', {
                  completed: completedTasksCount,
                  total: filteredTasks.length,
                })}
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
            <div className="text-gray-500">{t('projectDetail.loadingListView', 'Loading list view...')}</div>
          </div>
        );
      }

      return (
        <TaskListView
          phases={projectPhases}
          tasks={allProjectTasks}
          statuses={projectStatuses}
          statusesByPhase={statusesByPhase}
          columnWidths={listColumnWidths}
          onColumnWidthsChange={setListColumnWidths}
          densityFontPx={listDensity.fontPx}
          densityCellPadding={listDensity.cellPadding}
          densityScale={listDensity.scale}
          tagSize={listDensity.tagSize}
          pickerSize={listDensity.pickerSize}
          avatarSize={listDensity.avatarSize}
          priorities={priorities}
          taskTypes={taskTypes}
          onTaskUpdate={handleListTaskUpdate}
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
          onTeamAssign={handleTeamAssign}
          teams={teams}
          users={users}
          teamNames={teamNames}
          teamAvatarUrls={teamAvatarUrls}
          selectedPriorityFilter={selectedPriorityFilter}
          selectedTaskTags={selectedTaskTags}
          selectedAgentFilter={selectedAgentFilter}
          selectedTeamFilter={selectedTeamFilter}
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
              {t('projectDetail.selectPhaseToViewKanban', 'Please select or create a phase to view the Kanban board.')}
              <Tooltip content={t('projectDetail.phaseHelp', 'A phase is a distinct stage or milestone in your project timeline. Each phase can contain multiple tasks and helps organize work into manageable sections.')}>
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
        ) : displayedKanbanStatuses.length === 0 && hiddenVisibleStatusCount > 0 ? (
          // Every visible column has been hidden by the user — the board would
          // otherwise be blank with no per-column controls to recover from, so
          // surface an explicit "show all" affordance here.
          <div
            id="kanban-all-columns-hidden"
            className="flex flex-col items-center justify-center gap-3 py-16 text-center"
          >
            <EyeOff className="h-8 w-8 text-gray-300" />
            <div>
              <p className="text-sm font-medium text-[rgb(var(--color-text-900))]">
                {t('projectDetail.allColumnsHidden', 'All columns are hidden')}
              </p>
              <p className="mt-1 text-sm text-gray-500">
                {t('projectDetail.allColumnsHiddenHint', 'Show one or more columns to see your tasks.')}
              </p>
            </div>
            <Button
              id="kanban-show-all-columns-empty"
              variant="outline"
              size="sm"
              onClick={showAllKanbanStatuses}
            >
              <Eye className="mr-1.5 h-4 w-4" />
              {t('projectDetail.showAllColumns', 'Show all columns')}
            </Button>
          </div>
        ) : (
          <KanbanBoard
            tasks={projectTasks}
            phaseTasks={filteredTasks}
            users={users}
            taskTypes={taskTypes}
            statuses={displayedKanbanStatuses}
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
            hideHeader={showStickyStatusNames}
            revealedHiddenStatusIds={forceVisibleStatusMappingIds}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onAddCard={handleAddCard}
            onTaskSelected={handleTaskSelected}
            onAssigneeChange={handleAssigneeChange}
            onTeamAssign={handleTeamAssign}
            teams={teams}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onReorderTasks={handleReorderTasks}
            onMoveTaskClick={handleMoveTaskClick}
            onDuplicateTaskClick={handleDuplicateTaskClick}
            onEditTaskClick={handleTaskSelected}
            onDeleteTaskClick={handleDeleteTaskClick}
            onTaskTagsChange={handleTaskTagsChange}
            onHideColumn={toggleKanbanStatusHidden}
          />
        )}
      </div>
    );
  };

  return (
    <div ref={pageContainerRef} className={styles.pageContainer}>
      <div
        className={styles.mainContent}
        onDragOver={handleDragOver}
      >
        <div className={styles.contentWrapper}>
          {/* Phases panel - collapsible in kanban view */}
          {viewMode === 'kanban' && (
            <div
                ref={phasesContainerRef}
                className={`${styles.phasesContainer} ${isPhasesPanelVisible ? styles.phasesContainerExpanded : styles.phasesContainerCollapsed}`}
                style={phasesPanelHeight && isPhasesPanelVisible ? { height: `${phasesPanelHeight}px`, maxHeight: `${phasesPanelHeight}px` } : undefined}
              >
              {/* Toggle button */}
              <CollapseToggleButton
                id="toggle-phases-panel"
                isCollapsed={!isPhasesPanelVisible}
                collapsedLabel={t('projectDetail.showPhasesPanel', 'Show phases panel')}
                expandedLabel={t('projectDetail.hidePhasesPanel', 'Hide phases panel')}
                className={styles.phasesPanelToggle}
                onClick={() => setIsPhasesPanelVisible(!isPhasesPanelVisible)}
              />

              {/* Phases panel content */}
              <div className={`${styles.phasesList} ${isPhasesPanelVisible ? styles.phasesListVisible : styles.phasesListHidden}`}>
                <ProjectPhases
                  phases={projectPhases}
                  projectId={project.project_id}
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
                      toast.error(t('projectDetail.selectPhaseToAddTask', 'Please select a phase before adding a task.'));
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
                  onStatusesChanged={() => setStatusVersion(v => v + 1)}
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
              <div className={styles.kanbanScrollbarShell}>
                <div
                  ref={scrollbarTrackRef}
                  className={styles.kanbanScrollbarTrack}
                  onPointerDown={handleKanbanScrollbarTrackPointerDown}
                >
                  <div
                    data-kanban-scrollbar-thumb="true"
                    ref={scrollbarThumbRef}
                    className={styles.kanbanScrollbarThumb}
                    onPointerDown={handleKanbanScrollbarThumbPointerDown}
                    onKeyDown={handleKanbanScrollbarKeyDown}
                    role="scrollbar"
                    aria-controls="kanban-scroll-container"
                    aria-orientation="horizontal"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={0}
                    tabIndex={0}
                  />
                </div>
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
                    {displayedKanbanStatuses.map((status, index) => {
                      const { itemStyle, countStyle } = getStatusStripStyles(status, index);
                      const stripTaskIds = filteredTasks
                        .filter(t => t.project_status_mapping_id === status.project_status_mapping_id)
                        .map(t => t.task_id);
                      const stripAllSelected = stripTaskIds.length > 0
                        && stripTaskIds.every(id => selectedTaskIds.has(id));
                      const stripSomeSelected = stripTaskIds.some(id => selectedTaskIds.has(id));
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
                          {stripTaskIds.length > 0 && (
                            <Checkbox
                              id={`select-sticky-status-${status.project_status_mapping_id}`}
                              checked={stripAllSelected}
                              indeterminate={stripSomeSelected && !stripAllSelected}
                              onChange={() => setTasksSelected(stripTaskIds, !stripAllSelected)}
                              size="sm"
                              containerClassName="flex-shrink-0"
                              skipRegistration
                            />
                          )}
                          <span className={styles.kanbanStatusStripName}>
                            {status.custom_name || status.name}
                          </span>
                          <Button
                            id={`sticky-add-task-button-${status.project_status_mapping_id}`}
                            variant="default"
                            size="sm"
                            onClick={() => handleAddCard(status)}
                            disabled={isAddingTask || !selectedPhase}
                            tooltipText={t('common:actions.add', 'Add')}
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
            <div id="kanban-scroll-container" className={styles.kanbanContainer} ref={kanbanBoardRef} data-kanban-container="true">
              {renderContent()}
            </div>
          </div>
        </div>
      </div>

      {(showQuickAdd && (currentPhase || selectedPhase)) && (
        selectedTask ? (
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
        )
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
          title={
            moveConfirmation.taskIds && moveConfirmation.taskIds.length > 1
              ? t('projectDetail.moveTasksTitle', 'Move Tasks')
              : t('dialogs.moveTask.title', 'Move Task')
          }
          message={
            moveConfirmation.taskIds && moveConfirmation.taskIds.length > 1
              ? t(
                  'projectDetail.confirmMoveTasksMessage',
                  'Are you sure you want to move {{count}} selected tasks to phase "{{targetPhase}}"?',
                  {
                    count: moveConfirmation.taskIds.length,
                    targetPhase: moveConfirmation.targetPhase.phase_name,
                  },
                )
              : t(
                  'projectDetail.confirmMoveTaskMessage',
                  'Are you sure you want to move task "{{taskName}}" from phase "{{sourcePhase}}" to "{{targetPhase}}"?',
                  {
                    taskName: moveConfirmation.taskName,
                    sourcePhase: moveConfirmation.sourcePhase.phase_name,
                    targetPhase: moveConfirmation.targetPhase.phase_name,
                  },
                )
          }
          confirmLabel={t('common:actions.confirm', 'Confirm')}
          cancelLabel={t('common:actions.cancel', 'Cancel')}
        />
      )}

      {deletePhaseConfirmation && (
        <ConfirmationDialog
          isOpen={true}
          onClose={() => setDeletePhaseConfirmation(null)}
          onConfirm={handleDeletePhase}
          title={t('projectDetail.deletePhaseTitle', 'Delete Phase')}
          message={t(
            'projectDetail.deletePhaseMessage',
            'Are you sure you want to delete phase "{{phaseName}}"? This will also delete all tasks and their checklists in this phase.',
            { phaseName: deletePhaseConfirmation.phaseName },
          )}
          confirmLabel={t('common:actions.delete', 'Delete')}
          cancelLabel={t('common:actions.cancel', 'Cancel')}
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
              const newTask = unwrapActionResult(await duplicateTaskToPhase(
                taskToDuplicate.task_id,
                targetPhaseId,
                options
              ));
              
              const checklistItems = unwrapActionResult(await getTaskChecklistItems(newTask.task_id));
              const taskWithChecklist = { ...newTask, checklist_items: checklistItems };
              setProjectTasks(prev => [...prev, taskWithChecklist]);
              // Add to allProjectTasks for filtered counts
              setAllProjectTasks(prev => [...prev, taskWithChecklist]);

              toast.success(
                t('projectDetail.taskDuplicatedSuccess', 'Task "{{taskName}}" duplicated successfully!', {
                  taskName: newTask.task_name,
                }),
              );
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

      {/* Bulk task action bar */}
      <BulkTaskActionBar
        onMove={() => setIsBulkMoveOpen(true)}
        onAssign={() => setIsBulkAssignOpen(true)}
        onTags={() => {
          setBulkTagsErrors([]);
          setIsBulkTagsOpen(true);
        }}
        onDelete={() => setIsBulkDeleteOpen(true)}
      />

      {/* Bulk Move Task Dialog */}
      {isBulkMoveOpen && (
        <BulkMoveTaskDialog
          isOpen={isBulkMoveOpen}
          onClose={() => setIsBulkMoveOpen(false)}
          taskCount={selectedTaskIds.size}
          projectTreeData={projectTreeData}
          onConfirm={handleBulkMoveConfirm}
        />
      )}

      {/* Bulk Assign Dialog (users + teams) */}
      {isBulkAssignOpen && (
        <BulkAssignDialog
          isOpen={isBulkAssignOpen}
          onClose={() => setIsBulkAssignOpen(false)}
          taskCount={selectedTaskIds.size}
          users={users}
          teams={teams}
          onConfirm={handleBulkAssignConfirm}
        />
      )}

      {/* Bulk Add Tags Dialog */}
      <BulkAddTagsToTasksDialog
        isOpen={isBulkTagsOpen && selectedTaskIds.size > 0}
        onClose={() => setIsBulkTagsOpen(false)}
        taskCount={selectedTaskIds.size}
        failed={bulkTagsErrors.map(err => {
          const task = projectTasks.find(t => t.task_id === err.taskId)
            || allProjectTasks.find(t => t.task_id === err.taskId);
          return { ...err, label: task?.task_name };
        })}
        isSubmitting={isBulkAddingTags}
        onConfirm={handleBulkAddTagsConfirm}
      />

      {/* Bulk Delete Confirmation Dialog */}
      {isBulkDeleteOpen && (
        <ConfirmationDialog
          isOpen={isBulkDeleteOpen}
          onClose={() => setIsBulkDeleteOpen(false)}
          onConfirm={handleBulkDeleteConfirm}
          title={t('projectDetail.bulkDeleteTitle', 'Delete Tasks')}
          message={t(
            'projectDetail.bulkDeleteMessage',
            'Are you sure you want to delete {{count}} selected task(s)? This action cannot be undone.',
            { count: selectedTaskIds.size },
          )}
          confirmLabel={t('common:actions.delete', 'Delete')}
          cancelLabel={t('common:actions.cancel', 'Cancel')}
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
              const result = await deleteTaskAction(taskToDelete.task_id);
              if (isReturnedActionError(result)) {
                toast.error(getErrorMessage(result));
                setTaskToDelete(null);
                return;
              }
              setProjectTasks(prev => prev.filter(t => t.task_id !== taskToDelete.task_id));
              // Remove from allProjectTasks for filtered counts
              setAllProjectTasks(prev => prev.filter(t => t.task_id !== taskToDelete.task_id));
              // Drop the deleted task from the multi-selection so bulk actions and
              // selection-aware labels don't keep counting it
              setTasksSelected([taskToDelete.task_id], false);
              toast.success(
                t('projectDetail.taskDeletedSuccess', 'Task "{{taskName}}" deleted successfully!', {
                  taskName: taskToDelete.task_name,
                }),
              );
              setTaskToDelete(null);
            } catch (error) {
              handleError(error, "Failed to delete task.");
              setTaskToDelete(null);
            }
          }}
          title={t('projectDetail.deleteTaskTitle', 'Delete Task')}
          message={t(
            'projectDetail.deleteTaskMessage',
            'Are you sure you want to delete task "{{taskName}}"? This action cannot be undone.',
            { taskName: taskToDelete.task_name },
          )}
          confirmLabel={t('common:actions.delete', 'Delete')}
          cancelLabel={t('common:actions.cancel', 'Cancel')}
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
            toast.success(
              t('projectDetail.importSuccess', 'Imported {{phases}} phases and {{tasks}} tasks', {
                phases: result.phasesCreated,
                tasks: result.tasksCreated,
              }),
            );
            // Refresh the page to show imported data
            window.location.reload();
          } else if (result.errors.length > 0) {
            toast.error(
              t('projectDetail.importFailed', 'Import failed: {{error}}', {
                error: result.errors[0],
              }),
            );
          }
        }}
      />

      <RemoveTeamDialog
        id="project-detail-team-switch-dialog"
        isOpen={isTeamSwitchDialogOpen}
        onClose={() => {
          setPendingTeamAssign(null);
          setPendingTaskTeamMembers([]);
          setIsTeamSwitchDialogOpen(false);
        }}
        isSwitching={true}
        teamMembers={pendingTaskTeamMembers}
        users={users}
        onConfirm={handleConfirmTeamSwitch}
      />
    </div>
  );
}
