'use client';

import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { momentLocalizer, SlotInfo, View, type EventProps, type ToolbarProps } from 'react-big-calendar';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@alga-psa/ui/components/Button';
import ViewSwitcher from '@alga-psa/ui/components/ViewSwitcher';
import moment from 'moment';
import CalendarSkeleton from '@alga-psa/ui/components/skeletons/CalendarSkeleton';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { WorkItemScheduleContext } from '@alga-psa/ui/context';
import WorkItemEntryEditor, { type WorkItemEntryTarget } from './WorkItemEntryEditor';
import { CalendarStyleProvider } from './CalendarStyleProvider';
import { AgentScheduleDrawerStyles } from './AgentScheduleDrawerStyles';
import toast from 'react-hot-toast';
import { getScheduleEntries, updateScheduleEntry } from '@alga-psa/scheduling/actions';
import type { IScheduleEntry, WorkItemType } from '@alga-psa/types';
import { isSourceOwnedWorkItemType } from '../../lib/entryOwnedWorkItems';
import { droppedEntryDates, movedEntryUpdate, resizedEntryDates } from '../../lib/entryMoves';
import { useScheduleViewer } from '../../hooks/useScheduleViewer';
import { useUsers } from '@alga-psa/user-composition/hooks';
import { hasAllDayDates } from '../../lib/calendarDateDisplay';
import {
  WORK_ITEM_ENTRY_DEFAULT_DURATION_MS,
  slotFromCalendarSelection,
} from '../../lib/workItemScheduling';

const DynamicBigCalendar = dynamic(() => import('./DynamicBigCalendar'), {
  loading: () => <CalendarSkeleton height="100%" view="week" showSidebar={false} />,
  ssr: false,
});

const localizer = momentLocalizer(moment);

const workItemColors: Record<WorkItemType, string> = {
  ticket: 'rgb(var(--color-primary-200))',
  project_task: 'rgb(var(--color-secondary-100))',
  non_billable_category: 'rgb(var(--color-event-non-billable))',
  ad_hoc: 'rgb(var(--color-border-200))',
  interaction: 'rgb(var(--color-event-interaction))',
  appointment_request: 'rgb(var(--color-event-appointment))',
  opportunity_step: 'rgb(var(--color-event-opportunity))',
};

/**
 * Chip content for the narrow drawer columns: the title only (the grid
 * already shows the time), wrapping to at most two lines. The full title is
 * in the chip's tooltip.
 */
const CHIP_TWO_LINE_MINUTES = 45;

function AgentScheduleEventChip({ event, title }: EventProps<IScheduleEntry>) {
  const minutes = (new Date(event.scheduled_end).getTime() - new Date(event.scheduled_start).getTime()) / 60000;
  const lines = minutes >= CHIP_TWO_LINE_MINUTES ? 'two' : 'one';
  return <div className={`agent-schedule-chip__title agent-schedule-chip__title--${lines}`}>{title}</div>;
}

interface AgentScheduleViewProps {
  agentId: string;
  /**
   * Present when the drawer was opened from a work item (e.g. a ticket). Its
   * presence is what enables slot selection and scopes a new entry to that
   * work item; the read-only interaction view omits it.
   */
  workItemContext?: WorkItemScheduleContext;
}

const AgentScheduleView: React.FC<AgentScheduleViewProps> = ({ agentId, workItemContext }) => {
  const { t } = useTranslation('msp/schedule');
  const [events, setEvents] = useState<IScheduleEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [date, setDate] = useState(new Date());
  const [view, setView] = useState<View>('week');
  const [editorTarget, setEditorTarget] = useState<WorkItemEntryTarget | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const calendarRef = useRef<HTMLDivElement>(null);
  const [hasScrolled, setHasScrolled] = useState(false);
  const { users = [] } = useUsers();
  const agent = users.find((user) => user.user_id === agentId);
  const agentName = agent ? `${agent.first_name ?? ''} ${agent.last_name ?? ''}`.trim() : '';

  const viewer = useScheduleViewer(
    t('agentView.errors.loadPermissions', { defaultValue: 'Failed to load user permissions' })
  );
  const { currentUserId, loaded: permissionsLoaded, canModifySchedule } = viewer;
  const canViewAgent = viewer.canViewAgent(agentId);

  const belongsToWorkItem = (event: IScheduleEntry) =>
    Boolean(workItemContext) && event.work_item_id === workItemContext?.workItemId;
  const hasAllDayEvents = events.some((event) => hasAllDayDates(event));
  const hasOtherWork = Boolean(workItemContext) && events.some((event) => !belongsToWorkItem(event));

  // Creating an entry from a slot assigns it to the viewed agent, which needs
  // user_schedule:update. Without it the drawer stays the read-only view it was
  // before, so a user lacking the permission never gets a slot picker that
  // would only fail on save.
  const canCreateFromSlot = Boolean(workItemContext) && canModifySchedule;

  const dateRange = useMemo(() => {
    const start = moment(date).startOf(view === 'day' ? 'day' : view === 'week' ? 'week' : 'month').toDate();
    const end = moment(date).endOf(view === 'day' ? 'day' : view === 'week' ? 'week' : 'month').toDate();
    return { start, end };
  }, [date, view]);

  useEffect(() => {
    if (viewer.error) setError(viewer.error);
  }, [viewer.error]);

  useEffect(() => {
    let active = true;
    const loadEntries = async () => {
      setIsLoading(true);
      setError(null);

      if (!currentUserId || !permissionsLoaded) {
        return;
      }

      if (!canViewAgent) {
        setEvents([]);
        setIsLoading(false);
        setError(t('agentView.errors.forbidden', {
          defaultValue: 'You do not have permission to view this schedule.',
        }));
        return;
      }

      const result = await getScheduleEntries(dateRange.start, dateRange.end, [agentId]);
      if (!active) return;
      if (result.success) {
        setEvents(result.entries);
      } else {
        setEvents([]);
        setError(result.error);
      }
      setIsLoading(false);
    };

    loadEntries();

    return () => {
      active = false;
    };
  }, [agentId, canViewAgent, currentUserId, permissionsLoaded, dateRange.end, dateRange.start, refreshKey, t]);

  // First paint lands on this work item's first entry, or the working day
  // when it has none in view, so the dispatcher's target is at the top.
  // Measured from the gutter rows rather than a fixed pixel guess, which
  // drifted with the row height.
  useEffect(() => {
    if (hasScrolled || isLoading || !calendarRef.current || (view !== 'day' && view !== 'week')) return;
    const timeContent = calendarRef.current.querySelector('.rbc-time-content') as HTMLElement | null;
    const gutterRows = calendarRef.current.querySelectorAll('.rbc-time-gutter .rbc-timeslot-group');
    if (!timeContent || gutterRows.length === 0) return;

    const ownEntryHours = events
      .filter((event) => belongsToWorkItem(event) && !hasAllDayDates(event))
      .map((event) => new Date(event.scheduled_start).getHours());
    const targetHour = Math.min(8, ...ownEntryHours);
    const row = gutterRows[Math.min(targetHour, gutterRows.length - 1)] as HTMLElement;
    timeContent.scrollTop = row.offsetTop;
    setHasScrolled(true);
  }, [events, hasScrolled, isLoading, view]);

  const handleSelectEvent = (event: IScheduleEntry) => {
    setEditorTarget({ kind: 'edit', event });
  };

  const handleSelectSlot = (slotInfo: SlotInfo) => {
    if (!workItemContext) return;
    const slot = slotFromCalendarSelection(slotInfo, view, {
      durationMs: WORK_ITEM_ENTRY_DEFAULT_DURATION_MS,
    });
    // The viewed agent is the assignee, so an entry created from their drawer
    // lands on the calendar the user is looking at.
    setEditorTarget({ kind: 'create', slot, assigneeIds: [agentId] });
  };

  const closeEditor = () => setEditorTarget(null);
  const refreshEntries = () => setRefreshKey((value) => value + 1);

  // Moving and resizing on the grid edit the viewed agent's own entries in
  // place. Source-owned entries (deal steps) mirror another record, so the
  // grid leaves them alone, as the main calendar does.
  const canMoveOnGrid = (event: IScheduleEntry) =>
    canModifySchedule &&
    !isSourceOwnedWorkItemType(event?.work_item_type) &&
    Boolean(event?.assigned_user_ids?.includes(agentId));

  const replaceEventLocally = (updated: IScheduleEntry) =>
    setEvents((current) => current.map((entry) => (entry.entry_id === updated.entry_id ? updated : entry)));

  const persistMove = async (
    event: IScheduleEntry,
    dates: { scheduled_start: Date; scheduled_end: Date; is_all_day?: boolean }
  ) => {
    const updated = movedEntryUpdate(event, dates);
    replaceEventLocally(updated);
    try {
      const result = await updateScheduleEntry(event.entry_id, updated);
      if (!result.success) {
        replaceEventLocally(event);
        toast.error(result.error || t('agentView.errors.moveFailed', { defaultValue: 'Failed to move schedule entry' }));
        return;
      }
      if (result.entry?.recurrence_pattern || event.recurrence_pattern) {
        refreshEntries();
      }
      workItemContext?.onScheduled?.();
    } catch (err) {
      console.error('Failed to move schedule entry:', err);
      replaceEventLocally(event);
      toast.error(t('agentView.errors.moveFailed', { defaultValue: 'Failed to move schedule entry' }));
    }
  };

  const handleEventDrop = ({ event, start, end, isAllDay }: { event: object; start: Date | string; end: Date | string; isAllDay?: boolean }) => {
    const entry = event as IScheduleEntry;
    if (!canMoveOnGrid(entry)) return;
    return persistMove(entry, droppedEntryDates(entry, { start: new Date(start), end: new Date(end), isAllDay }));
  };

  const handleEventResize = ({ event, start, end }: { event: object; start: Date | string; end: Date | string }) => {
    const entry = event as IScheduleEntry;
    if (!canMoveOnGrid(entry)) return;
    return persistMove(entry, resizedEntryDates(entry, { start: new Date(start), end: new Date(end) }));
  };

  const renderEditor = () => {
    if (!editorTarget || !currentUserId) return null;

    return (
      <WorkItemEntryEditor
        context={workItemContext}
        target={editorTarget}
        // Dialog presentation: the drawer's InsideDialogContext renders it as
        // a centered overlay above the full-height calendar. Rendering inline
        // put the form below the calendar, offscreen, so selecting a slot
        // appeared to do nothing.
        presentation="dialog"
        onClose={closeEditor}
        onSaved={refreshEntries}
        onDeleted={refreshEntries}
        lockAssignees
        viewer={viewer}
      />
    );
  };

  // Compact toolbar for the drawer's width: chevrons, Today, the range, the view switch.
  const AgentToolbar = ({ label, onNavigate, onView, view: currentView }: ToolbarProps) => (
    <div className="rbc-toolbar agent-schedule-toolbar flex items-center gap-2 px-1 py-2">
      <div className="flex items-center gap-1 shrink-0">
        <Button
          id="agent-schedule-prev"
          variant="ghost"
          size="sm"
          className="px-2"
          aria-label={t('calendar.toolbar.previousAria', { defaultValue: 'Previous {{view}}', view: currentView })}
          onClick={() => onNavigate('PREV')}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button
          id="agent-schedule-next"
          variant="ghost"
          size="sm"
          className="px-2"
          aria-label={t('calendar.toolbar.nextAria', { defaultValue: 'Next {{view}}', view: currentView })}
          onClick={() => onNavigate('NEXT')}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
        <Button id="agent-schedule-today" variant="outline" size="sm" onClick={() => onNavigate('TODAY')}>
          {t('calendar.toolbar.today', { defaultValue: 'Today' })}
        </Button>
      </div>
      <span className="rbc-toolbar-label flex-1 min-w-0 truncate text-center">{label}</span>
      <div className="shrink-0">
        <ViewSwitcher
          currentView={currentView}
          onChange={(next) => onView(next as View)}
          options={[
            { value: 'day', label: t('calendar.toolbar.views.day', { defaultValue: 'Day' }) },
            { value: 'week', label: t('calendar.toolbar.views.week', { defaultValue: 'Week' }) },
            { value: 'month', label: t('calendar.toolbar.views.month', { defaultValue: 'Month' }) },
          ]}
        />
      </div>
    </div>
  );

  const scrollToTime = useMemo(() => {
    const time = new Date();
    time.setHours(8, 0, 0, 0);
    return time;
  }, []);

  const renderWorkItemHeader = () => {
    if (!workItemContext || !permissionsLoaded || !canViewAgent) return null;

    return (
      <div
        id="agent-schedule-work-item-header"
        className="px-4 py-3 border-b border-[rgb(var(--color-border-200))] flex items-start justify-between gap-4"
      >
        <div className="min-w-0">
          <div className="text-base font-semibold text-[rgb(var(--color-text-900))] truncate">
            {agentName
              ? t('agentView.schedulingForAgent', { defaultValue: 'Scheduling for {{name}}', name: agentName })
              : t('agentView.schedulingFor', { defaultValue: 'Scheduling' })}
          </div>
          <div className="text-sm text-[rgb(var(--color-text-700))] truncate">
            {workItemContext.title}
          </div>
          <div className="mt-1 text-xs text-[rgb(var(--color-text-500))]">
            {canCreateFromSlot
              ? t('agentView.selectSlotHint', {
                  defaultValue: 'Drag to create, move or resize entries. Click an entry to edit.',
                })
              : t('agentView.readOnlyHint', {
                  defaultValue:
                    'You can view this schedule, but need the schedule update permission to add or change entries.',
                })}
          </div>
        </div>
        {hasOtherWork && (
        <div
          id="agent-schedule-work-item-legend"
          className="shrink-0 flex flex-col items-start gap-1 text-xs text-[rgb(var(--color-text-600))]"
        >
          <span className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="inline-block h-3 w-5 rounded-sm bg-[rgb(var(--color-primary-200))] ring-2 ring-[rgb(var(--color-primary-600))]"
            />
            {t('agentView.workItemLegend', { defaultValue: 'This work item' })}
          </span>
          <span className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="inline-block h-3 w-5 rounded-sm bg-[rgb(var(--color-border-300))]"
            />
            {t('agentView.otherWorkLegend', { defaultValue: 'Other work' })}
          </span>
        </div>
        )}
      </div>
    );
  };

  return (
    <div
      className={`h-full min-h-0 flex flex-col overflow-hidden bg-[rgb(var(--color-border-50))] agent-schedule-view${hasAllDayEvents ? '' : ' agent-schedule-view--no-all-day'}${workItemContext ? ' agent-schedule-view--work-item' : ''}`}
    >
      <CalendarStyleProvider />
      <AgentScheduleDrawerStyles />
      {renderWorkItemHeader()}
      <div className="flex-1 min-h-0 relative" ref={calendarRef}>
        {isLoading && (
          <div className="absolute inset-0 bg-white bg-opacity-50 flex items-center justify-center z-10">
            {t('agentView.loading', { defaultValue: 'Loading...' })}
          </div>
        )}
        {error && (
          <div className="absolute inset-0 bg-red-100 dark:bg-red-900/20 text-red-700 dark:text-red-300 flex items-center justify-center z-10 p-4">
            {error}
          </div>
        )}
        <Suspense fallback={<CalendarSkeleton height="100%" view={view as 'month' | 'week' | 'day'} showSidebar={false} />}>
          <DynamicBigCalendar
            localizer={localizer}
            events={events}
            startAccessor={(event: object) => new Date((event as IScheduleEntry).scheduled_start)}
            endAccessor={(event: object) => new Date((event as IScheduleEntry).scheduled_end)}
            allDayAccessor={(event: object) => {
              const scheduleEvent = event as IScheduleEntry;
              const start = new Date(scheduleEvent.scheduled_start);
              const end = new Date(scheduleEvent.scheduled_end);
              return start.toDateString() !== end.toDateString();
            }}
            eventPropGetter={(event: object) => {
              const scheduleEvent = event as IScheduleEntry;
              const isThisWorkItem = belongsToWorkItem(scheduleEvent);
              // With a work item in focus, the type palette gives way to one
              // question: is this chip the ticket being scheduled or not?
              const backgroundColor = workItemContext && !isThisWorkItem
                ? 'rgb(var(--color-border-300))'
                : workItemColors[scheduleEvent.work_item_type] || 'rgb(var(--color-border-200))';
              return {
                className: isThisWorkItem ? 'agent-schedule-event--this-work-item' : 'agent-schedule-event--other',
                style: {
                  backgroundColor,
                  borderRadius: '6px',
                  border: 'none',
                  color: 'rgb(var(--color-text-900))',
                },
              };
            }}
            style={{ height: '100%' }}
            view={view}
            date={date}
            scrollToTime={scrollToTime}
            onView={(newView) => setView(newView)}
            onNavigate={(newDate) => setDate(newDate)}
            onSelectEvent={(event: object) => handleSelectEvent(event as IScheduleEntry)}
            selectable={canCreateFromSlot}
            onSelectSlot={canCreateFromSlot ? handleSelectSlot : undefined}
            resizableAccessor={(event: object) => canMoveOnGrid(event as IScheduleEntry)}
            draggableAccessor={(event: object) => canMoveOnGrid(event as IScheduleEntry)}
            onEventDrop={handleEventDrop}
            onEventResize={handleEventResize}
            components={{ event: AgentScheduleEventChip, toolbar: AgentToolbar }}
            dayLayoutAlgorithm="no-overlap"
            step={15}
            timeslots={4}
            defaultView="week"
            views={['month', 'week', 'day']}
          />
        </Suspense>
      </div>
      {renderEditor()}
    </div>
  );
};

export default AgentScheduleView;
