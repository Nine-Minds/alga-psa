'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { IProjectPhase, IProjectTask, ProjectStatus } from '@alga-psa/types';
import { Button } from '@alga-psa/ui/components/Button';
import { Switch } from '@alga-psa/ui/components/Switch';
import ViewSwitcher from '@alga-psa/ui/components/ViewSwitcher';
import { Ban, CalendarClock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  addDays,
  collectGanttEdges,
  diffInDays,
  findViolatedEdges,
  ganttDomain,
  MIN_DOMAIN_DAYS,
  scheduleGanttBars,
  startOfDay,
  type GanttBar,
  type GanttEdge,
  type TaskDependencyMap,
} from '../lib/ganttSchedule';

const LEFT_COLUMN_WIDTH = 300;
const ROW_HEIGHT = 34;
const BAR_HEIGHT = 16;
const HEADER_BAND_HEIGHT = 24;
const HEADER_HEIGHT = HEADER_BAND_HEIGHT * 2;
/** Horizontal stub an arrow travels before it turns. */
const ARROW_STUB = 10;

type GanttZoom = 'day' | 'week' | 'month';

const DAY_WIDTH: Record<GanttZoom, number> = { day: 32, week: 11, month: 4 };

interface GanttRow {
  key: string;
  kind: 'phase' | 'task';
  phase: IProjectPhase;
  task?: IProjectTask;
  bar?: GanttBar;
  /** Phase rows summarise their tasks' span. */
  span?: { start: Date; end: Date };
}

export interface ProjectGanttViewProps {
  phases: IProjectPhase[];
  tasks: IProjectTask[];
  statuses: ProjectStatus[];
  /** Status mappings are phase-specific; falls back to `statuses`. */
  statusesByPhase?: Record<string, ProjectStatus[]>;
  taskDependencies: TaskDependencyMap;
  onTaskClick?: (task: IProjectTask) => void;
}

interface TimeAxis {
  majors: { key: string; x: number; width: number; label: string }[];
  minors: { key: string; x: number; width: number; label: string; isWeekend: boolean }[];
}

function buildTimeAxis(domainStart: Date, domainEnd: Date, zoom: GanttZoom, locale: string): TimeAxis {
  const dayWidth = DAY_WIDTH[zoom];
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

/**
 * Finish-to-start elbow. A successor that starts left of its predecessor's end
 * cannot be reached by a straight run, so the path drops into the gutter
 * between the two rows and doubles back.
 */
function edgePath(x1: number, y1: number, x2: number, y2: number): string {
  if (x2 >= x1 + ARROW_STUB * 2) {
    return `M ${x1} ${y1} H ${x1 + ARROW_STUB} V ${y2} H ${x2}`;
  }
  const gutterY = y1 + (y2 >= y1 ? ROW_HEIGHT / 2 : -ROW_HEIGHT / 2);
  return `M ${x1} ${y1} H ${x1 + ARROW_STUB} V ${gutterY} H ${x2 - ARROW_STUB} V ${y2} H ${x2}`;
}

export const ProjectGanttView: React.FC<ProjectGanttViewProps> = ({
  phases,
  tasks,
  statuses,
  statusesByPhase = {},
  taskDependencies,
  onTaskClick,
}) => {
  const { t, i18n } = useTranslation(['features/projects', 'common']);
  const ganttT = useCallback(
    (key: string, fallback: string, options?: Record<string, unknown>) =>
      t(`gantt.${key}`, { defaultValue: fallback, ...(options ?? {}) }),
    [t],
  );

  const [zoom, setZoom] = useState<GanttZoom>('week');
  const [showBlocking, setShowBlocking] = useState(true);
  const [showRelated, setShowRelated] = useState(true);
  const [hoveredTaskId, setHoveredTaskId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const hasCenteredRef = useRef(false);
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

  const today = useMemo(() => startOfDay(new Date()), []);
  const dayWidth = DAY_WIDTH[zoom];

  const edges = useMemo<GanttEdge[]>(() => collectGanttEdges(taskDependencies), [taskDependencies]);
  const bars = useMemo(
    () => scheduleGanttBars({ tasks, phases, edges, today }),
    [tasks, phases, edges, today],
  );
  const violatedEdges = useMemo(() => findViolatedEdges(edges, bars), [edges, bars]);
  const contentDomain = useMemo(() => ganttDomain(bars, today), [bars, today]);
  const domain = useMemo(() => {
    const available = Math.max(0, viewportWidth - LEFT_COLUMN_WIDTH);
    const daysToFill = Math.max(MIN_DOMAIN_DAYS, Math.ceil(available / dayWidth));
    const span = diffInDays(contentDomain.start, contentDomain.end) + 1;
    if (span >= daysToFill) return contentDomain;
    return { start: contentDomain.start, end: addDays(contentDomain.start, daysToFill - 1) };
  }, [contentDomain, viewportWidth, dayWidth]);

  const closedStatusIds = useMemo(() => {
    const byPhase = new Map<string, Set<string>>();
    for (const phase of phases) {
      const phaseStatuses = statusesByPhase[phase.phase_id] ?? statuses;
      byPhase.set(
        phase.phase_id,
        new Set(phaseStatuses.filter((s) => s.is_closed).map((s) => s.project_status_mapping_id)),
      );
    }
    return byPhase;
  }, [phases, statuses, statusesByPhase]);

  const isTaskClosed = useCallback(
    (task: IProjectTask) =>
      closedStatusIds.get(task.phase_id)?.has(task.project_status_mapping_id) ?? false,
    [closedStatusIds],
  );

  const rows = useMemo<GanttRow[]>(() => {
    const orderedPhases = [...phases].sort((a, b) => (a.order_number ?? 0) - (b.order_number ?? 0));
    const built: GanttRow[] = [];

    for (const phase of orderedPhases) {
      const phaseTasks = tasks
        .filter((task) => task.phase_id === phase.phase_id)
        .sort((a, b) => {
          const barA = bars.get(a.task_id);
          const barB = bars.get(b.task_id);
          const byStart = (barA?.start.getTime() ?? 0) - (barB?.start.getTime() ?? 0);
          return byStart !== 0 ? byStart : (a.wbs_code || '').localeCompare(b.wbs_code || '');
        });

      let span: GanttRow['span'];
      for (const task of phaseTasks) {
        const bar = bars.get(task.task_id);
        if (!bar) continue;
        span = span
          ? { start: bar.start < span.start ? bar.start : span.start, end: bar.end > span.end ? bar.end : span.end }
          : { start: bar.start, end: bar.end };
      }

      built.push({ key: `phase-${phase.phase_id}`, kind: 'phase', phase, span });
      for (const task of phaseTasks) {
        built.push({ key: `task-${task.task_id}`, kind: 'task', phase, task, bar: bars.get(task.task_id) });
      }
    }

    return built;
  }, [phases, tasks, bars]);

  const rowIndexByTaskId = useMemo(() => {
    const map = new Map<string, number>();
    rows.forEach((row, index) => {
      if (row.task) map.set(row.task.task_id, index);
    });
    return map;
  }, [rows]);

  /** Tasks whose blocking predecessor has not reached a closed status. */
  const blockedTaskIds = useMemo(() => {
    const taskById = new Map(tasks.map((task) => [task.task_id, task]));
    const blocked = new Set<string>();
    for (const edge of edges) {
      if (edge.kind !== 'blocks') continue;
      const predecessor = taskById.get(edge.predecessorTaskId);
      if (predecessor && !isTaskClosed(predecessor)) blocked.add(edge.successorTaskId);
    }
    return blocked;
  }, [edges, tasks, isTaskClosed]);

  const chartWidth = Math.max(1, (diffInDays(domain.start, domain.end) + 1) * dayWidth);
  const bodyHeight = rows.length * ROW_HEIGHT;
  const axis = useMemo(
    () => buildTimeAxis(domain.start, domain.end, zoom, i18n.language || 'en'),
    [domain.start, domain.end, zoom, i18n.language],
  );

  const xOf = useCallback((date: Date) => diffInDays(domain.start, date) * dayWidth, [domain.start, dayWidth]);
  const todayX = today >= domain.start && today <= domain.end ? xOf(today) + dayWidth / 2 : null;

  const scrollToToday = useCallback(() => {
    const container = scrollRef.current;
    if (!container || todayX === null) return;
    container.scrollLeft = Math.max(0, todayX - (container.clientWidth - LEFT_COLUMN_WIDTH) / 2);
  }, [todayX]);

  // Centre on today once the first schedule lands, then leave scrolling alone.
  useEffect(() => {
    if (hasCenteredRef.current || rows.length === 0) return;
    hasCenteredRef.current = true;
    scrollToToday();
  }, [rows.length, scrollToToday]);

  const dateFormat = useMemo(
    () => new Intl.DateTimeFormat(i18n.language || 'en', { month: 'short', day: 'numeric', year: 'numeric' }),
    [i18n.language],
  );

  const arrows = useMemo(() => {
    return edges.flatMap((edge) => {
      if (edge.kind === 'blocks' ? !showBlocking : !showRelated) return [];
      const fromRow = rowIndexByTaskId.get(edge.predecessorTaskId);
      const toRow = rowIndexByTaskId.get(edge.successorTaskId);
      const fromBar = bars.get(edge.predecessorTaskId);
      const toBar = bars.get(edge.successorTaskId);
      if (fromRow === undefined || toRow === undefined || !fromBar || !toBar) return [];

      const x1 = xOf(fromBar.end) + dayWidth;
      const y1 = fromRow * ROW_HEIGHT + ROW_HEIGHT / 2;
      const x2 = xOf(toBar.start);
      const y2 = toRow * ROW_HEIGHT + ROW_HEIGHT / 2;

      return [{
        key: edge.dependencyId,
        kind: edge.kind,
        d: edgePath(x1, y1, x2, y2),
        violated: violatedEdges.has(edge.dependencyId),
        touchesHovered:
          hoveredTaskId === edge.predecessorTaskId || hoveredTaskId === edge.successorTaskId,
      }];
    });
  }, [showBlocking, showRelated, edges, rowIndexByTaskId, bars, xOf, dayWidth, violatedEdges, hoveredTaskId]);

  const zoomOptions = useMemo(
    () => [
      { value: 'day' as GanttZoom, label: ganttT('zoomDay', 'Day'), id: 'gantt-zoom-day' },
      { value: 'week' as GanttZoom, label: ganttT('zoomWeek', 'Week'), id: 'gantt-zoom-week' },
      { value: 'month' as GanttZoom, label: ganttT('zoomMonth', 'Month'), id: 'gantt-zoom-month' },
    ],
    [ganttT],
  );

  if (rows.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-500">
        {ganttT('empty', 'No phases or tasks to place on the timeline yet.')}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3 flex-shrink-0">
        <div className="flex items-center gap-3">
          <ViewSwitcher
            currentView={zoom}
            onChange={(value) => setZoom(value as GanttZoom)}
            options={zoomOptions}
            aria-label={ganttT('zoomLabel', 'Timeline scale')}
          />
          <Button id="gantt-today-button" variant="outline" size="sm" onClick={scrollToToday}>
            <CalendarClock className="h-4 w-4 mr-2" />
            {ganttT('today', 'Today')}
          </Button>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Switch
              id="gantt-show-blocking"
              checked={showBlocking}
              onCheckedChange={setShowBlocking}
              size="sm"
            />
            <label htmlFor="gantt-show-blocking" className="text-sm text-gray-700">
              {ganttT('showBlocking', 'Blocking')}
            </label>
          </div>
          <div className="flex items-center gap-2">
            <Switch
              id="gantt-show-related"
              checked={showRelated}
              onCheckedChange={setShowRelated}
              size="sm"
            />
            <label htmlFor="gantt-show-related" className="text-sm text-gray-700">
              {ganttT('showRelated', 'Related')}
            </label>
          </div>
          <div className="flex items-center gap-3 text-xs text-gray-500">
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-6 h-2 rounded-sm bg-[rgb(var(--color-primary-500))]" />
              {ganttT('legendScheduled', 'Scheduled')}
            </span>
            <span className="flex items-center gap-1.5">
              <span
                className="inline-block w-6 h-2 rounded-sm border border-dashed border-gray-400"
                style={{
                  backgroundImage:
                    'repeating-linear-gradient(45deg, rgb(var(--color-primary-200)) 0 3px, transparent 3px 6px)',
                }}
              />
              {ganttT('legendInferred', 'Inferred from dependencies')}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-6 h-0.5 bg-red-500" />
              {ganttT('legendViolated', 'Order conflict')}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-6 border-t border-dotted border-gray-400" />
              {ganttT('legendRelated', 'Related (not scheduled)')}
            </span>
          </div>
        </div>
      </div>

      <div
        ref={scrollRef}
        className="relative flex-1 min-h-0 overflow-auto border border-gray-200 rounded-md bg-white"
      >
        <div style={{ width: LEFT_COLUMN_WIDTH + chartWidth, minWidth: '100%' }}>
          {/* Header: month/year band over day/week/month ticks */}
          <div className="sticky top-0 z-20 flex bg-white border-b border-gray-200" style={{ height: HEADER_HEIGHT }}>
            <div
              className="sticky left-0 z-10 flex items-end px-3 pb-1 bg-white border-r border-gray-200 text-xs font-medium text-gray-500"
              style={{ width: LEFT_COLUMN_WIDTH, minWidth: LEFT_COLUMN_WIDTH }}
            >
              {ganttT('taskColumn', 'Phase / Task')}
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
                const isBlocked = row.task ? blockedTaskIds.has(row.task.task_id) : false;
                return (
                  <div
                    key={row.key}
                    className={`flex items-center gap-2 px-3 border-b border-gray-100 cursor-default ${
                      row.kind === 'phase' ? 'bg-gray-50 font-medium text-gray-700' : 'text-gray-600'
                    } ${hoveredTaskId && row.task?.task_id === hoveredTaskId ? 'bg-[rgb(var(--color-primary-50))]' : ''}`}
                    style={{ height: ROW_HEIGHT, paddingLeft: row.kind === 'task' ? 24 : 12 }}
                    onMouseEnter={() => setHoveredTaskId(row.task?.task_id ?? null)}
                    onMouseLeave={() => setHoveredTaskId(null)}
                  >
                    {isBlocked && (
                      <Ban
                        className="h-3.5 w-3.5 text-orange-500 flex-shrink-0"
                        aria-label={ganttT('blockedHint', 'Waiting on an open blocking task')}
                      />
                    )}
                    {row.kind === 'phase' ? (
                      <span className="truncate text-sm">{row.phase.phase_name}</span>
                    ) : (
                      <button
                        id={`gantt-task-label-${row.task!.task_id}`}
                        type="button"
                        className="truncate text-sm text-left hover:text-[rgb(var(--color-primary-600))] hover:underline"
                        onClick={() => onTaskClick?.(row.task!)}
                        title={row.task!.task_name}
                      >
                        {row.task!.task_name}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="relative" style={{ width: chartWidth }}>
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
                  className="absolute top-0 bottom-0 border-l-2 border-dashed border-red-400 z-[5]"
                  style={{ left: todayX }}
                  aria-hidden
                />
              )}

              {/* Rows and bars */}
              {rows.map((row, rowIndex) => {
                const span = row.kind === 'phase' ? row.span : undefined;
                const bar = row.bar;
                const isHovered = hoveredTaskId && row.task?.task_id === hoveredTaskId;

                return (
                  <div
                    key={`bars-${row.key}`}
                    className={`absolute left-0 right-0 border-b border-gray-100 ${
                      row.kind === 'phase' ? 'bg-gray-50/60' : ''
                    } ${isHovered ? 'bg-[rgb(var(--color-primary-50))]/60' : ''}`}
                    style={{ top: rowIndex * ROW_HEIGHT, height: ROW_HEIGHT }}
                    onMouseEnter={() => setHoveredTaskId(row.task?.task_id ?? null)}
                    onMouseLeave={() => setHoveredTaskId(null)}
                  >
                    {span && (
                      <div
                        className="absolute rounded-sm bg-gray-400/70"
                        style={{
                          left: xOf(span.start),
                          width: Math.max(dayWidth, (diffInDays(span.start, span.end) + 1) * dayWidth),
                          top: ROW_HEIGHT / 2 - 3,
                          height: 6,
                        }}
                        title={`${row.phase.phase_name}: ${dateFormat.format(span.start)} – ${dateFormat.format(span.end)}`}
                      />
                    )}

                    {bar && row.task && (() => {
                      const task = row.task;
                      const closed = isTaskClosed(task);
                      const inferred = bar.derivedStart || bar.derivedEnd;
                      const overdue = !closed && bar.end < today;
                      const width = Math.max(dayWidth, (diffInDays(bar.start, bar.end) + 1) * dayWidth);
                      const tone = closed
                        ? 'rgb(var(--color-secondary-500))'
                        : overdue
                          ? 'rgb(239 68 68)'
                          : 'rgb(var(--color-primary-500))';

                      return (
                        <button
                          id={`gantt-bar-${task.task_id}`}
                          type="button"
                          className={`absolute rounded-sm z-[6] transition-shadow ${
                            inferred ? 'border border-dashed' : ''
                          } ${isHovered ? 'ring-2 ring-offset-1 ring-[rgb(var(--color-primary-400))]' : ''}`}
                          style={{
                            left: xOf(bar.start),
                            width,
                            top: ROW_HEIGHT / 2 - BAR_HEIGHT / 2,
                            height: BAR_HEIGHT,
                            backgroundColor: inferred ? 'transparent' : tone,
                            borderColor: inferred ? tone : undefined,
                            backgroundImage: inferred
                              ? `repeating-linear-gradient(45deg, ${tone} 0 3px, transparent 3px 7px)`
                              : undefined,
                            opacity: closed ? 0.65 : 1,
                          }}
                          onClick={() => onTaskClick?.(task)}
                          title={[
                            task.task_name,
                            `${dateFormat.format(bar.start)} – ${dateFormat.format(bar.end)}`,
                            inferred
                              ? ganttT('inferredHint', 'Dates inferred from dependencies and estimate')
                              : '',
                          ]
                            .filter(Boolean)
                            .join('\n')}
                        />
                      );
                    })()}
                  </div>
                );
              })}

              {/* Dependency arrows */}
              {arrows.length > 0 && (
                <svg
                  className="absolute top-0 left-0 pointer-events-none z-[7]"
                  width={chartWidth}
                  height={bodyHeight}
                  aria-hidden
                >
                  <defs>
                    <marker id="gantt-arrowhead" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                      <path d="M0,0 L6,3 L0,6 Z" fill="rgb(107 114 128)" />
                    </marker>
                    <marker id="gantt-arrowhead-violated" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                      <path d="M0,0 L6,3 L0,6 Z" fill="rgb(239 68 68)" />
                    </marker>
                  </defs>
                  {arrows.map((arrow) => {
                    const related = arrow.kind === 'related';
                    return (
                      <path
                        key={arrow.key}
                        d={arrow.d}
                        fill="none"
                        stroke={arrow.violated ? 'rgb(239 68 68)' : related ? 'rgb(156 163 175)' : 'rgb(107 114 128)'}
                        strokeWidth={arrow.touchesHovered ? 2 : 1}
                        strokeDasharray={related ? '2 3' : undefined}
                        strokeOpacity={
                          hoveredTaskId && !arrow.touchesHovered ? 0.2 : related ? 0.55 : 0.85
                        }
                        markerEnd={
                          related
                            ? undefined
                            : `url(#${arrow.violated ? 'gantt-arrowhead-violated' : 'gantt-arrowhead'})`
                        }
                      />
                    );
                  })}
                </svg>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProjectGanttView;
