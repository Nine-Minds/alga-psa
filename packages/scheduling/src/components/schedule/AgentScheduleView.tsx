'use client';

import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { momentLocalizer, SlotInfo, View } from 'react-big-calendar';
import moment from 'moment';
import CalendarSkeleton from '@alga-psa/ui/components/skeletons/CalendarSkeleton';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { WorkItemScheduleContext } from '@alga-psa/ui/context';
import WorkItemEntryEditor, { type WorkItemEntryTarget } from './WorkItemEntryEditor';
import { CalendarStyleProvider } from './CalendarStyleProvider';
import { AgentScheduleDrawerStyles } from './AgentScheduleDrawerStyles';
import { getScheduleEntries } from '@alga-psa/scheduling/actions';
import type { IScheduleEntry, WorkItemType } from '@alga-psa/types';
import { useScheduleViewer } from '../../hooks/useScheduleViewer';
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

  const viewer = useScheduleViewer(
    t('agentView.errors.loadPermissions', { defaultValue: 'Failed to load user permissions' })
  );
  const { currentUserId, loaded: permissionsLoaded, canModifySchedule } = viewer;
  const canViewAgent = viewer.canViewAgent(agentId);

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

  useEffect(() => {
    if (!hasScrolled && calendarRef.current && (view === 'day' || view === 'week')) {
      const timeSlotContainer = calendarRef.current.querySelector('.rbc-time-content');
      if (timeSlotContainer) {
        const scrollToPosition = 8 * 4 * 15;
        (timeSlotContainer as HTMLElement).scrollTop = scrollToPosition;
        setHasScrolled(true);
      }
    }
  }, [events, hasScrolled, view]);

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

  const belongsToWorkItem = (event: IScheduleEntry) =>
    Boolean(workItemContext) && event.work_item_id === workItemContext?.workItemId;

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
        className="px-4 py-3 border-b border-[rgb(var(--color-border-200))]"
      >
        <div className="text-xs uppercase tracking-wide text-[rgb(var(--color-text-500))]">
          {t('agentView.schedulingFor', { defaultValue: 'Scheduling' })}
        </div>
        <div className="text-sm font-medium text-[rgb(var(--color-text-900))] truncate">
          {workItemContext.title}
        </div>
        <div className="mt-1 text-xs text-[rgb(var(--color-text-600))]">
          {canCreateFromSlot
            ? t('agentView.selectSlotHint', {
                defaultValue:
                  'Click or drag a time on the calendar to schedule this work for this agent. Click an entry to edit it.',
              })
            : t('agentView.readOnlyHint', {
                defaultValue:
                  'You can view this schedule, but need the schedule update permission to add or change entries.',
              })}
          {' '}
          {t('agentView.workItemLegend', {
            defaultValue: 'Outlined entries belong to this work item.',
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="h-full flex flex-col bg-[rgb(var(--color-border-50))]">
      <CalendarStyleProvider />
      <AgentScheduleDrawerStyles />
      {renderWorkItemHeader()}
      <div className="flex-grow relative" ref={calendarRef}>
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
              const backgroundColor = workItemColors[scheduleEvent.work_item_type] || 'rgb(var(--color-border-200))';
              const isThisWorkItem = belongsToWorkItem(scheduleEvent);
              return {
                className: isThisWorkItem ? 'agent-schedule-event--this-work-item' : undefined,
                style: {
                  backgroundColor,
                  borderRadius: '6px',
                  border: 'none',
                  color: 'rgb(var(--color-text-900))',
                  ...(isThisWorkItem
                    ? {
                        boxShadow: 'inset 0 0 0 2px rgb(var(--color-primary-600))',
                        fontWeight: 600,
                      }
                    : {}),
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
            resizableAccessor={() => false}
            draggableAccessor={() => false}
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
