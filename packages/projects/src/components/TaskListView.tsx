'use client';

import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { IProjectPhase, IProjectTask, ProjectStatus, IProjectTaskDependency, IPriority, IStandardPriority, ITaskType } from '@alga-psa/types';
import { ITag } from '@alga-psa/types';
import { ITaskResource } from '@alga-psa/types';
import { ChevronDown, ChevronRight, Pencil, Copy, Trash2, Link2, Ban, GitBranch, Calendar, GripVertical, Plus, CheckSquare, Paperclip, Zap, ClipboardList, Bug, Sparkles, TrendingUp, Flag, BookOpen } from 'lucide-react';
import { extractTaskDescriptionText } from '../lib/taskRichText';
import { Tooltip } from '@alga-psa/ui/components/Tooltip';
import { Button } from '@alga-psa/ui/components/Button';
import { usePrintAction } from '@alga-psa/ui/components/PrintButton';
import {
  PrintOptionsDialog,
  type PrintColumnOption,
  usePrintColumnSelection,
} from '@alga-psa/ui/components/PrintOptionsDialog';
import { useRegisterTaskShareActions } from './TaskShareActionsContext';
import { PrintableTable } from '@alga-psa/ui/components/PrintableTable';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { format } from 'date-fns';
import { TagList } from '@alga-psa/ui/components';
import { TagManager } from '@alga-psa/tags/components';
import UserAvatar from '@alga-psa/ui/components/UserAvatar';
import TeamAvatar from '@alga-psa/ui/components/TeamAvatar';
import UserAndTeamPicker from '@alga-psa/ui/components/UserAndTeamPicker';
import { DatePicker } from '@alga-psa/ui/components/DatePicker';
import { PrioritySelect } from '@alga-psa/ui/components/tickets/PrioritySelect';
import { TaskStatusSelect } from './TaskStatusSelect';
import { TaskTypeSelector } from './TaskTypeSelector';
import { getUserAvatarUrlsBatchAction } from '@alga-psa/user-composition/actions';
import { getTeamAvatarUrlsBatchAction } from '@alga-psa/teams/actions';
import { highlightSearchMatch } from '../lib/searchUtils';
import { useTranslation } from 'react-i18next';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import { useTaskSelection } from './TaskSelectionContext';

// Auto-scroll configuration for drag operations
const SCROLL_THRESHOLD = 80; // Pixels from edge to start scrolling
const MAX_SCROLL_SPEED = 15; // Maximum scroll speed in pixels per frame

// Column configuration. Listed in display (left-to-right) order; `priority`
// (lower = more important) controls which columns survive the responsive
// greedy fit. defaultWidth/min/max drive both the fit math and resizing.
interface TaskColumn {
  key: string;
  priority: number;
  alwaysShow?: boolean;
  defaultWidth: number;
  minWidth: number;
  maxWidth: number;
  resizable: boolean;
  align: 'left' | 'right';
}

// Display order = importance/relevance (left to right). `priority` (lower =
// more important) controls which columns survive the responsive greedy fit.
const COLUMN_CONFIG: TaskColumn[] = [
  { key: 'drag',         priority: 0,  alwaysShow: true, defaultWidth: 64,  minWidth: 64,  maxWidth: 64,  resizable: false, align: 'left'  },
  { key: 'name',         priority: 1,  alwaysShow: true, defaultWidth: 340, minWidth: 220, maxWidth: 720, resizable: true,  align: 'left'  },
  { key: 'status',       priority: 3,                    defaultWidth: 150, minWidth: 110, maxWidth: 240, resizable: true,  align: 'left'  },
  { key: 'priority',     priority: 4,                    defaultWidth: 130, minWidth: 90,  maxWidth: 200, resizable: true,  align: 'left'  },
  { key: 'task_type',    priority: 5,                    defaultWidth: 140, minWidth: 100, maxWidth: 220, resizable: true,  align: 'left'  },
  { key: 'assignee',     priority: 6,                    defaultWidth: 240, minWidth: 150, maxWidth: 440, resizable: true,  align: 'left'  },
  { key: 'due_date',     priority: 7,                    defaultWidth: 150, minWidth: 110, maxWidth: 260, resizable: true,  align: 'left'  },
  { key: 'tags',         priority: 8,                    defaultWidth: 180, minWidth: 120, maxWidth: 360, resizable: true,  align: 'left'  },
  { key: 'est_hours',    priority: 9,                    defaultWidth: 110, minWidth: 80,  maxWidth: 200, resizable: true,  align: 'left'  },
  { key: 'actual_hours', priority: 10,                   defaultWidth: 120, minWidth: 90,  maxWidth: 200, resizable: true,  align: 'left'  },
  { key: 'checklist',    priority: 11,                   defaultWidth: 120, minWidth: 90,  maxWidth: 240, resizable: true,  align: 'left'  },
  { key: 'deps',         priority: 12,                   defaultWidth: 90,  minWidth: 70,  maxWidth: 220, resizable: true,  align: 'left'  },
  { key: 'attachments',  priority: 13,                   defaultWidth: 110, minWidth: 80,  maxWidth: 200, resizable: true,  align: 'left'  },
];

// Task-type icons keyed by type_key (mirrors the kanban board / cards).
const taskTypeIcons: Record<string, React.ComponentType<any>> = {
  task: ClipboardList,
  bug: Bug,
  feature: Sparkles,
  improvement: TrendingUp,
  epic: Flag,
  story: BookOpen,
};

// Click-to-edit hours cell: shows hours (stored value is in minutes); on click
// becomes a number input, committing on blur/Enter and cancelling on Escape.
function InlineHoursEdit({ minutes, onCommit }: { minutes: number | null; onCommit: (minutes: number | null) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const display = minutes != null ? (minutes / 60).toFixed(1) : '-';

  const begin = () => {
    setDraft(minutes != null ? String(Number((minutes / 60).toFixed(2))) : '');
    setEditing(true);
  };
  const commit = () => {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed === '') {
      if (minutes != null) onCommit(null);
      return;
    }
    const hours = Number(trimmed);
    if (!Number.isFinite(hours) || hours < 0) return;
    const nextMinutes = Math.round(hours * 60);
    if (nextMinutes !== minutes) onCommit(nextMinutes);
  };

  if (!editing) {
    return (
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); begin(); }}
        className="text-[13px] text-[rgb(var(--color-text-700))] hover:text-[rgb(var(--color-primary-700))] cursor-text text-left w-full"
        title="Click to edit"
      >
        {display}
      </button>
    );
  }
  return (
    <input
      type="number"
      min="0"
      step="0.5"
      autoFocus
      value={draft}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); commit(); }
        else if (e.key === 'Escape') { setEditing(false); }
      }}
      className="w-16 px-1 py-0.5 text-[13px] border border-[rgb(var(--color-border-300))] rounded bg-[rgb(var(--color-card))] text-[rgb(var(--color-text-900))] focus:outline-none focus:ring-1 focus:ring-primary-500"
    />
  );
}

// Progress bar component
function ProgressBar({ percentage }: { percentage: number }) {
  return (
    <div className="w-full bg-[rgb(var(--color-border-200))] rounded-full h-1.5 overflow-hidden">
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
  /**
   * Effective status mappings keyed by phase_id. Status mapping IDs are
   * phase-specific, so each phase must be bucketed by its own statuses. Falls
   * back to `statuses` for any phase not present in the map.
   */
  statusesByPhase?: Record<string, ProjectStatus[]>;
  /**
   * Persisted column widths (column key -> px). Server-backed via the parent's
   * user preferences, replacing the previous localStorage-only store. When
   * omitted, widths fall back to component-local state (not persisted).
   */
  columnWidths?: Record<string, number>;
  /** Persist a column-width change. Supports functional updates. */
  onColumnWidthsChange?: (
    value: Record<string, number> | ((prev: Record<string, number>) => Record<string, number>)
  ) => void;
  /** Row density (zoom): cell font size in px, applied to all cell text. */
  densityFontPx?: number;
  /** Row density (zoom): cell vertical padding (CSS length, e.g. "10px"). */
  densityCellPadding?: string;
  /** Column width multiplier for the zoom level — drives how many columns fit. */
  densityScale?: number;
  /** Tag size that scales with the zoom level. */
  tagSize?: 'sm' | 'md' | 'lg';
  /** Assignee picker size that scales with the zoom level. */
  pickerSize?: 'xs' | 'sm' | 'lg';
  /** Avatar size that scales with the zoom level. */
  avatarSize?: 'xs' | 'sm' | 'md';
  /** Priorities for resolving the Priority column (id -> name + color). */
  priorities?: (IPriority | IStandardPriority)[];
  /** Task types for resolving the Type column (type_key -> name + color). */
  taskTypes?: ITaskType[];
  /** Inline-edit handler. When provided, status/priority/type/due/hours cells
   *  become editable pickers/inputs that persist via a partial task update. */
  onTaskUpdate?: (taskId: string, updates: Partial<IProjectTask>) => void;
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
  onTeamAssign?: (taskId: string, teamId: string) => void | Promise<void>;
  teams?: import('@alga-psa/types').ITeam[];
  users: any[];
  teamNames?: Record<string, string>;
  teamAvatarUrls?: Record<string, string | null>;
  // Filter props
  selectedPriorityFilter?: string;
  selectedTaskTags?: string[];
  selectedAgentFilter?: string[];
  selectedTeamFilter?: string[];
  includeUnassignedAgents?: boolean;
  primaryAgentOnly?: boolean;
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
  statusesByPhase = {},
  columnWidths: columnWidthsProp,
  onColumnWidthsChange,
  densityFontPx = 13,
  densityCellPadding = '10px',
  densityScale = 1,
  tagSize = 'md',
  pickerSize = 'sm',
  avatarSize = 'xs',
  priorities = [],
  taskTypes = [],
  onTaskUpdate,
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
  onTeamAssign,
  teams = [],
  users,
  teamNames = {},
  teamAvatarUrls = {},
  selectedPriorityFilter = 'all',
  selectedTaskTags = [],
  selectedAgentFilter = [],
  selectedTeamFilter = [],
  includeUnassignedAgents = false,
  primaryAgentOnly = false,
  searchQuery = '',
  searchWholeWord = false,
  searchCaseSensitive = false
}: TaskListViewProps) {
  const { t } = useTranslation(['features/projects', 'common']);
  const { isSelected, toggleTask, setTasksSelected, selectedTaskIds } = useTaskSelection();
  const [expandedPhases, setExpandedPhases] = useState<Set<string>>(new Set());
  const [expandedStatuses, setExpandedStatuses] = useState<Set<string>>(new Set());
  const [expandedTitles, setExpandedTitles] = useState<Set<string>>(new Set());
  const [expandedDescriptions, setExpandedDescriptions] = useState<Set<string>>(new Set());
  const [avatarUrls, setAvatarUrls] = useState<Record<string, string | null>>({});

  // Memoize plain-text descriptions so JSON.parse runs at most once per task
  // per tasks-array change, instead of repeatedly during search, filter, and
  // per-row render passes.
  const taskDescriptionTextMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const task of tasks) {
      map.set(task.task_id, extractTaskDescriptionText(task.description_rich_text ?? task.description));
    }
    return map;
  }, [tasks]);

  // Auto-expand titles and descriptions when search matches
  useEffect(() => {
    if (!searchQuery.trim()) {
      setExpandedTitles(new Set());
      setExpandedDescriptions(new Set());
      return;
    }

    const newExpandedTitles = new Set<string>();
    const newExpandedDescriptions = new Set<string>();

    // Build regex for matching (same logic as filtering)
    const escapedQuery = searchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = searchWholeWord ? `\\b${escapedQuery}\\b` : escapedQuery;
    const regex = new RegExp(pattern, searchCaseSensitive ? '' : 'i');

    tasks.forEach(task => {
      const matchesName = regex.test(task.task_name);
      const descText = taskDescriptionTextMap.get(task.task_id) ?? '';
      const matchesDescription = descText ? regex.test(descText) : false;

      // Auto-expand title if it matches and is long enough to be truncated
      if (matchesName && task.task_name.length > 50) {
        newExpandedTitles.add(task.task_id);
      }

      // Auto-expand description if it matches (independent of title match)
      if (matchesDescription) {
        newExpandedDescriptions.add(task.task_id);
      }
    });

    setExpandedTitles(newExpandedTitles);
    setExpandedDescriptions(newExpandedDescriptions);
  }, [searchQuery, searchCaseSensitive, searchWholeWord, tasks, taskDescriptionTextMap]);

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

  // ----- Column visibility, sizing, and resizing -----
  // Ported from the shared DataTable: a greedy real-width fit (so far fewer
  // columns hide), a Show all / Show less toggle, and draggable resize handles
  // with widths persisted per project. Task-row drag-reordering is unaffected.
  const containerRef = useRef<HTMLDivElement>(null);

  // Column widths are server-persisted by the parent (via user preferences),
  // so they survive across devices and reloads. Fall back to local state when
  // no persistence handler is supplied.
  const [localColumnWidths, setLocalColumnWidths] = useState<Record<string, number>>({});
  const persistedColumnWidths = columnWidthsProp ?? localColumnWidths;
  const persistColumnWidths = onColumnWidthsChange ?? setLocalColumnWidths;

  // While a resize drag is in progress, keep the dragged column's width in
  // local state for smooth updates; persisting on every pointer move would
  // re-render the (large) parent each frame. The final width is persisted once
  // on pointer up.
  const [draftColumnWidth, setDraftColumnWidth] = useState<{ key: string; width: number } | null>(null);
  const columnWidths = useMemo(
    () => (draftColumnWidth
      ? { ...persistedColumnWidths, [draftColumnWidth.key]: draftColumnWidth.width }
      : persistedColumnWidths),
    [persistedColumnWidths, draftColumnWidth]
  );
  const [showAllColumns, setShowAllColumns] = useState(false);
  const [visibleColumnIds, setVisibleColumnIds] = useState<string[]>(
    () => COLUMN_CONFIG.map(c => c.key)
  );

  const getColumnWidth = useCallback((key: string): number => {
    const def = COLUMN_CONFIG.find(c => c.key === key);
    const base = columnWidths[key] ?? def?.defaultWidth ?? 120;
    if (!def) return base;
    return Math.min(def.maxWidth, Math.max(def.minWidth, base));
  }, [columnWidths]);

  // Column width scaled by the zoom level: wider columns at higher zoom mean
  // fewer fit (the greedy fit + colgroup both use this), so zoom changes the
  // number of columns shown — like the tickets table.
  const getScaledColumnWidth = useCallback(
    (key: string): number => Math.round(getColumnWidth(key) * densityScale),
    [getColumnWidth, densityScale]
  );

  // Greedy fit: always keep alwaysShow columns, then add optional columns by
  // priority using each column's real width until the next would overflow.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const recompute = () => {
      if (showAllColumns) {
        setVisibleColumnIds(COLUMN_CONFIG.map(c => c.key));
        return;
      }
      const budget = el.clientWidth - 16; // leave room for the vertical scrollbar
      const chosen = new Set<string>();
      let used = 0;
      for (const col of COLUMN_CONFIG.filter(c => c.alwaysShow)) {
        chosen.add(col.key);
        used += getScaledColumnWidth(col.key);
      }
      const optional = COLUMN_CONFIG
        .filter(c => !c.alwaysShow)
        .sort((a, b) => a.priority - b.priority);
      for (const col of optional) {
        const w = getScaledColumnWidth(col.key);
        if (used + w > budget) break;
        used += w;
        chosen.add(col.key);
      }
      setVisibleColumnIds(COLUMN_CONFIG.filter(c => chosen.has(c.key)).map(c => c.key));
    };

    recompute();
    const ro = new ResizeObserver(recompute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [showAllColumns, getScaledColumnWidth]);

  const visibleColumns = useMemo(
    () => COLUMN_CONFIG.filter(c => visibleColumnIds.includes(c.key)),
    [visibleColumnIds]
  );
  const hiddenColumnCount = COLUMN_CONFIG.length - visibleColumnIds.length;
  const totalColumnsWidth = useMemo(
    () => visibleColumns.reduce((sum, col) => sum + getScaledColumnWidth(col.key), 0),
    [visibleColumns, getScaledColumnWidth]
  );

  // Column resize via pointer drag on the header handles.
  const resizeStateRef = useRef<{ key: string; startX: number; startWidth: number; min: number; max: number; lastWidth: number } | null>(null);
  const handleResizeMove = useCallback((e: PointerEvent) => {
    const state = resizeStateRef.current;
    if (!state) return;
    const next = Math.min(state.max, Math.max(state.min, state.startWidth + (e.clientX - state.startX)));
    state.lastWidth = next;
    // Only the local draft updates during the drag; persistence happens on end.
    setDraftColumnWidth(prev => (prev && prev.key === state.key && prev.width === next ? prev : { key: state.key, width: next }));
  }, []);
  const handleResizeEnd = useCallback(() => {
    const state = resizeStateRef.current;
    resizeStateRef.current = null;
    if (state) {
      persistColumnWidths(prev => (prev[state.key] === state.lastWidth ? prev : { ...prev, [state.key]: state.lastWidth }));
    }
    setDraftColumnWidth(null);
    window.removeEventListener('pointermove', handleResizeMove);
    window.removeEventListener('pointerup', handleResizeEnd);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }, [handleResizeMove, persistColumnWidths]);
  const handleResizeStart = useCallback((e: React.PointerEvent, col: TaskColumn) => {
    e.preventDefault();
    e.stopPropagation();
    const startWidth = getColumnWidth(col.key);
    resizeStateRef.current = {
      key: col.key,
      startX: e.clientX,
      startWidth,
      min: col.minWidth,
      max: col.maxWidth,
      lastWidth: startWidth,
    };
    window.addEventListener('pointermove', handleResizeMove);
    window.addEventListener('pointerup', handleResizeEnd);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [getColumnWidth, handleResizeMove, handleResizeEnd]);
  const handleResizeReset = useCallback((key: string) => {
    persistColumnWidths(prev => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, [persistColumnWidths]);
  useEffect(() => () => {
    window.removeEventListener('pointermove', handleResizeMove);
    window.removeEventListener('pointerup', handleResizeEnd);
  }, [handleResizeMove, handleResizeEnd]);

  const columnLabels = useMemo<Record<string, string>>(() => ({
    drag: '',
    name: t('tasks.taskName', 'Name'),
    status: t('projectList.columns.status', 'Status'),
    priority: t('projectList.columns.priority', 'Priority'),
    task_type: t('projectList.columns.taskType', 'Type'),
    deps: t('tasks.dependencies', 'Deps'),
    checklist: t('tasks.checklist', 'Checklist'),
    tags: t('projectList.columns.tags', 'Tags'),
    assignee: t('tasks.assignee', 'Assignee'),
    est_hours: t('tasks.estHours', 'Est. Hours'),
    actual_hours: t('tasks.actualHours', 'Actual Hours'),
    due_date: t('tasks.dueDate', 'Due Date'),
    attachments: t('tasks.attachments', 'Attachments'),
  }), [t]);

  // Lookups for the Priority and Type columns.
  const priorityById = useMemo(() => {
    const map = new Map<string, IPriority | IStandardPriority>();
    for (const p of priorities) {
      if (p.priority_id) map.set(p.priority_id, p);
    }
    return map;
  }, [priorities]);
  const taskTypeByKey = useMemo(() => {
    const map = new Map<string, ITaskType>();
    for (const tt of taskTypes) {
      if (tt.type_key) map.set(tt.type_key, tt);
    }
    return map;
  }, [taskTypes]);

  const renderColgroup = () => (
    <colgroup>
      {visibleColumns.map(col => (
        <col key={col.key} style={{ width: `${getScaledColumnWidth(col.key)}px` }} />
      ))}
    </colgroup>
  );

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
        const descText = taskDescriptionTextMap.get(task.task_id) ?? '';
        const taskDescription = searchCaseSensitive
          ? descText
          : descText.toLowerCase();

        if (searchWholeWord) {
          // Use word boundary regex for whole word matching
          const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const wordRegex = new RegExp(`\\b${escapedQuery}\\b`, searchCaseSensitive ? '' : 'i');
          return wordRegex.test(task.task_name) || wordRegex.test(descText);
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

    // Apply agent / team filter
    if (selectedAgentFilter.length > 0 || selectedTeamFilter.length > 0 || includeUnassignedAgents) {
      filtered = filtered.filter(task => {
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
            const resources = taskResources[task.task_id] || [];
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

    return filtered;
  }, [tasks, searchQuery, searchWholeWord, searchCaseSensitive, selectedPriorityFilter, selectedTaskTags, taskTags, selectedAgentFilter, selectedTeamFilter, includeUnassignedAgents, primaryAgentOnly, taskResources, taskDescriptionTextMap]);

  // Group tasks by phase and status - include ALL phases and ALL statuses for drag-and-drop
  const phaseGroups = useMemo((): PhaseGroup[] => {
    const groups: PhaseGroup[] = [];

    // Match the Kanban phase sidebar ordering (see ProjectPhases): sort by
    // order_key (fractional index), falling back to end_date when absent.
    const sortedPhases = [...phases].sort((a, b) => {
      if (a.order_key || b.order_key) {
        const aKey = a.order_key || 'zzz';
        const bKey = b.order_key || 'zzz';
        return aKey < bKey ? -1 : aKey > bKey ? 1 : 0;
      }
      const aDate = a.end_date ? new Date(a.end_date).getTime() : Infinity;
      const bDate = b.end_date ? new Date(b.end_date).getTime() : Infinity;
      return aDate - bDate;
    });

    sortedPhases.forEach(phase => {
      const phaseTasks = filteredTasks.filter(task => task.phase_id === phase.phase_id);

      // Status mapping IDs are phase-specific, so bucket each phase's tasks by
      // that phase's own statuses (falling back to the shared list).
      const phaseStatuses = statusesByPhase[phase.phase_id] ?? statuses;
      const closedStatusIds = new Set(
        phaseStatuses.filter(s => s.is_closed).map(s => s.project_status_mapping_id)
      );

      // Include ALL statuses for each phase (even empty ones) to enable drag-and-drop
      const statusGroups: { status: ProjectStatus; tasks: IProjectTask[] }[] = phaseStatuses.map(status => {
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
  }, [phases, filteredTasks, statuses, statusesByPhase]);

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
    if (!userId) return t('projectList.unassigned', 'Unassigned');
    const user = users.find(u => u.user_id === userId);
    return user ? `${user.first_name} ${user.last_name}` : t('projectDetail.unknownUser', 'Unknown');
  };

  // Helper to get dependency type info (label and icon)
  const getDependencyTypeInfo = (type: string): { label: string; icon: React.ReactNode; color: string } => {
    switch (type) {
      case 'blocks':
        return { label: t('taskDependencies.blocks', 'Blocks'), icon: <Ban className="h-3 w-3" />, color: 'text-destructive' };
      case 'blocked_by':
        return { label: t('taskDependencies.blockedBy', 'Blocked by'), icon: <Ban className="h-3 w-3" />, color: 'text-orange-500' };
      case 'related_to':
        return { label: t('taskDependencies.relatedTo', 'Related to'), icon: <GitBranch className="h-3 w-3" />, color: 'text-blue-500' };
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
            <div className="font-medium text-gray-300 mb-1">{t('taskDependencies.dependsOn', 'Depends on:')}</div>
            {deps.predecessors.map((d, i) => {
              const info = getDependencyTypeInfo(d.dependency_type);
              return (
                <div key={i} className="flex items-center gap-1.5 ml-2">
                  <span className={info.color}>{info.icon}</span>
                  <span>{d.predecessor_task?.task_name || t('taskDependencies.unknownTask', 'Unknown task')}</span>
                  <span className="text-gray-400">({info.label})</span>
                </div>
              );
            })}
          </div>
        )}
        {deps.successors.length > 0 && (
          <div>
            <div className="font-medium text-gray-300 mb-1">{t('projectDetail.blocksLabel', 'Blocks:')}</div>
            {deps.successors.map((d, i) => {
              const info = getDependencyTypeInfo(d.dependency_type);
              return (
                <div key={i} className="flex items-center gap-1.5 ml-2">
                  <span className={info.color}>{info.icon}</span>
                  <span>{d.successor_task?.task_name || t('taskDependencies.unknownTask', 'Unknown task')}</span>
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
      return <Ban className="h-3.5 w-3.5 text-destructive" />;
    }

    return <GitBranch className="h-3.5 w-3.5 text-blue-500" />;
  };

  // Drag and drop handlers
  const handleDragStart = useCallback((e: React.DragEvent<HTMLTableRowElement>, task: IProjectTask) => {
    setDraggedTask(task);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', task.task_id);
    // Add a visual cue that we're dragging
    const isBulkDrag = selectedTaskIds.has(task.task_id) && selectedTaskIds.size > 1;
    if (isBulkDrag) {
      // Dim every selected row so it's clear they all move together
      document.querySelectorAll('[data-task-row-id]').forEach((el) => {
        const id = el.getAttribute('data-task-row-id');
        if (id && selectedTaskIds.has(id)) {
          (el as HTMLElement).style.opacity = '0.5';
        }
      });
    } else if (e.currentTarget) {
      e.currentTarget.style.opacity = '0.5';
    }
  }, [selectedTaskIds]);

  const handleDragEnd = useCallback((e: React.DragEvent<HTMLTableRowElement>) => {
    setDraggedTask(null);
    setDragOverStatus(null);
    setDragOverPhase(null);
    setDropIndicatorIndex(null);
    if (e.currentTarget) {
      e.currentTarget.style.opacity = '1';
    }
    document.querySelectorAll('[data-task-row-id]').forEach((el) => {
      (el as HTMLElement).style.opacity = '1';
    });
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
  const visibleColumnCount = visibleColumns.length;

  const printRows = useMemo(() => {
    const rows = phaseGroups.flatMap((phaseGroup) =>
      phaseGroup.statusGroups.flatMap((statusGroup) =>
        statusGroup.tasks.map((task) => ({
          task,
          phaseName: phaseGroup.phase.phase_name,
          statusName: statusGroup.status.custom_name || statusGroup.status.name,
        }))
      )
    );
    // When tasks are selected, scope the print to just those
    if (selectedTaskIds.size > 0) {
      return rows.filter((row) => selectedTaskIds.has(row.task.task_id));
    }
    return rows;
  }, [phaseGroups, selectedTaskIds]);

  const printColumns = useMemo<PrintColumnOption<typeof printRows[number]>[]>(() => [
    {
      key: 'task',
      label: t('tasks.taskName', 'Name'),
      header: t('tasks.taskName', 'Name'),
      render: ({ task }) => task.task_name,
    },
    {
      key: 'phase',
      label: t('projectPrint.tasks.columns.phase', 'Phase'),
      header: t('projectPrint.tasks.columns.phase', 'Phase'),
      render: ({ phaseName }) => phaseName,
    },
    {
      key: 'status',
      label: t('projectPrint.tasks.columns.status', 'Status'),
      header: t('projectPrint.tasks.columns.status', 'Status'),
      render: ({ statusName }) => statusName,
    },
    {
      key: 'deps',
      label: t('tasks.dependencies', 'Deps'),
      header: t('tasks.dependencies', 'Deps'),
      render: ({ task }) => {
        const deps = taskDependencies[task.task_id];
        const dependencyCount = (deps?.predecessors.length ?? 0) + (deps?.successors.length ?? 0);
        return dependencyCount > 0 ? String(dependencyCount) : t('projectPrint.tasks.emptyValue', '-');
      },
    },
    {
      key: 'checklist',
      label: t('tasks.checklist', 'Checklist'),
      header: t('tasks.checklist', 'Checklist'),
      render: ({ task }) => {
        const checklist = checklistItems[task.task_id];
        return checklist && checklist.total > 0
          ? t('projectDetail.checklistSummary', '{{completed}} of {{total}} complete', {
              completed: checklist.completed,
              total: checklist.total,
            })
          : t('projectPrint.tasks.emptyValue', '-');
      },
    },
    {
      key: 'tags',
      label: t('projectList.columns.tags', 'Tags'),
      header: t('projectList.columns.tags', 'Tags'),
      render: ({ task }) => {
        const tags = taskTags[task.task_id] ?? [];
        return tags.length > 0
          ? tags.map((tag) => tag.tag_text).join(', ')
          : t('projectPrint.tasks.emptyValue', '-');
      },
    },
    {
      key: 'assignee',
      label: t('tasks.assignee', 'Assignee'),
      header: t('tasks.assignee', 'Assignee'),
      render: ({ task }) => {
        const primary = task.assigned_team_id && teamNames[task.assigned_team_id]
          ? teamNames[task.assigned_team_id]
          : getAssigneeName(task.assigned_to);
        const additionalAssignees = (taskResources[task.task_id] ?? [])
          .map((resource) => getAssigneeName(resource.additional_user_id))
          .filter(Boolean);
        return additionalAssignees.length > 0
          ? `${primary}; +${additionalAssignees.length}: ${additionalAssignees.join(', ')}`
          : primary;
      },
    },
    {
      key: 'est_hours',
      label: t('tasks.estHours', 'Est. Hours'),
      header: t('tasks.estHours', 'Est. Hours'),
      render: ({ task }) => task.estimated_hours != null
        ? (task.estimated_hours / 60).toFixed(1)
        : t('projectPrint.tasks.emptyValue', '-'),
    },
    {
      key: 'actual_hours',
      label: t('tasks.actualHours', 'Actual Hours'),
      header: t('tasks.actualHours', 'Actual Hours'),
      render: ({ task }) => task.actual_hours != null
        ? (task.actual_hours / 60).toFixed(1)
        : t('projectPrint.tasks.emptyValue', '-'),
    },
    {
      key: 'dueDate',
      label: t('tasks.dueDate', 'Due Date'),
      header: t('tasks.dueDate', 'Due Date'),
      render: ({ task }) => task.due_date
        ? format(new Date(task.due_date), 'PP')
        : t('projectPrint.tasks.emptyValue', '-'),
    },
    {
      key: 'attachments',
      label: t('tasks.attachments', 'Attachments'),
      header: t('tasks.attachments', 'Attachments'),
      render: ({ task }) => documentCounts[task.task_id] || t('projectPrint.tasks.emptyValue', '-'),
    },
  ], [checklistItems, documentCounts, getAssigneeName, t, taskDependencies, taskResources, taskTags, teamNames]);
  const {
    selectedColumnKeys: selectedTaskPrintColumnKeys,
    selectedColumns: selectedTaskPrintColumns,
    setSelectedColumnKeys: setSelectedTaskPrintColumnKeys,
    resetSelectedColumnKeys: resetSelectedTaskPrintColumnKeys,
  } = usePrintColumnSelection('print-columns:project-tasks-list', printColumns);

  const [isPrintOptionsOpen, setIsPrintOptionsOpen] = useState(false);

  const { triggerPrint: triggerPrintTasks, isPreparing: isPreparingTaskPrint } = usePrintAction();

  const shareRegistration = useMemo(() => ({
    triggerPrint: triggerPrintTasks,
    openPrintOptions: () => setIsPrintOptionsOpen(true),
    isPrinting: isPreparingTaskPrint,
  }), [triggerPrintTasks, isPreparingTaskPrint]);
  useRegisterTaskShareActions(shareRegistration);

  return (
    <div
      ref={containerRef}
      className="project-task-list-density flex flex-col bg-[rgb(var(--color-card))] border border-[rgb(var(--color-border-200))] rounded-xl shadow-sm overflow-hidden h-[calc(100vh-220px)] min-h-[400px]"
      style={{ ['--tl-font' as string]: `${densityFontPx}px`, ['--tl-cell-pad' as string]: densityCellPadding }}
    >
      {/*
        Zoom (density) scaling. Driven by CSS variables set above so the row +
        phase/status header cells scale their padding and text together. Uses
        `!important` to override the per-cell Tailwind font sizes. Column-header
        `th` cells are intentionally excluded (they keep their label size).
      */}
      <style>{`
        .project-task-list-density td {
          padding-top: var(--tl-cell-pad) !important;
          padding-bottom: var(--tl-cell-pad) !important;
          font-size: var(--tl-font) !important;
        }
        .project-task-list-density td * {
          font-size: var(--tl-font) !important;
        }
      `}</style>
      <div className="app-print-root app-print-only">
        <PrintableTable
          title={t('projectPrint.tasks.title', 'Project Tasks')}
          subtitle={
            selectedTaskIds.size > 0
              ? t('projectPrint.tasks.subtitleSelected', '{{count}} selected tasks', {
                  count: printRows.length,
                })
              : t('projectPrint.tasks.subtitle', '{{count}} tasks', {
                  count: printRows.length,
                })
          }
          rows={printRows}
          columns={selectedTaskPrintColumns}
          getRowKey={({ task }) => task.task_id}
          emptyMessage={t('projectPrint.tasks.noTasks', 'No project tasks to print')}
        />
      </div>
      <PrintOptionsDialog
        id="project-tasks-print-options-dialog"
        open={isPrintOptionsOpen}
        onOpenChange={setIsPrintOptionsOpen}
        title={t('projectPrint.tasks.optionsDialog.title', 'Print options')}
        description={t('projectPrint.tasks.optionsDialog.description', 'Choose which columns to include when printing project tasks.')}
        columns={printColumns}
        selectedColumnKeys={selectedTaskPrintColumnKeys}
        onSelectedColumnKeysChange={setSelectedTaskPrintColumnKeys}
        onReset={resetSelectedTaskPrintColumnKeys}
        onPrint={() => triggerPrintTasks()}
        isPrinting={isPreparingTaskPrint}
      />
      {/* Hidden columns alert + Show all / Show less toggle */}
      {showAllColumns ? (
        <Alert variant="info" className="rounded-none border-x-0 border-t-0">
          <AlertDescription className="flex items-center text-sm">
            <Zap className="h-4 w-4 mr-1" />
            {t('common:dataTable.showingAllColumns', 'Showing all columns; scroll horizontally to see them.')}{' '}
            <button
              type="button"
              onClick={() => setShowAllColumns(false)}
              className="ml-1 font-medium text-[rgb(var(--color-primary-600))] underline underline-offset-2 hover:opacity-80 focus:outline-none"
            >
              {t('common:dataTable.showLess', 'Show less')}
            </button>
          </AlertDescription>
        </Alert>
      ) : hiddenColumnCount > 0 && (
        <Alert variant="info" className="rounded-none border-x-0 border-t-0">
          <AlertDescription className="flex items-center text-sm">
            <Zap className="h-4 w-4 mr-1" />
            {t('common:dataTable.columnsHidden', {
              count: hiddenColumnCount,
              defaultValue: '{{count}} columns hidden due to limited space.',
            })}{' '}
            <button
              type="button"
              onClick={() => setShowAllColumns(true)}
              className="ml-1 font-medium text-[rgb(var(--color-primary-600))] underline underline-offset-2 hover:opacity-80 focus:outline-none"
            >
              {t('common:dataTable.showAll', 'Show all')}
            </button>
          </AlertDescription>
        </Alert>
      )}
      {/* Horizontal-scroll wrapper keeps the sticky header and body columns
          aligned, and lets the table scroll sideways when all columns show. */}
      <div className="flex-1 min-h-0 overflow-x-auto">
        <div className="flex h-full flex-col" style={{ width: `${totalColumnsWidth}px`, minWidth: '100%' }}>
          {/* Column headers - sticky */}
          <div className="bg-[rgb(var(--color-border-50)/0.55)] border-b border-[rgb(var(--color-border-100)/0.82)] flex-shrink-0">
            <table className="w-full table-fixed">
              {renderColgroup()}
              <thead>
                <tr>
                  {visibleColumns.map((col, index) => {
                    const isLastColumn = index === visibleColumns.length - 1;
                    const label = columnLabels[col.key] ?? '';
                    const alignClass = col.align === 'right' ? 'text-right' : 'text-left';
                    return (
                      <th
                        key={col.key}
                        className={`group relative px-3 py-2 text-[12px] font-medium text-[rgb(var(--color-text-500))] whitespace-nowrap ${alignClass} ${index === 0 ? 'pl-4' : ''} ${isLastColumn ? '' : 'border-r border-[rgb(var(--color-border-100)/0.82)]'}`}
                      >
                        {label}
                        {col.resizable && !isLastColumn && (
                          <div
                            role="separator"
                            aria-orientation="vertical"
                            aria-label={`Resize ${label} column`}
                            onPointerDown={(e) => handleResizeStart(e, col)}
                            onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
                            onDoubleClick={(e) => { e.preventDefault(); e.stopPropagation(); handleResizeReset(col.key); }}
                            className="absolute -right-1 top-0 z-10 h-full w-2 cursor-col-resize touch-none select-none after:absolute after:right-1 after:top-1 after:h-[calc(100%-0.5rem)] after:w-px after:rounded-full after:bg-transparent after:transition-colors hover:after:bg-[rgb(var(--color-primary-400))] group-hover:after:bg-[rgb(var(--color-border-300)/0.9)]"
                          />
                        )}
                      </th>
                    );
                  })}
                </tr>
              </thead>
            </table>
          </div>

      {/* Hierarchical rows - scrollable */}
      <div ref={scrollContainerRef} className="divide-y divide-[rgb(var(--color-border-100)/0.72)] overflow-y-auto flex-1 min-h-0">
        {/* Empty state - inside scrollable area for proper centering */}
        {phaseGroups.length === 0 && (
          <div className="flex items-center justify-center h-full text-[rgb(var(--color-text-500))]">
            <div className="text-center">
              <p className="text-base font-medium">{t('phases.noPhases', 'No phases to display')}</p>
              <p className="text-sm mt-1">{t('projectDetail.listViewEmptyMessage', 'Create phases and add tasks to see them here')}</p>
              {onAddPhase && (
                <Button
                  id="add-phase-empty-state"
                  variant="default"
                  size="sm"
                  className="mt-4"
                  onClick={onAddPhase}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  {t('projectPhases.addPhase', 'Add Phase')}
                </Button>
              )}
            </div>
          </div>
        )}

        {phaseGroups.map(phaseGroup => {
          const isPhaseExpanded = expandedPhases.has(phaseGroup.phase.phase_id);

          return (
            <div key={phaseGroup.phase.phase_id}>
              <table className="w-full table-fixed">
                {renderColgroup()}

                {/* Phase header row */}
                <thead>
                  <tr
                    className="bg-[rgb(var(--color-card))] hover:bg-[rgb(var(--color-border-50)/0.82)] cursor-pointer transition-colors"
                    onClick={() => togglePhase(phaseGroup.phase.phase_id)}
                  >
                    <td className="py-3" colSpan={visibleColumnCount}>
                      <div className="flex items-start gap-2 px-3">
                        <div className="pt-1 text-[rgb(var(--color-text-400))]">
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
                                <h4 className="font-semibold text-[rgb(var(--color-text-900))]">{phaseGroup.phase.phase_name}</h4>
                                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-700">
                                  {phaseGroup.totalTasks} {t(phaseGroup.totalTasks === 1 ? 'task' : 'tasks.title', phaseGroup.totalTasks === 1 ? 'task' : 'tasks')}
                                </span>
                              </div>

                              {/* Phase description */}
                              {phaseGroup.phase.description && (
                                <p className="text-sm text-[rgb(var(--color-text-600))] mt-1">{phaseGroup.phase.description}</p>
                              )}

                              {/* Phase dates */}
                              {(phaseGroup.phase.start_date || phaseGroup.phase.end_date) && (
                                <div className="flex items-center gap-4 mt-2 text-sm text-[rgb(var(--color-text-500))]">
                                  {phaseGroup.phase.start_date && (
                                    <span className="flex items-center gap-1">
                                      <Calendar className="w-3.5 h-3.5" />
                                      {t('startDate', 'Start Date')}: {format(new Date(phaseGroup.phase.start_date), 'PP')}
                                    </span>
                                  )}
                                  {phaseGroup.phase.end_date && (
                                    <span className="flex items-center gap-1">
                                      <Calendar className="w-3.5 h-3.5" />
                                      {t('endDate', 'End Date')}: {format(new Date(phaseGroup.phase.end_date), 'PP')}
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
                                  <div className="text-xs text-[rgb(var(--color-text-500))]">
                                    {t('phases.completion', 'Complete')}
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
                                  {t('projectPhases.addTask', 'Add Task')}
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
                  <tbody className="divide-y divide-[rgb(var(--color-border-100)/0.72)]">
                    {phaseGroup.statusGroups.map(statusGroup => {
                      const statusKey = `${phaseGroup.phase.phase_id}:${statusGroup.status.project_status_mapping_id}`;
                      const isStatusExpanded = expandedStatuses.has(statusKey);
                      const statusTaskIds = statusGroup.tasks.map(t => t.task_id);
                      const allStatusSelected = statusTaskIds.length > 0 && statusTaskIds.every(id => isSelected(id));
                      const someStatusSelected = statusTaskIds.some(id => isSelected(id));
                      const isDropTarget = draggedTask &&
                        dragOverStatus === statusGroup.status.project_status_mapping_id &&
                        dragOverPhase === phaseGroup.phase.phase_id;

                      return (
                        <React.Fragment key={statusKey}>
                          {/* Status header row - also serves as drop zone for empty statuses */}
                          <tr
                            className={`bg-[rgb(var(--color-border-50)/0.7)] hover:bg-[rgb(var(--color-border-100)/0.55)] cursor-pointer transition-colors ${
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
                                  <ChevronDown className="h-3.5 w-3.5 text-[rgb(var(--color-text-400))]" />
                                ) : (
                                  <ChevronRight className="h-3.5 w-3.5 text-[rgb(var(--color-text-400))]" />
                                )}
                                {statusTaskIds.length > 0 && (
                                  <div onClick={(e) => e.stopPropagation()}>
                                    <Checkbox
                                      id={`select-status-${statusKey}`}
                                      checked={allStatusSelected}
                                      indeterminate={someStatusSelected && !allStatusSelected}
                                      onChange={() => setTasksSelected(statusTaskIds, !allStatusSelected)}
                                      size="sm"
                                      containerClassName="mb-0"
                                      skipRegistration
                                    />
                                  </div>
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
                                <span className="text-xs text-[rgb(var(--color-text-500))]">
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
                            const descText = taskDescriptionTextMap.get(task.task_id) ?? '';
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
                                data-task-row-id={task.task_id}
                                className={`bg-[rgb(var(--color-card))] hover:bg-[rgb(var(--color-border-50)/0.82)] group transition-colors ${
                                  isDragging ? 'opacity-50' : ''
                                } ${showDropIndicator ? 'bg-primary-50' : ''}`}
                                draggable={!!onTaskMove}
                                onDragStart={(e) => handleDragStart(e, task)}
                                onDragEnd={handleDragEnd}
                                onDragOver={(e) => handleDragOver(e, statusGroup.status.project_status_mapping_id, phaseGroup.phase.phase_id, taskIndex)}
                                onDragLeave={handleDragLeave}
                                onDrop={(e) => handleDrop(e, statusGroup.status.project_status_mapping_id, phaseGroup.phase.phase_id, statusGroup.tasks, taskIndex)}
                              >
                                {visibleColumns.map((col, colIndex) => {
                                  const isLastCol = colIndex === visibleColumns.length - 1;
                                  const tdBorder = isLastCol ? '' : 'border-r border-[rgb(var(--color-border-100)/0.72)]';
                                  switch (col.key) {
                                    case 'drag':
                                      return (
                                        <td key="drag" className={`py-2.5 px-3 align-middle ${tdBorder}`}>
                                          <div className="flex items-center gap-1">
                                            <div onClick={(e) => e.stopPropagation()}>
                                              <Checkbox
                                                id={`select-task-${task.task_id}`}
                                                checked={isSelected(task.task_id)}
                                                onChange={() => toggleTask(task.task_id)}
                                                size="sm"
                                                containerClassName="mb-0"
                                                skipRegistration
                                              />
                                            </div>
                                            {onTaskMove && (
                                              <GripVertical className="h-4 w-4 text-[rgb(var(--color-text-400))] cursor-grab opacity-0 group-hover:opacity-100 transition-opacity" />
                                            )}
                                          </div>
                                        </td>
                                      );
                                    case 'name':
                                      return (
                                        <td key="name" className={`py-2.5 px-4 align-middle ${tdBorder}`}>
                                          <div className="min-w-0">
                                            <div>
                                              <button
                                                type="button"
                                                className={`text-[13px] font-medium text-[rgb(var(--color-text-900))] hover:text-[rgb(var(--color-primary-700))] hover:underline cursor-pointer text-left max-w-full block ${!expandedTitles.has(task.task_id) ? 'truncate' : ''}`}
                                                onClick={() => onTaskClick(task)}
                                                title={!expandedTitles.has(task.task_id) ? task.task_name : undefined}
                                              >
                                                {highlightSearchMatch(task.task_name, searchQuery, searchCaseSensitive, searchWholeWord)}
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
                                                  {expandedTitles.has(task.task_id)
                                                    ? t('projectDetail.seeLess', 'See less')
                                                    : t('projectDetail.seeMore', 'See more')}
                                                </button>
                                              )}
                                            </div>
                                            {descText && (
                                              <div className="mt-0.5">
                                                <p
                                                  className={`text-xs text-[rgb(var(--color-text-500))] ${!expandedDescriptions.has(task.task_id) ? 'line-clamp-1' : ''}`}
                                                  title={!expandedDescriptions.has(task.task_id) ? descText : undefined}
                                                >
                                                  {highlightSearchMatch(descText, searchQuery, searchCaseSensitive, searchWholeWord)}
                                                </p>
                                                {descText.length > 80 && (
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
                                                    {expandedDescriptions.has(task.task_id)
                                                      ? t('projectDetail.seeLess', 'See less')
                                                      : t('projectDetail.seeMore', 'See more')}
                                                  </button>
                                                )}
                                              </div>
                                            )}
                                          </div>
                                        </td>
                                      );
                                    case 'status': {
                                      const status = statusGroup.status;
                                      const statusColor = status.color || '#6B7280';
                                      if (onTaskUpdate) {
                                        const phaseStatusOptions = phaseGroup.statusGroups.map(sg => sg.status);
                                        return (
                                          <td key="status" className={`py-2.5 px-3 align-middle ${tdBorder}`} onClick={(e) => e.stopPropagation()}>
                                            <TaskStatusSelect
                                              value={task.project_status_mapping_id}
                                              statuses={phaseStatusOptions}
                                              onValueChange={(statusId) => onTaskUpdate(task.task_id, { project_status_mapping_id: statusId })}
                                            />
                                          </td>
                                        );
                                      }
                                      return (
                                        <td key="status" className={`py-2.5 px-3 align-middle ${tdBorder}`}>
                                          <span
                                            className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium max-w-full"
                                            style={{
                                              backgroundColor: `${statusColor}20`,
                                              color: statusColor,
                                              border: `1px solid ${statusColor}40`,
                                            }}
                                          >
                                            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: statusColor }} />
                                            <span className="truncate">{status.custom_name || status.name}</span>
                                          </span>
                                        </td>
                                      );
                                    }
                                    case 'priority': {
                                      const taskPriority = task.priority_id ? priorityById.get(task.priority_id) : null;
                                      if (onTaskUpdate) {
                                        const priorityOptions = priorities.map(p => ({
                                          value: p.priority_id,
                                          label: p.priority_name,
                                          color: p.color,
                                        }));
                                        return (
                                          <td key="priority" className={`py-2.5 px-3 align-middle ${tdBorder}`} onClick={(e) => e.stopPropagation()}>
                                            <PrioritySelect
                                              value={task.priority_id ?? null}
                                              options={priorityOptions}
                                              onValueChange={(value) => onTaskUpdate(task.task_id, { priority_id: value || null })}
                                              placeholder={t('projectList.columns.priority', 'Priority')}
                                            />
                                          </td>
                                        );
                                      }
                                      return (
                                        <td key="priority" className={`py-2.5 px-3 align-middle ${tdBorder}`}>
                                          {taskPriority ? (
                                            <div className="flex items-center gap-1.5">
                                              <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: taskPriority.color || '#6B7280' }} />
                                              <span className="text-[13px] text-[rgb(var(--color-text-700))] truncate">{taskPriority.priority_name}</span>
                                            </div>
                                          ) : (
                                            <span className="text-[13px] text-[rgb(var(--color-text-400))]">—</span>
                                          )}
                                        </td>
                                      );
                                    }
                                    case 'task_type': {
                                      const taskType = taskTypeByKey.get(task.task_type_key);
                                      const TaskTypeIcon = taskTypeIcons[task.task_type_key] || ClipboardList;
                                      if (onTaskUpdate && taskTypes.length > 0) {
                                        return (
                                          <td key="task_type" className={`py-2.5 px-3 align-middle ${tdBorder}`} onClick={(e) => e.stopPropagation()}>
                                            <TaskTypeSelector
                                              value={task.task_type_key}
                                              taskTypes={taskTypes}
                                              onChange={(typeKey) => onTaskUpdate(task.task_id, { task_type_key: typeKey })}
                                            />
                                          </td>
                                        );
                                      }
                                      return (
                                        <td key="task_type" className={`py-2.5 px-3 align-middle ${tdBorder}`}>
                                          <div className="flex items-center gap-1.5">
                                            <TaskTypeIcon className="h-3.5 w-3.5 shrink-0" style={{ color: taskType?.color || '#6B7280' }} />
                                            <span className="text-[13px] text-[rgb(var(--color-text-700))] truncate">{taskType?.type_name || task.task_type_key}</span>
                                          </div>
                                        </td>
                                      );
                                    }
                                    case 'assignee':
                                      return (
                                        <td key="assignee" className={`py-2.5 px-3 align-middle ${tdBorder}`} onClick={(e) => e.stopPropagation()}>
                                          <div className="flex items-center gap-1.5">
                                            {onAssigneeChange ? (
                                              <UserAndTeamPicker
                                                value={task.assigned_to || ''}
                                                onValueChange={(newAssigneeId) => onAssigneeChange(task.task_id, newAssigneeId)}
                                                onTeamSelect={onTeamAssign ? (teamId) => onTeamAssign(task.task_id, teamId) : undefined}
                                                size={pickerSize}
                                                users={users.filter(u =>
                                                  !resources.some(r => r.additional_user_id === u.user_id)
                                                )}
                                                teams={teams}
                                                getUserAvatarUrlsBatch={getUserAvatarUrlsBatchAction}
                                                getTeamAvatarUrlsBatch={getTeamAvatarUrlsBatchAction}
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
                                                        size={avatarSize}
                                                      />
                                                      <span className="text-[13px] text-[rgb(var(--color-text-700))] truncate">
                                                        {user.first_name} {user.last_name}
                                                      </span>
                                                    </>
                                                  );
                                                }
                                                return (
                                                  <span className="text-[13px] text-[rgb(var(--color-text-400))]">{t('projectList.unassigned', 'Unassigned')}</span>
                                                );
                                              })()
                                            )}
                                            {task.assigned_team_id && teamNames[task.assigned_team_id] && (
                                              <Tooltip content={teamNames[task.assigned_team_id]}>
                                                <span className="inline-flex items-center cursor-help">
                                                  <TeamAvatar
                                                    teamId={task.assigned_team_id}
                                                    teamName={teamNames[task.assigned_team_id]}
                                                    avatarUrl={teamAvatarUrls[task.assigned_team_id] ?? null}
                                                    size={avatarSize}
                                                  />
                                                </span>
                                              </Tooltip>
                                            )}
                                            {additionalCount > 0 && (
                                              <Tooltip
                                                content={
                                                  <div className="text-xs space-y-1.5">
                                                    <div className="font-medium text-gray-300 mb-1">{t('taskForm.additionalAgentsLabel', 'Additional Agents')}:</div>
                                                    {resources.map((resource, i) => {
                                                      const resourceUser = users.find(u => u.user_id === resource.additional_user_id);
                                                      const userName = resourceUser ? `${resourceUser.first_name} ${resourceUser.last_name}` : t('projectDetail.unknownUser', 'Unknown');
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
                                      );
                                    case 'due_date':
                                      if (onTaskUpdate) {
                                        return (
                                          <td key="due_date" className={`py-2.5 px-3 align-middle ${tdBorder}`} onClick={(e) => e.stopPropagation()}>
                                            <DatePicker
                                              value={task.due_date ? new Date(task.due_date) : undefined}
                                              onChange={(date) => onTaskUpdate(task.task_id, { due_date: date ?? null })}
                                              clearable
                                              placeholder={t('tasks.dueDate', 'Due Date')}
                                            />
                                          </td>
                                        );
                                      }
                                      return (
                                        <td key="due_date" className={`py-2.5 px-3 align-middle ${tdBorder}`}>
                                          {task.due_date && (
                                            <span className="text-[13px] text-[rgb(var(--color-text-700))]">
                                              {format(new Date(task.due_date), 'MMM d, yyyy')}
                                            </span>
                                          )}
                                        </td>
                                      );
                                    case 'tags':
                                      return (
                                        <td key="tags" className={`py-2.5 px-3 align-middle ${tdBorder}`} onClick={(e) => e.stopPropagation()}>
                                          {onTaskTagsChange ? (
                                            <TagManager
                                              id={`task-tags-list-${task.task_id}`}
                                              entityId={task.task_id}
                                              entityType="project_task"
                                              initialTags={tags}
                                              onTagsChange={(newTags) => onTaskTagsChange(task.task_id, newTags)}
                                              size={tagSize}
                                            />
                                          ) : tags.length > 0 ? (
                                            <TagList
                                              tags={tags}
                                              maxDisplay={2}
                                              size={tagSize}
                                            />
                                          ) : null}
                                        </td>
                                      );
                                    case 'est_hours':
                                      return (
                                        <td key="est_hours" className={`py-2.5 px-3 align-middle ${tdBorder}`}>
                                          {onTaskUpdate ? (
                                            <InlineHoursEdit
                                              minutes={task.estimated_hours}
                                              onCommit={(mins) => onTaskUpdate(task.task_id, { estimated_hours: mins ?? 0 })}
                                            />
                                          ) : (
                                            <span className="text-[13px] text-[rgb(var(--color-text-700))]">
                                              {task.estimated_hours != null ? (task.estimated_hours / 60).toFixed(1) : '-'}
                                            </span>
                                          )}
                                        </td>
                                      );
                                    case 'actual_hours':
                                      return (
                                        <td key="actual_hours" className={`py-2.5 px-3 align-middle ${tdBorder}`}>
                                          {onTaskUpdate ? (
                                            <InlineHoursEdit
                                              minutes={task.actual_hours}
                                              onCommit={(mins) => onTaskUpdate(task.task_id, { actual_hours: mins ?? 0 })}
                                            />
                                          ) : (
                                            <span className="text-[13px] text-[rgb(var(--color-text-700))]">
                                              {task.actual_hours != null ? (task.actual_hours / 60).toFixed(1) : '-'}
                                            </span>
                                          )}
                                        </td>
                                      );
                                    case 'checklist':
                                      return (
                                        <td key="checklist" className={`py-2.5 px-3 align-middle ${tdBorder}`}>
                                          {checklist && checklist.total > 0 && (
                                            <Tooltip
                                              content={
                                                checklist.items && checklist.items.length > 0 ? (
                                                  <div className="text-xs space-y-1 max-w-xs">
                                                    <div className="font-medium text-gray-300 mb-1">{t('projectDetail.checklistItems', 'Checklist Items:')}</div>
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
                                                  <span>{t('projectDetail.checklistSummary', '{{completed}} of {{total}} complete', {
                                                    completed: checklist.completed,
                                                    total: checklist.total,
                                                  })}</span>
                                                )
                                              }
                                            >
                                              <div className="flex items-center gap-1 text-[rgb(var(--color-text-600))] cursor-help">
                                                <CheckSquare className="h-3.5 w-3.5" />
                                                <span className="text-xs">
                                                  {checklist.completed}/{checklist.total}
                                                </span>
                                              </div>
                                            </Tooltip>
                                          )}
                                        </td>
                                      );
                                    case 'deps':
                                      return (
                                        <td key="deps" className={`py-2.5 px-3 align-middle ${tdBorder}`}>
                                          {(() => {
                                            const deps = taskDependencies[task.task_id];
                                            const hasDependencies = deps && (deps.predecessors.length > 0 || deps.successors.length > 0);
                                            const dependencyTooltipContent = renderDependenciesTooltipContent(task.task_id);
                                            if (!hasDependencies || !dependencyTooltipContent) return null;
                                            return (
                                              <Tooltip content={dependencyTooltipContent}>
                                                <div className="flex items-center gap-1 cursor-help">
                                                  {getDependencyIcon(task.task_id)}
                                                  <span className="text-xs text-[rgb(var(--color-text-500))]">
                                                    {(deps?.predecessors.length || 0) + (deps?.successors.length || 0)}
                                                  </span>
                                                </div>
                                              </Tooltip>
                                            );
                                          })()}
                                        </td>
                                      );
                                    case 'attachments':
                                      return (
                                        <td key="attachments" className={`py-2.5 px-3 align-middle ${tdBorder}`}>
                                          {docCount > 0 && (
                                            <div className="flex items-center gap-1 text-[rgb(var(--color-text-600))]">
                                              <Paperclip className="h-3.5 w-3.5" />
                                              <span className="text-xs">{docCount}</span>
                                            </div>
                                          )}
                                        </td>
                                      );
                                    default:
                                      return null;
                                  }
                                })}
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
          <div className="border-t border-[rgb(var(--color-border-100)/0.72)] p-3">
            <Button
              id="add-phase-list-view"
              variant="default"
              size="sm"
              onClick={onAddPhase}
            >
              <Plus className="h-4 w-4 mr-2" />
              {t('projectPhases.addPhase', 'Add Phase')}
            </Button>
          </div>
        )}
      </div>
        </div>
      </div>
    </div>
  );
}
