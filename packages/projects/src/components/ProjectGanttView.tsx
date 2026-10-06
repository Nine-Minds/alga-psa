'use client';

import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { IProjectPhase, IProjectTask, ProjectStatus } from '@alga-psa/types';
import { Button } from '@alga-psa/ui/components/Button';
import { Switch } from '@alga-psa/ui/components/Switch';
import { Tooltip } from '@alga-psa/ui/components/Tooltip';
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '@alga-psa/ui/components/Popover';
import { EmptyState } from '@alga-psa/ui/components/EmptyState';
import UserAvatar from '@alga-psa/ui/components/UserAvatar';
import ViewSwitcher from '@alga-psa/ui/components/ViewSwitcher';
import { getUserAvatarUrlsBatchAction } from '@alga-psa/user-composition/actions';
import {
  Ban,
  CalendarClock,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Download,
  GanttChart,
  HelpCircle,
  Plus,
  SlidersHorizontal,
  Unlink,
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import {
  addDays,
  applyBarDrag,
  collectGanttEdges,
  diffInDays,
  findCriticalPath,
  findViolatedEdges,
  fitTimeline,
  ganttDomain,
  scheduleGanttBars,
  startOfDay,
  taskProgress,
  type GanttBar,
  type GanttEdge,
  type TaskDependencyMap,
} from '../lib/ganttSchedule';
import { arrowPoints, assignLanes, dependencyChain, LANE_GAP, roundedPath } from '../lib/ganttArrows';
import { exportGanttImage, resolveCssColor, type GanttExportModel } from '../lib/ganttExport';

const LEFT_COLUMN_WIDTH = 400;
const ROW_HEIGHT = 36;
const BAR_HEIGHT = 26;
const HEADER_BAND_HEIGHT = 24;
const HEADER_HEIGHT = HEADER_BAND_HEIGHT * 2;
/** Horizontal stub an arrow travels before it turns. */
const ARROW_STUB = 10;
/** Pointer travel before a press on a bar counts as a drag rather than a click. */
const DRAG_THRESHOLD_PX = 4;

// Colour triplets, so one token can serve both a solid fill and a tinted track.
const TONE_OPEN = 'var(--color-primary-500)';
// Every colour here is a theme variable, so each colour theme and its dark
// variant restyles the chart; nothing is a fixed hue.
const TONE_CLOSED = 'var(--color-status-success)';
// The success green is tuned for small badges and glares as a wide bar, so
// completed bars carry a neutral shade over it rather than a different hue.
const CLOSED_DIM = 'linear-gradient(rgb(0 0 0 / 0.2), rgb(0 0 0 / 0.2))';
const TONE_OVERDUE = 'var(--color-destructive)';
// Outlines sit a step darker than the fill so they read against it.
const EDGE_OPEN = 'var(--color-primary-700)';
const EDGE_CLOSED = 'var(--color-text-700)';
const CRITICAL_COLOR = 'rgb(var(--color-status-warning))';
// A gap in the surface colour keeps the ring legible where a theme's warning
// colour sits close to its bar colour (high contrast, sunset).
const CRITICAL_RING = `0 0 0 1.5px rgb(var(--color-card)), 0 0 0 3.5px ${CRITICAL_COLOR}`;
/** Related links assert no order, so they get their own hue rather than a fainter grey. */
const RELATED_COLOR = 'rgb(var(--color-secondary-700))';
/** Phase band: a tint over the phase's own dates, darker over the completed share. */
const PHASE_TINT = 0.14;
const PHASE_DONE_TINT = 0.34;
const PHASE_LANE_TINT = 0.05;
/** Narrower than this, the band's text is drawn beside it instead of inside. */
const PHASE_LABEL_MIN_WIDTH = 170;
const ARROW_CORNER_RADIUS = 4;
/** How long the pointer rests on a task before the rest of the chart fades. */
const HOVER_FADE_DELAY_MS = 350;
/** How long the fade survives after the pointer leaves, to bridge the gap between rows. */
const HOVER_FADE_RELEASE_MS = 120;
/** Bars are the solid tone; the done part is darkened with this overlay. */
const PROGRESS_SHADE = 'rgb(0 0 0 / 0.3)';
// Where the done part ends. A shade alone vanishes on near-black bars (high contrast).
const PROGRESS_TICK = '2px solid rgb(var(--color-card) / 0.9)';

export type GanttZoom = 'day' | 'week' | 'month';


/** Per-user display choices; persisted by the host alongside the other project view settings. */
export interface GanttSettings {
  zoom: GanttZoom;
  showBlocking: boolean;
  showRelated: boolean;
  showCriticalPath: boolean;
  hideClosed: boolean;
}

export const DEFAULT_GANTT_SETTINGS: GanttSettings = {
  zoom: 'week',
  showBlocking: true,
  showRelated: true,
  showCriticalPath: false,
  hideClosed: false,
};

type DragMode = 'move' | 'resize-start' | 'resize-end';

interface GanttRow {
  key: string;
  kind: 'phase' | 'task';
  phase: IProjectPhase;
  task?: IProjectTask;
}

interface PhaseSummary {
  /** The phase's own start and end dates, when it has both. */
  dates?: { start: Date; end: Date };
  start?: Date;
  end?: Date;
  /** Latest end among the phase's tasks, to show work running past the phase end. */
  tasksEnd?: Date;
  total: number;
  closed: number;
  /** Share of the phase's tasks that are closed, 0-100, as in the task list. */
  percent: number;
}

interface GanttUser {
  user_id: string;
  first_name?: string | null;
  last_name?: string | null;
}

export interface ProjectGanttViewProps {
  projectName?: string;
  phases: IProjectPhase[];
  /** Every task in the project. Scheduling always uses the full set so filtering never moves a bar. */
  tasks: IProjectTask[];
  /** Tasks left after the project filters; omitted means all of them. */
  visibleTaskIds?: Set<string>;
  hasActiveFilters?: boolean;
  statuses: ProjectStatus[];
  /** Status mappings are phase-specific; falls back to `statuses`. */
  statusesByPhase?: Record<string, ProjectStatus[]>;
  taskDependencies: TaskDependencyMap;
  checklistSummary?: Record<string, { total: number; completed: number }>;
  users?: GanttUser[];
  settings?: Partial<GanttSettings> | null;
  onSettingsChange?: (settings: GanttSettings) => void;
  /** Gates dragging bars and drawing dependencies. */
  canEdit?: boolean;
  onTaskClick?: (task: IProjectTask) => void;
  onTaskDatesChange?: (taskId: string, dates: { start_date: Date; due_date: Date }) => Promise<void> | void;
  onAddDependency?: (predecessorTaskId: string, successorTaskId: string) => Promise<void> | void;
  onRemoveDependency?: (dependencyId: string) => Promise<void> | void;
  onAddPhase?: () => void;
  onAddTask?: (phaseId: string) => void;
}

interface TimeAxis {
  majors: { key: string; x: number; width: number; label: string }[];
  minors: { key: string; x: number; width: number; label: string; isWeekend: boolean }[];
}

function buildTimeAxis(domainStart: Date, domainEnd: Date, zoom: GanttZoom, dayWidth: number, locale: string): TimeAxis {
  const xOf = (date: Date) => diffInDays(domainStart, date) * dayWidth;
  const monthLabel = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' });
  const shortMonth = new Intl.DateTimeFormat(locale, { month: 'short' });
  const dayMonth = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' });

  const majors: TimeAxis['majors'] = [];
  const minors: TimeAxis['minors'] = [];

  if (zoom === 'month') {
    for (let year = domainStart.getFullYear(); year <= domainEnd.getFullYear(); year += 1) {
      const from = new Date(Math.max(new Date(year, 0, 1).getTime(), domainStart.getTime()));
      const to = new Date(Math.min(new Date(year, 11, 31).getTime(), domainEnd.getTime()));
      majors.push({ key: `y-${year}`, x: xOf(from), width: (diffInDays(from, to) + 1) * dayWidth, label: String(year) });
    }
  } else {
    let cursor = new Date(domainStart.getFullYear(), domainStart.getMonth(), 1);
    while (cursor <= domainEnd) {
      const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
      const from = cursor < domainStart ? domainStart : cursor;
      const to = monthEnd > domainEnd ? domainEnd : monthEnd;
      majors.push({
        key: `m-${cursor.getFullYear()}-${cursor.getMonth()}`,
        x: xOf(from),
        width: (diffInDays(from, to) + 1) * dayWidth,
        label: monthLabel.format(cursor),
      });
      cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
    }
  }

  if (zoom === 'day') {
    for (let cursor = new Date(domainStart); cursor <= domainEnd; cursor = addDays(cursor, 1)) {
      const weekday = cursor.getDay();
      minors.push({
        key: `d-${cursor.getTime()}`,
        x: xOf(cursor),
        width: dayWidth,
        label: String(cursor.getDate()),
        isWeekend: weekday === 0 || weekday === 6,
      });
    }
  } else if (zoom === 'week') {
    // Snap to the Monday on or before the domain start.
    const first = addDays(domainStart, -((domainStart.getDay() + 6) % 7));
    for (let cursor = new Date(first); cursor <= domainEnd; cursor = addDays(cursor, 7)) {
      minors.push({
        key: `w-${cursor.getTime()}`,
        x: xOf(cursor),
        width: 7 * dayWidth,
        label: dayMonth.format(cursor),
        isWeekend: false,
      });
    }
  } else {
    let cursor = new Date(domainStart.getFullYear(), domainStart.getMonth(), 1);
    while (cursor <= domainEnd) {
      const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
      minors.push({
        key: `mm-${cursor.getTime()}`,
        x: xOf(cursor),
        width: (diffInDays(cursor, monthEnd) + 1) * dayWidth,
        label: shortMonth.format(cursor),
        isWeekend: false,
      });
      cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
    }
  }

  return { majors, minors };
}

function userDisplayName(user: GanttUser | undefined): string {
  if (!user) return '';
  return [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
}

export const ProjectGanttView: React.FC<ProjectGanttViewProps> = ({
  projectName,
  phases,
  tasks,
  visibleTaskIds,
  hasActiveFilters = false,
  statuses,
  statusesByPhase = {},
  taskDependencies,
  checklistSummary = {},
  users = [],
  settings: settingsProp,
  onSettingsChange,
  canEdit = false,
  onTaskClick,
  onTaskDatesChange,
  onAddDependency,
  onRemoveDependency,
  onAddPhase,
  onAddTask,
}) => {
  const { t, i18n } = useTranslation(['features/projects', 'common']);
  const ganttT = useCallback(
    (key: string, fallback: string, options?: Record<string, unknown>) =>
      t(`gantt.${key}`, { defaultValue: fallback, ...(options ?? {}) }) as string,
    [t],
  );

  // Uncontrolled fallback so the view still works without a preference store.
  const [localSettings, setLocalSettings] = useState<GanttSettings>(DEFAULT_GANTT_SETTINGS);
  const settings = useMemo<GanttSettings>(
    () => ({ ...DEFAULT_GANTT_SETTINGS, ...(onSettingsChange ? settingsProp ?? {} : localSettings) }),
    [settingsProp, localSettings, onSettingsChange],
  );
  const updateSettings = useCallback(
    (patch: Partial<GanttSettings>) => {
      const next = { ...settings, ...patch };
      if (onSettingsChange) onSettingsChange(next);
      else setLocalSettings(next);
    },
    [settings, onSettingsChange],
  );
  const { zoom, showBlocking, showRelated, showCriticalPath, hideClosed } = settings;

  const [collapsedPhaseIds, setCollapsedPhaseIds] = useState<Set<string>>(new Set());
  // Hover emphasis is written straight into a scoped <style> tag. Keeping it in
  // React state re-rendered every row and arrow each time the pointer crossed a row.
  const hoverScope = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const hoverStyleRef = useRef<HTMLStyleElement>(null);
  const edgesRef = useRef<GanttEdge[]>([]);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** True while the chart is faded around a chain. */
  const chainFocusRef = useRef(false);
  const setHoveredTaskId = useCallback(
    (taskId: string | null) => {
      const style = hoverStyleRef.current;
      if (!style) return;
      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
      const safe = (id: string) => /^[\w-]+$/.test(id);
      const root = `[data-gantt-root="${hoverScope}"]`;

      if (!taskId || !safe(taskId)) {
        // Hold the fade briefly so crossing the gap between two rows does not flash.
        const clear = () => {
          style.textContent = '';
          chainFocusRef.current = false;
        };
        if (chainFocusRef.current) hoverTimerRef.current = setTimeout(clear, HOVER_FADE_RELEASE_MS);
        else clear();
        return;
      }

      const rowRules = [
        `${root} [data-gantt-row="${taskId}"]{background-color:rgb(var(--color-primary-50));}`,
        `${root} [data-gantt-bar="${taskId}"]:not([data-critical]){box-shadow:0 0 0 2px rgb(var(--color-primary-700));}`,
      ];
      // Trace the whole chain the task belongs to and fade everything else.
      const chain = dependencyChain(edgesRef.current, taskId);
      const list = (ids: Set<string>, attribute: string) =>
        [...ids].filter(safe).map((id) => `${root} [${attribute}="${id}"]`).join(',');
      const fadeRules =
        chain.edgeIds.size > 0
          ? [
              `${root} [data-gantt-edge]{opacity:0.12;}`,
              `${root} [data-gantt-bar]{opacity:0.35;}`,
              `${list(chain.edgeIds, 'data-edge-id')}{opacity:1;}`,
              `${list(chain.taskIds, 'data-gantt-bar')}{opacity:1;}`,
            ]
          : [];
      const applyFade = () => {
        style.textContent = [...rowRules, ...fadeRules].join('');
        chainFocusRef.current = fadeRules.length > 0;
      };

      // The row highlight is immediate. The fade waits for the pointer to rest,
      // so sweeping down the rows does not flicker; once faded, it follows at once.
      if (chainFocusRef.current || fadeRules.length === 0) {
        applyFade();
      } else {
        style.textContent = rowRules.join('');
        hoverTimerRef.current = setTimeout(applyFade, HOVER_FADE_DELAY_MS);
      }
    },
    [hoverScope],
  );
  useEffect(
    () => () => {
      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    },
    [],
  );
  const [drag, setDrag] = useState<{ taskId: string; mode: DragMode; deltaDays: number } | null>(null);
  /** Dates shown while a save is in flight, so the bar does not snap back. */
  const [pendingBars, setPendingBars] = useState<Map<string, { start: Date; end: Date }>>(new Map());
  const [link, setLink] = useState<{ fromTaskId: string; x1: number; y1: number; x2: number; y2: number; targetTaskId: string | null } | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [selectedEdge, setSelectedEdge] = useState<{ dependencyId: string; x: number; y: number } | null>(null);
  const [avatarUrls, setAvatarUrls] = useState<Record<string, string | null>>({});

  const scrollRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<HTMLDivElement>(null);
  const hasCenteredRef = useRef(false);
  const dragOriginRef = useRef<{ x: number; moved: boolean } | null>(null);
  const suppressClickRef = useRef(false);
  const [viewportWidth, setViewportWidth] = useState(0);

  // The axis stretches to fill the pane, so a short project doesn't leave the
  // right-hand two thirds of the chart blank.
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    setViewportWidth(element.clientWidth);
    const observer = new ResizeObserver(([entry]) => setViewportWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const assigneeIdsKey = useMemo(
    () => [...new Set(tasks.map((task) => task.assigned_to).filter(Boolean) as string[])].sort().join(','),
    [tasks],
  );
  const tenant = tasks[0]?.tenant;
  useEffect(() => {
    if (!assigneeIdsKey || !tenant) return;
    let stale = false;
    getUserAvatarUrlsBatchAction(assigneeIdsKey.split(','), tenant)
      .then((urls) => {
        if (stale) return;
        const record: Record<string, string | null> = {};
        urls.forEach((url, id) => {
          record[id] = url;
        });
        setAvatarUrls(record);
      })
      .catch((error) => console.error('Failed to fetch avatar URLs:', error));
    return () => {
      stale = true;
    };
  }, [assigneeIdsKey, tenant]);

  const today = useMemo(() => startOfDay(new Date()), []);
  const locale = i18n.language || 'en';

  const edges = useMemo<GanttEdge[]>(() => collectGanttEdges(taskDependencies), [taskDependencies]);
  edgesRef.current = edges;
  const scheduledBars = useMemo(
    () => scheduleGanttBars({ tasks, phases, edges, today }),
    [tasks, phases, edges, today],
  );

  // What is drawn: the schedule, overlaid with the bar being dragged or saved.
  const bars = useMemo(() => {
    if (!drag && pendingBars.size === 0) return scheduledBars;
    const merged = new Map(scheduledBars);
    for (const [taskId, dates] of pendingBars) {
      const base = merged.get(taskId);
      if (base) merged.set(taskId, { ...base, ...dates, derivedStart: false, derivedEnd: false });
    }
    if (drag) {
      const base = scheduledBars.get(drag.taskId);
      if (base) merged.set(drag.taskId, { ...base, ...applyBarDrag(base, drag.mode, drag.deltaDays) });
    }
    return merged;
  }, [scheduledBars, pendingBars, drag]);

  const violatedEdges = useMemo(() => findViolatedEdges(edges, bars), [edges, bars]);
  const criticalPath = useMemo(
    () => (showCriticalPath ? findCriticalPath(edges, bars) : { taskIds: new Set<string>(), edgeIds: new Set<string>() }),
    [showCriticalPath, edges, bars],
  );

  // The domain follows the saved schedule only, so the axis holds still mid-drag.
  const contentDomain = useMemo(() => {
    const base = ganttDomain(scheduledBars, today);
    let { start, end } = base;
    for (const phase of phases) {
      if (phase.start_date) {
        const planned = addDays(startOfDay(new Date(phase.start_date)), -2);
        if (planned < start) start = planned;
      }
      if (phase.end_date) {
        const planned = addDays(startOfDay(new Date(phase.end_date)), 2);
        if (planned > end) end = planned;
      }
    }
    return { start, end };
  }, [scheduledBars, today, phases]);
  // Scale and range together: week and month views stretch to fit the project.
  const { domain, dayWidth } = useMemo(() => {
    const fit = fitTimeline({
      content: contentDomain,
      zoom,
      availableWidth: Math.max(0, viewportWidth - LEFT_COLUMN_WIDTH),
    });
    return { domain: { start: fit.start, end: fit.end }, dayWidth: fit.dayWidth };
  }, [contentDomain, viewportWidth, zoom]);

  const statusById = useMemo(() => {
    const map = new Map<string, ProjectStatus>();
    for (const status of statuses) map.set(status.project_status_mapping_id, status);
    for (const phaseStatuses of Object.values(statusesByPhase)) {
      for (const status of phaseStatuses) map.set(status.project_status_mapping_id, status);
    }
    return map;
  }, [statuses, statusesByPhase]);

  const isTaskClosed = useCallback(
    (task: IProjectTask) => statusById.get(task.project_status_mapping_id)?.is_closed ?? false,
    [statusById],
  );

  const taskById = useMemo(() => new Map(tasks.map((task) => [task.task_id, task])), [tasks]);
  const userById = useMemo(() => new Map(users.map((user) => [user.user_id, user])), [users]);

  const { rows, phaseSummaries, visibleTaskCount } = useMemo(() => {
    const orderedPhases = [...phases].sort((a, b) => (a.order_number ?? 0) - (b.order_number ?? 0));
    const built: GanttRow[] = [];
    const summaries = new Map<string, PhaseSummary>();
    let shown = 0;

    for (const phase of orderedPhases) {
      const phaseTasks = tasks.filter((task) => task.phase_id === phase.phase_id);
      const summary: PhaseSummary = { total: phaseTasks.length, closed: 0, percent: 0 };
      for (const task of phaseTasks) {
        if (isTaskClosed(task)) summary.closed += 1;
        const bar = bars.get(task.task_id);
        if (bar && (!summary.tasksEnd || bar.end > summary.tasksEnd)) summary.tasksEnd = bar.end;
      }
      summary.percent = summary.total > 0 ? Math.round((summary.closed / summary.total) * 100) : 0;
      if (phase.start_date) summary.start = startOfDay(new Date(phase.start_date));
      if (phase.end_date) summary.end = startOfDay(new Date(phase.end_date));
      if (summary.start && summary.end && summary.end >= summary.start) {
        summary.dates = { start: summary.start, end: summary.end };
      }
      summaries.set(phase.phase_id, summary);

      built.push({ key: `phase-${phase.phase_id}`, kind: 'phase', phase });

      const shownTasks = phaseTasks
        .filter((task) => (!visibleTaskIds || visibleTaskIds.has(task.task_id)) && !(hideClosed && isTaskClosed(task)))
        .sort((a, b) => {
          // Order by the saved schedule so rows do not reshuffle while a bar is dragged.
          const byStart =
            (scheduledBars.get(a.task_id)?.start.getTime() ?? 0) - (scheduledBars.get(b.task_id)?.start.getTime() ?? 0);
          return byStart !== 0 ? byStart : (a.wbs_code || '').localeCompare(b.wbs_code || '');
        });
      shown += shownTasks.length;
      if (collapsedPhaseIds.has(phase.phase_id)) continue;
      for (const task of shownTasks) {
        built.push({ key: `task-${task.task_id}`, kind: 'task', phase, task });
      }
    }

    return { rows: built, phaseSummaries: summaries, visibleTaskCount: shown };
  }, [phases, tasks, bars, scheduledBars, visibleTaskIds, hideClosed, isTaskClosed, collapsedPhaseIds]);

  const rowIndexByTaskId = useMemo(() => {
    const map = new Map<string, number>();
    rows.forEach((row, index) => {
      if (row.task) map.set(row.task.task_id, index);
    });
    return map;
  }, [rows]);

  /** Open blocking predecessors per task; a task with any is waiting. */
  const blockersByTaskId = useMemo(() => {
    const map = new Map<string, IProjectTask[]>();
    for (const edge of edges) {
      if (edge.kind !== 'blocks') continue;
      const predecessor = taskById.get(edge.predecessorTaskId);
      if (!predecessor || isTaskClosed(predecessor)) continue;
      const list = map.get(edge.successorTaskId);
      if (list) list.push(predecessor);
      else map.set(edge.successorTaskId, [predecessor]);
    }
    return map;
  }, [edges, taskById, isTaskClosed]);

  /** Tasks each task is holding up, for the tooltip. */
  const blockedByTaskId = useMemo(() => {
    const map = new Map<string, IProjectTask[]>();
    for (const edge of edges) {
      if (edge.kind !== 'blocks') continue;
      const successor = taskById.get(edge.successorTaskId);
      if (!successor || isTaskClosed(successor)) continue;
      const list = map.get(edge.predecessorTaskId);
      if (list) list.push(successor);
      else map.set(edge.predecessorTaskId, [successor]);
    }
    return map;
  }, [edges, taskById, isTaskClosed]);

  const conflictTaskIds = useMemo(() => {
    const ids = new Set<string>();
    for (const edge of edges) {
      if (violatedEdges.has(edge.dependencyId)) ids.add(edge.successorTaskId);
    }
    return ids;
  }, [edges, violatedEdges]);

  const chartWidth = Math.max(1, (diffInDays(domain.start, domain.end) + 1) * dayWidth);
  const bodyHeight = rows.length * ROW_HEIGHT;
  const axis = useMemo(() => buildTimeAxis(domain.start, domain.end, zoom, dayWidth, locale), [domain.start, domain.end, zoom, dayWidth, locale]);

  const xOf = useCallback((date: Date) => diffInDays(domain.start, date) * dayWidth, [domain.start, dayWidth]);
  const widthOf = useCallback(
    (start: Date, end: Date) => Math.max(dayWidth, (diffInDays(start, end) + 1) * dayWidth),
    [dayWidth],
  );
  const todayX = today >= domain.start && today <= domain.end ? xOf(today) + dayWidth / 2 : null;

  const scrollToToday = useCallback(() => {
    const container = scrollRef.current;
    if (!container || todayX === null) return;
    container.scrollLeft = Math.max(0, todayX - (container.clientWidth - LEFT_COLUMN_WIDTH) / 2);
  }, [todayX]);

  // Centre on today once the first schedule lands, then leave scrolling alone.
  useEffect(() => {
    if (hasCenteredRef.current || rows.length === 0 || viewportWidth === 0) return;
    hasCenteredRef.current = true;
    scrollToToday();
  }, [rows.length, viewportWidth, scrollToToday]);

  const dateFormat = useMemo(
    () => new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', year: 'numeric' }),
    [locale],
  );
  const formatRange = useCallback(
    (start: Date, end: Date) =>
      start.getTime() === end.getTime() ? dateFormat.format(start) : `${dateFormat.format(start)} – ${dateFormat.format(end)}`,
    [dateFormat],
  );

  // The phase band is short on room; the year is in the header above it.
  const shortDateFormat = useMemo(() => new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }), [locale]);
  const formatShortRange = useCallback(
    (start: Date, end: Date) => `${shortDateFormat.format(start)} – ${shortDateFormat.format(end)}`,
    [shortDateFormat],
  );

  const toneFor = useCallback(
    (task: IProjectTask, bar: GanttBar) =>
      isTaskClosed(task) ? TONE_CLOSED : bar.end < today ? TONE_OVERDUE : TONE_OPEN,
    [isTaskClosed, today],
  );

  const arrows = useMemo(() => {
    const placed = edges.flatMap((edge) => {
      if (edge.kind === 'blocks' ? !showBlocking : !showRelated) return [];
      const fromRow = rowIndexByTaskId.get(edge.predecessorTaskId);
      const toRow = rowIndexByTaskId.get(edge.successorTaskId);
      const fromBar = bars.get(edge.predecessorTaskId);
      const toBar = bars.get(edge.successorTaskId);
      if (fromRow === undefined || toRow === undefined || !fromBar || !toBar) return [];
      return [{
        edge,
        x1: xOf(fromBar.start) + widthOf(fromBar.start, fromBar.end),
        y1: fromRow * ROW_HEIGHT + ROW_HEIGHT / 2,
        x2: xOf(toBar.start),
        y2: toRow * ROW_HEIGHT + ROW_HEIGHT / 2,
      }];
    });
    const lanes = assignLanes(placed.map((arrow) => ({ sourceId: arrow.edge.predecessorTaskId, x: arrow.x1, y: arrow.y1 })));

    return placed.map(({ edge, x1, y1, x2, y2 }) => ({
      key: edge.dependencyId,
      kind: edge.kind,
      predecessorTaskId: edge.predecessorTaskId,
      successorTaskId: edge.successorTaskId,
      x1,
      y1,
      d: roundedPath(
        arrowPoints({
          x1,
          y1,
          x2,
          y2,
          stub: ARROW_STUB + (lanes.get(edge.predecessorTaskId) ?? 0) * LANE_GAP,
          rowHeight: ROW_HEIGHT,
        }),
        ARROW_CORNER_RADIUS,
      ),
      violated: violatedEdges.has(edge.dependencyId),
      critical: criticalPath.edgeIds.has(edge.dependencyId),
    }));
  }, [showBlocking, showRelated, edges, rowIndexByTaskId, bars, xOf, widthOf, violatedEdges, criticalPath]);

  const zoomOptions = useMemo(
    () => [
      { value: 'day' as GanttZoom, label: ganttT('zoomDay', 'Day'), id: 'gantt-zoom-day' },
      { value: 'week' as GanttZoom, label: ganttT('zoomWeek', 'Week'), id: 'gantt-zoom-week' },
      { value: 'month' as GanttZoom, label: ganttT('zoomMonth', 'Month'), id: 'gantt-zoom-month' },
    ],
    [ganttT],
  );

  const editable = canEdit && Boolean(onTaskDatesChange);
  const linkable = canEdit && Boolean(onAddDependency);

  const commitDates = useCallback(
    async (taskId: string, next: { start: Date; end: Date }) => {
      if (!onTaskDatesChange) return;
      setPendingBars((prev) => new Map(prev).set(taskId, next));
      try {
        await onTaskDatesChange(taskId, { start_date: next.start, due_date: next.end });
      } finally {
        setPendingBars((prev) => {
          const map = new Map(prev);
          map.delete(taskId);
          return map;
        });
      }
    },
    [onTaskDatesChange],
  );

  const handleBarPointerDown = (event: React.PointerEvent<HTMLElement>, taskId: string, mode: DragMode) => {
    if (!editable || event.button !== 0) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragOriginRef.current = { x: event.clientX, moved: false };
    setDrag({ taskId, mode, deltaDays: 0 });
  };

  const handleBarPointerMove = (event: React.PointerEvent<HTMLElement>) => {
    const origin = dragOriginRef.current;
    if (!origin || !drag) return;
    const dx = event.clientX - origin.x;
    if (!origin.moved && Math.abs(dx) < DRAG_THRESHOLD_PX) return;
    origin.moved = true;
    const deltaDays = Math.round(dx / dayWidth);
    if (deltaDays !== drag.deltaDays) setDrag({ ...drag, deltaDays });
  };

  const handleBarPointerUp = (event: React.PointerEvent<HTMLElement>) => {
    const origin = dragOriginRef.current;
    dragOriginRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (!origin || !drag) return;
    const finished = drag;
    setDrag(null);
    if (!origin.moved) return;
    // The click that follows a drag must not also open the task.
    suppressClickRef.current = true;
    setTimeout(() => {
      suppressClickRef.current = false;
    }, 0);
    const base = scheduledBars.get(finished.taskId);
    if (!base || finished.deltaDays === 0) return;
    void commitDates(finished.taskId, applyBarDrag(base, finished.mode, finished.deltaDays));
  };

  const handleBarKeyDown = (event: React.KeyboardEvent<HTMLElement>, taskId: string) => {
    if (!editable || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
    if (!event.altKey && !event.shiftKey) return;
    const base = bars.get(taskId);
    if (!base) return;
    event.preventDefault();
    const step = event.key === 'ArrowLeft' ? -1 : 1;
    void commitDates(taskId, applyBarDrag(base, event.shiftKey ? 'resize-end' : 'move', step));
  };

  const chartPoint = (event: React.PointerEvent) => {
    const rect = chartRef.current?.getBoundingClientRect();
    return rect ? { x: event.clientX - rect.left, y: event.clientY - rect.top } : { x: 0, y: 0 };
  };

  const linkTargetAt = (event: React.PointerEvent, fromTaskId: string): string | null => {
    const element = document.elementFromPoint(event.clientX, event.clientY);
    const targetId = element?.closest<HTMLElement>('[data-gantt-task-id]')?.dataset.ganttTaskId ?? null;
    if (!targetId || targetId === fromTaskId) return null;
    const exists = edges.some(
      (edge) =>
        edge.kind === 'blocks' &&
        ((edge.predecessorTaskId === fromTaskId && edge.successorTaskId === targetId) ||
          (edge.predecessorTaskId === targetId && edge.successorTaskId === fromTaskId)),
    );
    return exists ? null : targetId;
  };

  const handleLinkPointerDown = (event: React.PointerEvent<HTMLElement>, taskId: string) => {
    if (!linkable || event.button !== 0) return;
    event.stopPropagation();
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = chartPoint(event);
    setLink({ fromTaskId: taskId, x1: point.x, y1: point.y, x2: point.x, y2: point.y, targetTaskId: null });
  };

  const handleLinkPointerMove = (event: React.PointerEvent<HTMLElement>) => {
    if (!link) return;
    const point = chartPoint(event);
    setLink({ ...link, x2: point.x, y2: point.y, targetTaskId: linkTargetAt(event, link.fromTaskId) });
  };

  const handleLinkPointerUp = (event: React.PointerEvent<HTMLElement>) => {
    if (!link) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const targetTaskId = linkTargetAt(event, link.fromTaskId);
    const fromTaskId = link.fromTaskId;
    setLink(null);
    if (targetTaskId) void onAddDependency?.(fromTaskId, targetTaskId);
  };

  const togglePhase = (phaseId: string) => {
    setCollapsedPhaseIds((prev) => {
      const next = new Set(prev);
      if (next.has(phaseId)) next.delete(phaseId);
      else next.add(phaseId);
      return next;
    });
  };
  const allCollapsed = phases.length > 0 && collapsedPhaseIds.size >= phases.length;

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const openColor = resolveCssColor('--color-primary-500', '#8b5cf6');
      const closedColor = resolveCssColor('--color-status-success', '#22c55e');
      const overdueColor = '#ef4444';
      const model: GanttExportModel = {
        title: projectName ? `${projectName} · ${ganttT('title', 'Timeline')}` : ganttT('title', 'Timeline'),
        leftWidth: LEFT_COLUMN_WIDTH,
        chartWidth,
        headerBandHeight: HEADER_BAND_HEIGHT,
        rowHeight: ROW_HEIGHT,
        majors: axis.majors,
        minors: axis.minors,
        todayX,
        rows: rows.map((row) => ({ kind: row.kind, label: row.task ? row.task.task_name : row.phase.phase_name })),
        phaseBands: [],
        accentColor: openColor,
        bars: [],
        arrows: arrows.map((arrow) => ({
          d: arrow.d,
          tone: arrow.violated ? 'conflict' : arrow.critical ? 'critical' : arrow.kind === 'related' ? 'related' : 'blocking',
        })),
      };
      rows.forEach((row, index) => {
        if (row.kind === 'phase') {
          const summary = phaseSummaries.get(row.phase.phase_id);
          if (summary?.dates) {
            let laneRows = 0;
            while (rows[index + 1 + laneRows]?.kind === 'task') laneRows += 1;
            const x = xOf(summary.dates.start);
            const width = widthOf(summary.dates.start, summary.dates.end);
            model.phaseBands.push({
              row: index,
              x,
              width,
              progress: summary.percent / 100,
              label: `${formatShortRange(summary.dates.start, summary.dates.end)} · ${summary.percent}%`,
              overrunWidth:
                summary.tasksEnd && summary.tasksEnd > summary.dates.end
                  ? diffInDays(summary.dates.end, summary.tasksEnd) * dayWidth
                  : 0,
              laneRows,
            });
          }
          return;
        }
        const task = row.task!;
        const bar = bars.get(task.task_id);
        if (!bar) return;
        const closed = isTaskClosed(task);
        model.bars.push({
          row: index,
          x: xOf(bar.start),
          width: widthOf(bar.start, bar.end),
          height: BAR_HEIGHT,
          color: closed ? closedColor : bar.end < today ? overdueColor : openColor,
          dimmed: closed,
          progress: closed ? 0 : taskProgress({ task, closed, checklist: checklistSummary[task.task_id] }),
          inferred: bar.derivedStart || bar.derivedEnd,
          critical: criticalPath.taskIds.has(task.task_id),
        });
      });
      const slug = (projectName || 'project').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').toLowerCase();
      const format = await exportGanttImage(model, `${slug || 'project'}-timeline`);
      if (format === 'svg') {
        toast.success(ganttT('exportedAsSvg', 'Timeline was too large for a PNG, so it was saved as an SVG instead.'));
      }
    } catch (error) {
      console.error('Failed to export timeline:', error);
      toast.error(ganttT('exportFailed', 'Could not export the timeline. Please try again.'));
    } finally {
      setIsExporting(false);
    }
  };

  if (phases.length === 0 || tasks.length === 0) {
    const firstPhaseId = [...phases].sort((a, b) => (a.order_number ?? 0) - (b.order_number ?? 0))[0]?.phase_id;
    return (
      <div className="flex-1 min-h-0 border border-gray-200 rounded-md bg-white">
        <EmptyState
          icon={<GanttChart className="h-6 w-6" />}
          title={
            phases.length === 0
              ? ganttT('emptyNoPhasesTitle', 'No phases yet')
              : ganttT('emptyNoTasksTitle', 'No tasks to plot yet')
          }
          description={
            phases.length === 0
              ? ganttT('emptyNoPhasesDescription', 'Add a phase, then add tasks to it. Each task appears here as a bar.')
              : ganttT(
                  'emptyNoTasksDescription',
                  'Add a task to see it here. Give it a start date and a due date to fix its bar, or an estimate and the timeline will work out the dates.',
                )
          }
          action={
            phases.length === 0 ? (
              onAddPhase && (
                <Button id="gantt-empty-add-phase" onClick={onAddPhase}>
                  <Plus className="h-4 w-4 mr-2" />
                  {ganttT('addPhase', 'Add phase')}
                </Button>
              )
            ) : (
              onAddTask && firstPhaseId && (
                <Button id="gantt-empty-add-task" onClick={() => onAddTask(firstPhaseId)}>
                  <Plus className="h-4 w-4 mr-2" />
                  {ganttT('addTask', 'Add task')}
                </Button>
              )
            )
          }
        />
      </div>
    );
  }

  const legendItems: { key: string; swatch: React.ReactNode; label: string }[] = [
    {
      key: 'scheduled',
      swatch: <span className="inline-block w-7 h-2.5 rounded-sm" style={{ backgroundColor: `rgb(${TONE_OPEN})` }} />,
      label: ganttT('legendScheduled', 'Dates set on the task'),
    },
    {
      key: 'inferred',
      swatch: (
        <span
          className="inline-block w-7 h-2.5 rounded-sm border border-dashed"
          style={{
            borderColor: `rgb(${EDGE_OPEN})`,
            backgroundColor: `rgb(${TONE_OPEN})`,
            backgroundImage: 'repeating-linear-gradient(45deg, rgb(var(--color-card) / 0.5) 0 3px, transparent 3px 7px)',
          }}
        />
      ),
      label: ganttT('legendInferred', 'Estimated dates (no dates set)'),
    },
    {
      key: 'progress',
      swatch: (
        <span className="inline-flex w-7 h-2.5 rounded-sm overflow-hidden" style={{ backgroundColor: `rgb(${TONE_OPEN})` }}>
          <span className="w-1/2 h-full" style={{ backgroundColor: PROGRESS_SHADE, borderRight: PROGRESS_TICK }} />
        </span>
      ),
      label: ganttT('legendProgress', 'Darker part shows progress'),
    },
    {
      key: 'overdue',
      swatch: <span className="inline-block w-7 h-2.5 rounded-sm" style={{ backgroundColor: `rgb(${TONE_OVERDUE})` }} />,
      label: ganttT('legendOverdue', 'Overdue'),
    },
    {
      key: 'closed',
      swatch: <span className="inline-block w-7 h-2.5 rounded-sm" style={{ backgroundColor: `rgb(${TONE_CLOSED})`, backgroundImage: CLOSED_DIM }} />,
      label: ganttT('legendClosed', 'Completed'),
    },
    {
      key: 'critical',
      swatch: <span className="inline-block w-6 h-2 rounded-sm" style={{ backgroundColor: `rgb(${TONE_OPEN})`, boxShadow: CRITICAL_RING }} />,
      label: ganttT('legendCritical', 'Critical path: a delay here delays the finish'),
    },
    {
      key: 'phase',
      swatch: (
        <span className="inline-flex w-7 h-2.5 rounded-sm overflow-hidden" style={{ backgroundColor: `rgb(${TONE_OPEN} / ${PHASE_TINT})` }}>
          <span className="w-1/2 h-full" style={{ backgroundColor: `rgb(${TONE_OPEN} / ${PHASE_DONE_TINT})` }} />
        </span>
      ),
      label: ganttT('legendPhase', 'Phase dates; the darker part is the share of tasks completed'),
    },
    {
      key: 'phaseOverrun',
      swatch: (
        <span
          className="inline-block w-7 h-2.5 rounded-sm border border-dashed"
          style={{ backgroundColor: `rgb(${TONE_OVERDUE} / 0.14)`, borderColor: `rgb(${TONE_OVERDUE} / 0.6)` }}
        />
      ),
      label: ganttT('legendPhaseOverrun', 'Tasks running past the phase end date'),
    },
    {
      key: 'blocking',
      swatch: <span className="inline-block w-7 border-t-2 border-[rgb(var(--color-text-700))]" />,
      label: ganttT('legendBlocking', 'Blocking: must finish first'),
    },
    {
      key: 'conflict',
      swatch: <span className="inline-block w-7 border-t-2" style={{ borderColor: `rgb(${TONE_OVERDUE})` }} />,
      label: ganttT('legendViolated', 'Dependency conflict: starts before its blocker ends'),
    },
    {
      key: 'related',
      swatch: <span className="inline-block w-7 border-t-2 border-dashed" style={{ borderColor: RELATED_COLOR }} />,
      label: ganttT('legendRelated', 'Related: no effect on dates'),
    },
  ];

  const displayToggles: { key: keyof GanttSettings; id: string; label: string; hint: string }[] = [
    {
      key: 'showBlocking',
      id: 'gantt-show-blocking',
      label: ganttT('showBlocking', 'Blocking links'),
      hint: ganttT('showBlockingHint', 'Arrows between tasks that must finish in order'),
    },
    {
      key: 'showRelated',
      id: 'gantt-show-related',
      label: ganttT('showRelated', 'Related links'),
      hint: ganttT('showRelatedHint', 'Dotted lines between related tasks'),
    },
    {
      key: 'showCriticalPath',
      id: 'gantt-show-critical-path',
      label: ganttT('showCriticalPath', 'Critical path'),
      hint: ganttT('showCriticalPathHint', 'Highlight the tasks that set the finish date'),
    },
    {
      key: 'hideClosed',
      id: 'gantt-hide-closed',
      label: ganttT('hideClosed', 'Hide completed tasks'),
      hint: ganttT('hideClosedHint', 'Show only work that is still open'),
    },
  ];

  const linkSource = link ? rowIndexByTaskId.get(link.fromTaskId) : undefined;
  const selectedArrow = selectedEdge ? arrows.find((arrow) => arrow.key === selectedEdge.dependencyId) : undefined;

  return (
    <div className="flex flex-col h-full min-h-0" data-gantt-root={hoverScope}>
      <style>{`[data-gantt-root="${hoverScope}"] [data-gantt-edge-group]:hover > path[data-gantt-edge]{stroke-width:3px;}[data-gantt-root="${hoverScope}"] [data-gantt-bar],[data-gantt-root="${hoverScope}"] [data-gantt-edge]{transition:opacity 150ms ease-out;}`}</style>
      <style ref={hoverStyleRef} />
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3 flex-shrink-0">
        <div className="flex items-center gap-3">
          <ViewSwitcher
            currentView={zoom}
            onChange={(value) => updateSettings({ zoom: value as GanttZoom })}
            options={zoomOptions}
            aria-label={ganttT('zoomLabel', 'Timeline scale')}
          />
          <Button id="gantt-today-button" variant="outline" size="sm" onClick={scrollToToday} disabled={todayX === null}>
            <CalendarClock className="h-4 w-4 mr-2" />
            {ganttT('today', 'Today')}
          </Button>
          {editable && (
            <span className="hidden xl:inline text-xs text-gray-500">
              {ganttT('dragHint', 'Drag a bar to reschedule, or its edges to change the duration.')}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Popover>
            <Tooltip content={ganttT('displayOptions', 'Display options')}>
              <PopoverTrigger asChild>
                <Button
                  id="gantt-display-options"
                  variant="ghost"
                  size="sm"
                  className="p-1.5 h-auto w-auto text-gray-400 hover:text-gray-600"
                  aria-label={ganttT('displayOptions', 'Display options')}
                >
                  <SlidersHorizontal className="h-4 w-4" />
                </Button>
              </PopoverTrigger>
            </Tooltip>
            <PopoverContent align="end" className="w-72 p-3">
              <div className="pb-2 text-sm font-semibold text-[rgb(var(--color-text-900))]">
                {ganttT('displayOptions', 'Display options')}
              </div>
              <div className="space-y-3">
                {displayToggles.map((toggle) => (
                  <div key={toggle.key} className="flex items-start justify-between gap-3">
                    <label htmlFor={toggle.id} className="min-w-0 cursor-pointer">
                      <span className="block text-sm text-[rgb(var(--color-text-900))]">{toggle.label}</span>
                      <span className="block text-xs text-gray-500">{toggle.hint}</span>
                    </label>
                    <Switch
                      id={toggle.id}
                      size="sm"
                      checked={Boolean(settings[toggle.key])}
                      onCheckedChange={(checked) => updateSettings({ [toggle.key]: checked } as Partial<GanttSettings>)}
                    />
                  </div>
                ))}
              </div>
            </PopoverContent>
          </Popover>

          <Popover>
            <Tooltip content={ganttT('legend', 'Legend')}>
              <PopoverTrigger asChild>
                <Button
                  id="gantt-legend"
                  variant="ghost"
                  size="sm"
                  className="p-1.5 h-auto w-auto text-gray-400 hover:text-gray-600"
                  aria-label={ganttT('legend', 'Legend')}
                >
                  <HelpCircle className="h-4 w-4" />
                </Button>
              </PopoverTrigger>
            </Tooltip>
            <PopoverContent align="end" className="w-80 p-3">
              <div className="pb-2 text-sm font-semibold text-[rgb(var(--color-text-900))]">
                {ganttT('legend', 'Legend')}
              </div>
              <ul className="space-y-2">
                {legendItems.map((item) => (
                  <li key={item.key} className="flex items-center gap-3 text-xs text-gray-600">
                    <span className="flex w-7 flex-shrink-0 items-center justify-center">{item.swatch}</span>
                    {item.label}
                  </li>
                ))}
              </ul>
              {editable && (
                <p className="mt-3 border-t border-gray-200 pt-2 text-xs text-gray-500">
                  {ganttT(
                    'keyboardHint',
                    'Keyboard: focus a bar, then Alt + ← / → moves it a day and Shift + ← / → changes its due date.',
                  )}
                </p>
              )}
            </PopoverContent>
          </Popover>

          <Button id="gantt-export-button" variant="outline" size="sm" onClick={handleExport} disabled={isExporting}>
            <Download className="h-4 w-4 mr-2" />
            {ganttT('export', 'Export image')}
          </Button>
        </div>
      </div>

      {visibleTaskCount === 0 && (
        <p className="mb-2 flex-shrink-0 text-sm text-gray-500" role="status">
          {hasActiveFilters
            ? ganttT('emptyFiltered', 'No tasks match the current filters.')
            : ganttT('emptyAllClosed', 'Every task is completed. Turn off "Hide completed tasks" to see them.')}
        </p>
      )}

      <div
        ref={scrollRef}
        className="relative flex-1 min-h-0 overflow-auto border border-gray-200 rounded-md bg-white"
      >
        <div style={{ width: LEFT_COLUMN_WIDTH + chartWidth, minWidth: '100%' }}>
          {/* Header: month/year band over day/week/month ticks */}
          <div className="sticky top-0 z-20 flex bg-white border-b border-gray-200" style={{ height: HEADER_HEIGHT }}>
            <div
              className="sticky left-0 z-10 flex items-end justify-between px-3 pb-1 bg-white border-r border-gray-200 text-xs font-medium text-gray-500"
              style={{ width: LEFT_COLUMN_WIDTH, minWidth: LEFT_COLUMN_WIDTH }}
            >
              {ganttT('taskColumn', 'Phase / Task')}
              <Tooltip content={allCollapsed ? ganttT('expandAll', 'Expand all phases') : ganttT('collapseAll', 'Collapse all phases')}>
                <Button
                  id="gantt-toggle-all-phases"
                  variant="ghost"
                  size="sm"
                  className="p-1 h-auto w-auto text-gray-400 hover:text-gray-600"
                  aria-label={allCollapsed ? ganttT('expandAll', 'Expand all phases') : ganttT('collapseAll', 'Collapse all phases')}
                  onClick={() =>
                    setCollapsedPhaseIds(allCollapsed ? new Set() : new Set(phases.map((phase) => phase.phase_id)))
                  }
                >
                  {allCollapsed ? <ChevronsUpDown className="h-3.5 w-3.5" /> : <ChevronsDownUp className="h-3.5 w-3.5" />}
                </Button>
              </Tooltip>
            </div>
            <div className="relative" style={{ width: chartWidth }}>
              {axis.majors.map((major) => (
                <div
                  key={major.key}
                  className="absolute top-0 border-r border-gray-200 px-2 text-xs font-medium text-gray-600 truncate"
                  style={{ left: major.x, width: major.width, height: HEADER_BAND_HEIGHT, lineHeight: `${HEADER_BAND_HEIGHT}px` }}
                >
                  {major.label}
                </div>
              ))}
              {axis.minors.map((minor) => (
                <div
                  key={minor.key}
                  className={`absolute border-r border-gray-100 text-[10px] text-center ${
                    minor.isWeekend ? 'bg-gray-50 text-gray-400' : 'text-gray-500'
                  }`}
                  style={{
                    left: minor.x,
                    top: HEADER_BAND_HEIGHT,
                    width: minor.width,
                    height: HEADER_BAND_HEIGHT,
                    lineHeight: `${HEADER_BAND_HEIGHT}px`,
                  }}
                >
                  {zoom === 'day' && minor.width < 20 ? '' : minor.label}
                </div>
              ))}
            </div>
          </div>

          {/* Body */}
          <div className="relative flex" style={{ height: bodyHeight }}>
            <div
              className="sticky left-0 z-10 bg-white border-r border-gray-200"
              style={{ width: LEFT_COLUMN_WIDTH, minWidth: LEFT_COLUMN_WIDTH }}
            >
              {rows.map((row) => {
                if (row.kind === 'phase') {
                  const summary = phaseSummaries.get(row.phase.phase_id);
                  const collapsed = collapsedPhaseIds.has(row.phase.phase_id);
                  return (
                    <div
                      key={row.key}
                      className="group flex items-center gap-2 pl-2 pr-3 border-b border-gray-100 bg-gray-50"
                      style={{ height: ROW_HEIGHT }}
                    >
                      <button
                        id={`gantt-phase-toggle-${row.phase.phase_id}`}
                        type="button"
                        className="flex min-w-0 flex-1 items-center gap-1.5 text-left rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--color-primary-400))]"
                        onClick={() => togglePhase(row.phase.phase_id)}
                        aria-expanded={!collapsed}
                      >
                        {collapsed ? (
                          <ChevronRight className="h-4 w-4 flex-shrink-0 text-gray-400" />
                        ) : (
                          <ChevronDown className="h-4 w-4 flex-shrink-0 text-gray-400" />
                        )}
                        <Tooltip content={row.phase.description || row.phase.phase_name}>
                          <span className="truncate text-sm font-semibold text-[rgb(var(--color-text-900))]">
                            {row.phase.phase_name}
                          </span>
                        </Tooltip>
                      </button>
                      {onAddTask && canEdit && (
                        <Tooltip content={ganttT('addTaskToPhase', 'Add task to this phase')}>
                          <Button
                            id={`gantt-add-task-${row.phase.phase_id}`}
                            variant="ghost"
                            size="sm"
                            className="p-1 h-auto w-auto text-gray-400 hover:text-gray-600 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
                            aria-label={ganttT('addTaskToPhase', 'Add task to this phase')}
                            onClick={() => onAddTask(row.phase.phase_id)}
                          >
                            <Plus className="h-3.5 w-3.5" />
                          </Button>
                        </Tooltip>
                      )}
                      {/* Same chip and completion figure as the task list's phase header. */}
                      {summary && (
                        <span className="chip-primary inline-flex flex-shrink-0 items-center rounded px-2 py-0.5 text-xs font-medium">
                          {summary.total} {t(summary.total === 1 ? 'task' : 'tasks.title', summary.total === 1 ? 'task' : 'tasks')}
                        </span>
                      )}
                      {summary && summary.total > 0 && (
                        <Tooltip
                          content={ganttT('phaseProgress', '{{closed}} of {{total}} tasks completed', {
                            closed: summary.closed,
                            total: summary.total,
                          })}
                        >
                          <span className="w-10 flex-shrink-0 text-right text-sm font-bold tabular-nums text-[rgb(var(--color-primary-600))]">
                            {summary.percent}%
                          </span>
                        </Tooltip>
                      )}
                    </div>
                  );
                }

                const task = row.task!;
                const blockers = blockersByTaskId.get(task.task_id);
                const status = statusById.get(task.project_status_mapping_id);
                const assignee = task.assigned_to ? userById.get(task.assigned_to) : undefined;
                const assigneeName = userDisplayName(assignee);
                const isLinkTarget = link?.targetTaskId === task.task_id;
                return (
                  <div
                    key={row.key}
                    data-gantt-row={task.task_id}
                    className={`flex items-center gap-2 pr-3 border-b border-gray-100 text-gray-600 ${
                      isLinkTarget ? 'bg-[rgb(var(--color-primary-50))]' : ''
                    }`}
                    style={{ height: ROW_HEIGHT, paddingLeft: 30 }}
                    onMouseEnter={() => setHoveredTaskId(task.task_id)}
                    onMouseLeave={() => setHoveredTaskId(null)}
                  >
                    {blockers && (
                      <Tooltip
                        content={ganttT('blockedBy', 'Waiting on: {{tasks}}', {
                          tasks: blockers.map((blocker) => blocker.task_name).join(', '),
                        })}
                      >
                        <Ban className="h-3.5 w-3.5 flex-shrink-0" style={{ color: 'rgb(var(--color-status-warning))' }} />
                      </Tooltip>
                    )}
                    <button
                      id={`gantt-task-label-${task.task_id}`}
                      type="button"
                      className="min-w-0 flex-1 truncate text-sm text-left rounded-sm hover:text-[rgb(var(--color-primary-600))] hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--color-primary-400))]"
                      onClick={() => onTaskClick?.(task)}
                      title={task.task_name}
                    >
                      {task.task_name}
                    </button>
                    {status && (() => {
                      // Same pill as the task list's Status column.
                      // A status with no colour of its own falls back to the theme's neutral.
                      const statusColor = status.color || null;
                      const statusName = status.custom_name || status.name;
                      return (
                        <Tooltip content={statusName}>
                          <span
                            className="inline-flex max-w-[110px] flex-shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium"
                            style={
                              statusColor
                                ? {
                                    backgroundColor: `${statusColor}20`,
                                    color: statusColor,
                                    border: `1px solid ${statusColor}40`,
                                  }
                                : {
                                    backgroundColor: 'rgb(var(--color-text-500) / 0.14)',
                                    color: 'rgb(var(--color-text-700))',
                                    border: '1px solid rgb(var(--color-text-500) / 0.32)',
                                  }
                            }
                          >
                            <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: statusColor ?? 'rgb(var(--color-text-500))' }} />
                            <span className="truncate">{statusName}</span>
                          </span>
                        </Tooltip>
                      );
                    })()}
                    {task.assigned_to && (
                      <Tooltip content={assigneeName || ganttT('assignee', 'Assignee')}>
                        <span className="flex-shrink-0">
                          <UserAvatar
                            userId={task.assigned_to}
                            userName={assigneeName}
                            avatarUrl={avatarUrls[task.assigned_to] ?? null}
                            size="xs"
                          />
                        </span>
                      </Tooltip>
                    )}
                  </div>
                );
              })}
            </div>

            <div ref={chartRef} className="relative" style={{ width: chartWidth }}>
              {/* Column stripes */}
              {axis.minors.map((minor) => (
                <div
                  key={`stripe-${minor.key}`}
                  className={`absolute top-0 bottom-0 border-r border-gray-100 ${minor.isWeekend ? 'bg-gray-50' : ''}`}
                  style={{ left: minor.x, width: minor.width }}
                />
              ))}

              {todayX !== null && (
                <div
                  className="absolute top-0 bottom-0 border-l-2 border-dashed z-[4]"
                  style={{ left: todayX, borderColor: `rgb(${TONE_OVERDUE} / 0.7)` }}
                  aria-hidden
                />
              )}

              {/* Phase lanes: the phase's dates carried down behind its tasks. */}
              {rows.map((row, rowIndex) => {
                if (row.kind !== 'phase') return null;
                const dates = phaseSummaries.get(row.phase.phase_id)?.dates;
                if (!dates) return null;
                let laneRows = 0;
                while (rows[rowIndex + 1 + laneRows]?.kind === 'task') laneRows += 1;
                if (laneRows === 0) return null;
                return (
                  <div
                    key={`lane-${row.key}`}
                    className="absolute pointer-events-none border-x border-dashed"
                    style={{
                      left: xOf(dates.start),
                      width: widthOf(dates.start, dates.end),
                      top: (rowIndex + 1) * ROW_HEIGHT,
                      height: laneRows * ROW_HEIGHT,
                      backgroundColor: `rgb(${TONE_OPEN} / ${PHASE_LANE_TINT})`,
                      borderColor: `rgb(${TONE_OPEN} / 0.35)`,
                    }}
                    aria-hidden
                  />
                );
              })}

              {/* Rows and bars */}
              {rows.map((row, rowIndex) => {
                if (row.kind === 'phase') {
                  const summary = phaseSummaries.get(row.phase.phase_id);
                  const dates = summary?.dates;
                  const percent = summary?.percent ?? 0;
                  const bandLeft = dates ? xOf(dates.start) : 0;
                  const bandWidth = dates ? widthOf(dates.start, dates.end) : 0;
                  const overrunWidth =
                    dates && summary?.tasksEnd && summary.tasksEnd > dates.end
                      ? diffInDays(dates.end, summary.tasksEnd) * dayWidth
                      : 0;
                  const label = dates
                    ? ganttT('phaseBandLabel', '{{range}} · {{percent}}% complete', {
                        range: formatShortRange(dates.start, dates.end),
                        percent,
                      })
                    : summary?.start
                      ? ganttT('phaseStartsOn', 'Starts {{date}} · no end date', { date: dateFormat.format(summary.start) })
                      : summary?.end
                        ? ganttT('phaseEndsOn', 'Ends {{date}} · no start date', { date: dateFormat.format(summary.end) })
                        : ganttT('phaseNoDates', 'No phase dates set');
                  const labelInside = Boolean(dates) && bandWidth >= PHASE_LABEL_MIN_WIDTH;
                  // Without a band, anchor the note to whichever date exists, else the row start.
                  const looseLabelLeft = dates
                    ? bandLeft + bandWidth + overrunWidth + 8
                    : summary?.start
                      ? xOf(summary.start)
                      : summary?.end
                        ? Math.max(8, xOf(summary.end) - 160)
                        : 8;
                  return (
                    <div
                      key={`bars-${row.key}`}
                      className="absolute left-0 right-0 border-b border-gray-100 bg-gray-50"
                      style={{ top: rowIndex * ROW_HEIGHT, height: ROW_HEIGHT }}
                    >
                      {dates && (
                        <Tooltip
                          content={
                            <div className="max-w-xs space-y-0.5 text-left">
                              <div className="font-semibold">{row.phase.phase_name}</div>
                              {row.phase.description && <div className="opacity-80">{row.phase.description}</div>}
                              <div>{formatRange(dates.start, dates.end)}</div>
                              {summary && summary.total > 0 && (
                                <div>
                                  {ganttT('phaseProgress', '{{closed}} of {{total}} tasks completed', {
                                    closed: summary.closed,
                                    total: summary.total,
                                  })}
                                </div>
                              )}
                              {overrunWidth > 0 && (
                                <div>
                                  {ganttT('phaseOverrun', 'Finishes after the phase deadline of {{date}}', {
                                    date: dateFormat.format(dates.end),
                                  })}
                                </div>
                              )}
                            </div>
                          }
                        >
                          <div
                            className="absolute overflow-hidden rounded-sm"
                            style={{
                              left: bandLeft,
                              width: bandWidth,
                              top: 5,
                              height: ROW_HEIGHT - 10,
                              backgroundColor: `rgb(${TONE_OPEN} / ${PHASE_TINT})`,
                              boxShadow: `inset 0 0 0 1px rgb(${TONE_OPEN} / 0.45)`,
                            }}
                          >
                            <div
                              className="absolute inset-y-0 left-0"
                              style={{ width: `${percent}%`, backgroundColor: `rgb(${TONE_OPEN} / ${PHASE_DONE_TINT})` }}
                            />
                            {labelInside && (
                              <span className="absolute inset-y-0 left-2 right-2 flex items-center truncate text-xs font-medium text-[rgb(var(--color-text-900))]">
                                <span className="truncate">{label}</span>
                              </span>
                            )}
                          </div>
                        </Tooltip>
                      )}
                      {dates && overrunWidth > 0 && (
                        <Tooltip
                          content={ganttT('phaseOverrun', 'Finishes after the phase deadline of {{date}}', {
                            date: dateFormat.format(dates.end),
                          })}
                        >
                          <div
                            className="absolute rounded-r-sm border border-l-0 border-dashed"
                            style={{
                              left: bandLeft + bandWidth,
                              width: overrunWidth,
                              top: 5,
                              height: ROW_HEIGHT - 10,
                              backgroundColor: `rgb(${TONE_OVERDUE} / 0.14)`,
                              borderColor: `rgb(${TONE_OVERDUE} / 0.6)`,
                            }}
                          />
                        </Tooltip>
                      )}
                      {!labelInside && (
                        <span
                          className={`absolute flex items-center whitespace-nowrap text-xs ${
                            dates ? 'font-medium text-[rgb(var(--color-text-700))]' : 'italic text-gray-500'
                          }`}
                          style={{ left: looseLabelLeft, top: 0, height: ROW_HEIGHT }}
                        >
                          {label}
                        </span>
                      )}
                    </div>
                  );
                }

                const task = row.task!;
                const bar = bars.get(task.task_id);
                const isLinkTarget = link?.targetTaskId === task.task_id;
                const isDragging = drag?.taskId === task.task_id;

                const closed = isTaskClosed(task);
                const inferred = bar ? bar.derivedStart || bar.derivedEnd : false;
                const overdue = bar ? !closed && bar.end < today : false;
                const tone = bar ? toneFor(task, bar) : TONE_OPEN;
                const width = bar ? widthOf(bar.start, bar.end) : 0;
                const progress = taskProgress({ task, closed, checklist: checklistSummary[task.task_id] });
                const critical = criticalPath.taskIds.has(task.task_id);
                const conflict = conflictTaskIds.has(task.task_id);
                const blockers = blockersByTaskId.get(task.task_id);
                const status = statusById.get(task.project_status_mapping_id);
                const assigneeName = task.assigned_to ? userDisplayName(userById.get(task.assigned_to)) : '';
                const estimateHours = Number(task.estimated_hours) > 0 ? Number(task.estimated_hours) / 60 : 0;
                const handleWidth = width >= 28 ? 7 : 4;

                const tooltipContent = bar && (
                  <div className="max-w-xs space-y-0.5 text-left">
                    <div className="font-semibold">{task.task_name}</div>
                    <div>{formatRange(bar.start, bar.end)}</div>
                    {inferred && (
                      <div className="opacity-80">
                        {ganttT('inferredHint', 'Estimated dates. Set a start and due date to fix them.')}
                      </div>
                    )}
                    {status && <div>{ganttT('tooltipStatus', 'Status: {{status}}', { status: status.custom_name || status.name })}</div>}
                    {assigneeName && <div>{ganttT('tooltipAssignee', 'Assignee: {{name}}', { name: assigneeName })}</div>}
                    <div>{ganttT('tooltipProgress', 'Progress: {{percent}}%', { percent: Math.round(progress * 100) })}</div>
                    {estimateHours > 0 && (
                      <div>{ganttT('tooltipEstimate', 'Estimate: {{hours}}h', { hours: Number(estimateHours.toFixed(1)) })}</div>
                    )}
                    {overdue && <div>{ganttT('tooltipOverdue', 'Overdue')}</div>}
                    {blockers && (
                      <div>
                        {ganttT('blockedBy', 'Waiting on: {{tasks}}', {
                          tasks: blockers.map((blocker) => blocker.task_name).join(', '),
                        })}
                      </div>
                    )}
                    {blockedByTaskId.get(task.task_id) && (
                      <div>
                        {ganttT('tooltipBlocks', 'Blocks: {{tasks}}', {
                          tasks: blockedByTaskId.get(task.task_id)!.map((blocked) => blocked.task_name).join(', '),
                        })}
                      </div>
                    )}
                    {conflict && <div>{ganttT('tooltipConflict', 'Starts before a blocking task is due to finish')}</div>}
                    {critical && <div>{ganttT('tooltipCritical', 'On the critical path')}</div>}
                  </div>
                );

                return (
                  <div
                    key={`bars-${row.key}`}
                    data-gantt-task-id={task.task_id}
                    data-gantt-row={task.task_id}
                    className={`group absolute left-0 right-0 border-b border-gray-100 ${
                      isLinkTarget ? 'bg-[rgb(var(--color-primary-100))]' : ''
                    }`}
                    style={{ top: rowIndex * ROW_HEIGHT, height: ROW_HEIGHT }}
                    onMouseEnter={() => setHoveredTaskId(task.task_id)}
                    onMouseLeave={() => setHoveredTaskId(null)}
                  >
                    {bar && (
                      <>
                        <Tooltip content={tooltipContent} delayDuration={300}>
                          <button
                            id={`gantt-bar-${task.task_id}`}
                            data-gantt-bar={task.task_id}
                            data-critical={critical ? '' : undefined}
                            type="button"
                            aria-label={ganttT('barLabel', '{{task}}, {{range}}', {
                              task: task.task_name,
                              range: formatRange(bar.start, bar.end),
                            })}
                            className={`absolute rounded-sm z-[6] overflow-hidden focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-[rgb(var(--color-primary-700))] ${
                              inferred ? 'border border-dashed' : ''
                            } ${editable ? (isDragging ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-pointer'} ${
                              isDragging ? 'shadow-md' : ''
                            }`}
                            style={{
                              left: xOf(bar.start),
                              width,
                              top: ROW_HEIGHT / 2 - BAR_HEIGHT / 2,
                              height: BAR_HEIGHT,
                              backgroundColor: `rgb(${tone})`,
                              borderColor: inferred
                                ? `rgb(${tone === TONE_OPEN ? EDGE_OPEN : tone === TONE_CLOSED ? EDGE_CLOSED : tone})`
                                : undefined,
                              backgroundImage: closed ? CLOSED_DIM : undefined,
                              boxShadow: critical ? CRITICAL_RING : undefined,
                              touchAction: editable ? 'none' : undefined,
                            }}
                            onClick={() => {
                              if (suppressClickRef.current) return;
                              onTaskClick?.(task);
                            }}
                            onKeyDown={(event) => handleBarKeyDown(event, task.task_id)}
                            onPointerDown={(event) => handleBarPointerDown(event, task.task_id, 'move')}
                            onPointerMove={handleBarPointerMove}
                            onPointerUp={handleBarPointerUp}
                            onPointerCancel={handleBarPointerUp}
                          >
                            {/* A completed bar is already its own colour; shading it would only darken it. */}
                            {!closed && progress > 0 && (
                              <span
                                className="absolute inset-y-0 left-0"
                                style={{
                                  width: `${Math.round(progress * 100)}%`,
                                  backgroundColor: PROGRESS_SHADE,
                                  borderRight: progress < 1 ? PROGRESS_TICK : undefined,
                                }}
                              />
                            )}
                            {inferred && (
                              <span
                                className="absolute inset-0"
                                style={{
                                  backgroundImage:
                                    'repeating-linear-gradient(45deg, rgb(var(--color-card) / 0.5) 0 3px, transparent 3px 7px)',
                                }}
                              />
                            )}
                            {editable && (
                              <>
                                <span
                                  className="absolute inset-y-0 left-0 cursor-ew-resize"
                                  style={{ width: handleWidth }}
                                  onPointerDown={(event) => handleBarPointerDown(event, task.task_id, 'resize-start')}
                                  onPointerMove={handleBarPointerMove}
                                  onPointerUp={handleBarPointerUp}
                                  onPointerCancel={handleBarPointerUp}
                                />
                                <span
                                  className="absolute inset-y-0 right-0 cursor-ew-resize"
                                  style={{ width: handleWidth }}
                                  onPointerDown={(event) => handleBarPointerDown(event, task.task_id, 'resize-end')}
                                  onPointerMove={handleBarPointerMove}
                                  onPointerUp={handleBarPointerUp}
                                  onPointerCancel={handleBarPointerUp}
                                />
                              </>
                            )}
                          </button>
                        </Tooltip>

                        {isDragging && (
                          <span
                            className="absolute z-[8] whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-medium text-[rgb(var(--color-text-50))] bg-[rgb(var(--color-text-800))] dark:bg-[rgb(var(--color-border-100))] dark:text-[rgb(var(--color-text-900))] pointer-events-none"
                            style={{ left: xOf(bar.start) + width + 8, top: ROW_HEIGHT / 2 - 10 }}
                          >
                            {formatRange(bar.start, bar.end)}
                          </span>
                        )}

                        {linkable && !isDragging && (
                          <span
                            role="presentation"
                            title={ganttT('linkHandle', 'Drag to a task that must wait for this one')}
                            className={`absolute z-[7] h-3 w-3 rounded-full border-2 bg-white cursor-crosshair transition-opacity ${
                              link?.fromTaskId === task.task_id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                            }`}
                            style={{
                              left: xOf(bar.start) + width + 3,
                              top: ROW_HEIGHT / 2 - 6,
                              borderColor: 'rgb(var(--color-primary-500))',
                              touchAction: 'none',
                            }}
                            onPointerDown={(event) => handleLinkPointerDown(event, task.task_id)}
                            onPointerMove={handleLinkPointerMove}
                            onPointerUp={handleLinkPointerUp}
                            onPointerCancel={() => setLink(null)}
                          />
                        )}
                      </>
                    )}
                  </div>
                );
              })}

              {/* Dependency arrows sit under the bars, so a line never cuts across a bar. */}
              {arrows.length > 0 && (
                <svg
                  className="absolute top-0 left-0 pointer-events-none z-[5] text-[rgb(var(--color-text-700))]"
                  width={chartWidth}
                  height={bodyHeight}
                >
                  <defs>
                    <marker id="gantt-arrowhead" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto" markerUnits="userSpaceOnUse">
                      <path d="M0,0 L9,4.5 L0,9 Z" fill="currentColor" />
                    </marker>
                    <marker id="gantt-arrowhead-violated" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto" markerUnits="userSpaceOnUse">
                      <path d="M0,0 L9,4.5 L0,9 Z" fill={`rgb(${TONE_OVERDUE})`} />
                    </marker>
                    <marker id="gantt-arrowhead-critical" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto" markerUnits="userSpaceOnUse">
                      <path d="M0,0 L9,4.5 L0,9 Z" fill={CRITICAL_COLOR} />
                    </marker>
                  </defs>
                  {arrows.map((arrow) => {
                    const related = arrow.kind === 'related';
                    const marker = arrow.violated ? 'violated' : arrow.critical ? 'critical' : null;
                    const color = arrow.violated
                      ? `rgb(${TONE_OVERDUE})`
                      : arrow.critical
                        ? CRITICAL_COLOR
                        : related
                          ? RELATED_COLOR
                          : 'currentColor';
                    const selected = selectedEdge?.dependencyId === arrow.key;
                    return (
                      <g key={arrow.key} data-gantt-edge-group="">
                        <path
                          data-gantt-edge=""
                          data-edge-id={arrow.key}
                          d={arrow.d}
                          fill="none"
                          stroke={color}
                          strokeWidth={selected ? 3 : arrow.critical ? 2 : 1.5}
                          strokeDasharray={related ? '5 3' : undefined}
                          markerEnd={related ? undefined : `url(#gantt-arrowhead${marker ? `-${marker}` : ''})`}
                        />
                        {/* Dot where the line leaves its source, so direction reads at both ends. */}
                        <circle data-gantt-edge="" data-edge-id={arrow.key} cx={arrow.x1} cy={arrow.y1} r={2.5} fill={color} />
                        {/* Wide invisible stroke: a 1.5px line is too thin a click target. */}
                        <path
                          id={`gantt-edge-${arrow.key}`}
                          d={arrow.d}
                          fill="none"
                          stroke="transparent"
                          strokeWidth={12}
                          style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
                          onClick={(event) => {
                            const rect = chartRef.current?.getBoundingClientRect();
                            if (!rect) return;
                            setSelectedEdge({
                              dependencyId: arrow.key,
                              x: event.clientX - rect.left,
                              y: event.clientY - rect.top,
                            });
                          }}
                        />
                      </g>
                    );
                  })}
                </svg>
              )}

              {/* The link being drawn stays above the bars so it is visible over its target. */}
              {link && linkSource !== undefined && (
                <svg className="absolute top-0 left-0 pointer-events-none z-[7]" width={chartWidth} height={bodyHeight} aria-hidden>
                  <defs>
                    <marker id="gantt-arrowhead-link" markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto" markerUnits="userSpaceOnUse">
                      <path d="M0,0 L9,4.5 L0,9 Z" fill="rgb(var(--color-primary-500))" />
                    </marker>
                  </defs>
                  <path
                    d={`M ${link.x1} ${linkSource * ROW_HEIGHT + ROW_HEIGHT / 2} L ${link.x2} ${link.y2}`}
                    fill="none"
                    stroke="rgb(var(--color-primary-500))"
                    strokeWidth={2}
                    strokeDasharray={link.targetTaskId ? undefined : '4 3'}
                    markerEnd="url(#gantt-arrowhead-link)"
                  />
                </svg>
              )}

              {selectedArrow && selectedEdge && (
                <Popover open onOpenChange={(open) => !open && setSelectedEdge(null)}>
                  <PopoverAnchor asChild>
                    <span className="absolute h-px w-px" style={{ left: selectedEdge.x, top: selectedEdge.y }} />
                  </PopoverAnchor>
                  <PopoverContent side="top" align="center" className="w-72 p-3">
                    <div className="flex items-center gap-2 pb-1.5 text-sm font-semibold text-[rgb(var(--color-text-900))]">
                      <span
                        className={`inline-block w-5 border-t-2 ${selectedArrow.kind === 'related' ? 'border-dashed' : ''}`}
                        style={{
                          borderColor:
                            selectedArrow.kind === 'related'
                              ? RELATED_COLOR
                              : selectedArrow.violated
                                ? `rgb(${TONE_OVERDUE})`
                                : 'rgb(var(--color-text-700))',
                        }}
                      />
                      {selectedArrow.kind === 'related'
                        ? ganttT('edgeRelatedTitle', 'Related tasks')
                        : ganttT('edgeBlockingTitle', 'Blocking dependency')}
                    </div>
                    <p className="text-sm text-gray-600">
                      {selectedArrow.kind === 'related'
                        ? ganttT('edgeRelatedText', '"{{from}}" and "{{to}}" are related. This does not affect dates.', {
                            from: taskById.get(selectedArrow.predecessorTaskId)?.task_name ?? '',
                            to: taskById.get(selectedArrow.successorTaskId)?.task_name ?? '',
                          })
                        : ganttT('edgeBlockingText', '"{{from}}" must finish before "{{to}}" can start.', {
                            from: taskById.get(selectedArrow.predecessorTaskId)?.task_name ?? '',
                            to: taskById.get(selectedArrow.successorTaskId)?.task_name ?? '',
                          })}
                    </p>
                    {selectedArrow.violated && (
                      <p className="mt-1 text-sm" style={{ color: `rgb(${TONE_OVERDUE})` }}>
                        {ganttT('edgeConflictText', 'The current dates conflict with this dependency.')}
                      </p>
                    )}
                    {canEdit && onRemoveDependency && (
                      <div className="mt-3 flex justify-end">
                        <Button
                          id="gantt-remove-dependency"
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            const dependencyId = selectedArrow.key;
                            setSelectedEdge(null);
                            void onRemoveDependency(dependencyId);
                          }}
                        >
                          <Unlink className="h-4 w-4 mr-2" />
                          {ganttT('removeDependency', 'Remove dependency')}
                        </Button>
                      </div>
                    )}
                  </PopoverContent>
                </Popover>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProjectGanttView;
