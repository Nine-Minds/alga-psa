'use client';

import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import toast from 'react-hot-toast';
import { momentLocalizer, SlotInfo, View } from 'react-big-calendar';
import moment from 'moment';
import CalendarSkeleton from '@alga-psa/ui/components/skeletons/CalendarSkeleton';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { AgentScheduleWorkItemContext } from '@alga-psa/ui/context';
import EntryPopup from './EntryPopup';
import { CalendarStyleProvider } from './CalendarStyleProvider';
import { AgentScheduleDrawerStyles } from './AgentScheduleDrawerStyles';
import { getScheduleEntries, addScheduleEntry } from '@alga-psa/scheduling/actions';
import { getCurrentUser, getCurrentUserPermissions } from '@alga-psa/user-composition/actions';
import { useUsers } from '@alga-psa/user-composition/hooks';
import type { IScheduleEntry, WorkItemType } from '@alga-psa/types';

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
  workItemContext?: AgentScheduleWorkItemContext;
}

const AgentScheduleView: React.FC<AgentScheduleViewProps> = ({ agentId, workItemContext }) => {
  const { t } = useTranslation('msp/schedule');
  const [events, setEvents] = useState<IScheduleEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [date, setDate] = useState<Date>(new Date());
  const [view, setView] = useState<View>('week');
  const [showEntryPopup, setShowEntryPopup] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<IScheduleEntry | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<{
    start: Date | string;
    end: Date | string;
    assigned_user_ids?: string[];
    defaultAssigneeId?: string;
  } | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [userPermissions, setUserPermissions] = useState<string[] | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const calendarRef = useRef<HTMLDivElement>(null);
  const [hasScrolled, setHasScrolled] = useState(false);
  const { users = [] } = useUsers();

  const permissionsLoaded = userPermissions !== null;

  const canViewOthers = useMemo(() => {
    if (!userPermissions) return false;
    return userPermissions.some((permission) => permission === 'user_schedule:read:all' || permission === 'user_schedule:update');
  }, [userPermissions]);

  const canReadOwn = useMemo(() => {
    if (!userPermissions) return false;
    return userPermissions.some((permission) => permission === 'user_schedule:read' || permission === 'user_schedule:update' || permission === 'user_schedule:read:all');
  }, [userPermissions]);

  const canViewAgent = useMemo(() => {
    if (!currentUserId || !permissionsLoaded) return false;
    if (agentId === currentUserId) {
      return canReadOwn;
    }
    return canViewOthers;
  }, [agentId, canReadOwn, canViewOthers, currentUserId, permissionsLoaded]);

  const canModifySchedule = useMemo(() => {
    if (!userPermissions) return false;
    return userPermissions.includes('user_schedule:update');
  }, [userPermissions]);

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
    let active = true;
    const loadUser = async () => {
      try {
        const user = await getCurrentUser();
        if (!active) return;
        setCurrentUserId(user?.user_id ?? null);
        const permissions = await getCurrentUserPermissions();
        if (!active) return;
        setUserPermissions(permissions || []);
      } catch (err) {
        if (!active) return;
        setError(
          err instanceof Error
            ? err.message
            : t('agentView.errors.loadPermissions', {
                defaultValue: 'Failed to load user permissions',
              })
        );
      }
    };
    loadUser();
    return () => {
      active = false;
    };
  }, [t]);

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
    setSelectedEvent(event);
    setSelectedSlot(null);
    setShowEntryPopup(true);
  };

  const handleEntryPopupClose = () => {
    setShowEntryPopup(false);
    setSelectedEvent(null);
    setSelectedSlot(null);
  };

  // LEVERAGE: pattern slot-select-month-pin — second copy of
  // ScheduleCalendar.handleSelectSlot's month-view 8am/15-minute adjustment;
  // the viewed agent is the default assignee so an entry created from their
  // drawer lands on their schedule.
  const handleSelectSlot = (slotInfo: SlotInfo) => {
    if (!workItemContext) return;

    const start = new Date(slotInfo.start);
    let end = new Date(slotInfo.end);
    if (view === 'month') {
      start.setHours(8, 0, 0, 0);
      end = new Date(start);
      end.setMinutes(start.getMinutes() + 15);
    }

    setSelectedEvent(null);
    setSelectedSlot({
      start,
      end,
      defaultAssigneeId: agentId,
      assigned_user_ids: [agentId],
    });
    setShowEntryPopup(true);
  };

  const handleEntryPopupSave = async (
    entryData: Omit<IScheduleEntry, 'tenant'> & { updateType?: string }
  ) => {
    if (!workItemContext) return;

    try {
      const result = await addScheduleEntry({
        ...entryData,
        work_item_id: workItemContext.workItemId,
        work_item_type: workItemContext.workItemType,
        title: entryData.title || workItemContext.title,
        recurrence_pattern: entryData.recurrence_pattern || null,
      });

      if (!result.success) {
        toast.error(
          result.error ||
            t('agentView.errors.saveFailed', { defaultValue: 'Failed to save schedule entry' })
        );
        return;
      }

      handleEntryPopupClose();
      setRefreshKey((value) => value + 1);
      workItemContext.onScheduled?.();
    } catch (err) {
      console.error('Failed to save schedule entry:', err);
      toast.error(t('agentView.errors.saveFailed', { defaultValue: 'Failed to save schedule entry' }));
    }
  };

  const renderEntryPopup = () => {
    if (!showEntryPopup || !currentUserId) return null;
    if (!selectedEvent && !selectedSlot) return null;

    const isCreating = !selectedEvent && Boolean(selectedSlot) && canCreateFromSlot;

    return (
      <EntryPopup
        event={selectedEvent}
        slot={selectedSlot ?? undefined}
        initialWorkItem={
          isCreating && workItemContext
            ? {
                work_item_id: workItemContext.workItemId,
                type: workItemContext.workItemType,
                name: workItemContext.title,
                description: '',
              }
            : null
        }
        onClose={handleEntryPopupClose}
        onSave={isCreating ? handleEntryPopupSave : async () => {}}
        canAssignMultipleAgents={false}
        users={users}
        currentUserId={currentUserId}
        loading={false}
        isInDrawer={true}
        error={null}
        canModifySchedule={canModifySchedule}
        focusedTechnicianId={agentId}
        canAssignOthers={canModifySchedule}
        viewOnly={!isCreating}
      />
    );
  };

  const scrollToTime = useMemo(() => {
    const time = new Date();
    time.setHours(8, 0, 0, 0);
    return time;
  }, []);

  return (
    <div className="h-full flex flex-col bg-[rgb(var(--color-border-50))]">
      <CalendarStyleProvider />
      <AgentScheduleDrawerStyles />
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
              return {
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
            resizableAccessor={() => false}
            draggableAccessor={() => false}
            step={15}
            timeslots={4}
            defaultView="week"
            views={['month', 'week', 'day']}
          />
        </Suspense>
      </div>
      {renderEntryPopup()}
    </div>
  );
};

export default AgentScheduleView;
