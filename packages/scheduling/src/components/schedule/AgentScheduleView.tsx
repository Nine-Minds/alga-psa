'use client';

import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { momentLocalizer, View } from 'react-big-calendar';
import moment from 'moment';
import CalendarSkeleton from '@alga-psa/ui/components/skeletons/CalendarSkeleton';
import EntryPopup from './EntryPopup';
import { CalendarStyleProvider } from './CalendarStyleProvider';
import { AgentScheduleDrawerStyles } from './AgentScheduleDrawerStyles';
import { getScheduleEntries } from '@alga-psa/scheduling/actions';
import { getCurrentUser, getCurrentUserPermissions } from '@alga-psa/users/actions';
import { useUsers } from '@alga-psa/users/hooks';
import type { IScheduleEntry, WorkItemType } from '@alga-psa/types';

const DynamicBigCalendar = dynamic(() => import('./DynamicBigCalendar'), {
  loading: () => <CalendarSkeleton height="100%" view="week" showSidebar={false} />,
  ssr: false,
});

const localizer = momentLocalizer(moment);

const workItemColors: Record<WorkItemType, string> = {
  ticket: 'rgb(var(--color-primary-200))',
  project_task: 'rgb(var(--color-secondary-100))',
  non_billable_category: 'rgb(var(--color-accent-100))',
  ad_hoc: 'rgb(var(--color-border-200))',
  interaction: 'rgb(220 252 231)',
  appointment_request: 'rgb(254 205 211)',
};

interface AgentScheduleViewProps {
  agentId: string;
}

const AgentScheduleView: React.FC<AgentScheduleViewProps> = ({ agentId }) => {
  const [events, setEvents] = useState<IScheduleEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [date, setDate] = useState<Date>(new Date());
  const [view, setView] = useState<View>('week');
  const [showEntryPopup, setShowEntryPopup] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<IScheduleEntry | null>(null);
  const [userPermissions, setUserPermissions] = useState<string[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const calendarRef = useRef<HTMLDivElement>(null);
  const [hasScrolled, setHasScrolled] = useState(false);
  const { users = [] } = useUsers();

  const canViewOthers = useMemo(() => {
    return userPermissions.some((permission) => permission === 'user_schedule:read:all' || permission === 'user_schedule:update');
  }, [userPermissions]);

  const canReadOwn = useMemo(() => {
    return userPermissions.some((permission) => permission === 'user_schedule:read' || permission === 'user_schedule:update' || permission === 'user_schedule:read:all');
  }, [userPermissions]);

  const canViewAgent = useMemo(() => {
    if (!currentUserId) return false;
    if (agentId === currentUserId) {
      return canReadOwn;
    }
    return canViewOthers;
  }, [agentId, canReadOwn, canViewOthers, currentUserId]);

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
        setError(err instanceof Error ? err.message : 'Failed to load user permissions');
      }
    };
    loadUser();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    const loadEntries = async () => {
      setIsLoading(true);
      setError(null);

      if (!currentUserId) {
        setIsLoading(false);
        return;
      }

      if (!canViewAgent) {
        setEvents([]);
        setIsLoading(false);
        setError('You do not have permission to view this schedule.');
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
  }, [agentId, canViewAgent, currentUserId, dateRange.end, dateRange.start]);

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
    setShowEntryPopup(true);
  };

  const renderEntryPopup = () => {
    if (!showEntryPopup || !selectedEvent || !currentUserId) return null;

    return (
      <EntryPopup
        event={selectedEvent}
        onClose={() => {
          setShowEntryPopup(false);
          setSelectedEvent(null);
        }}
        onSave={async () => {}}
        canAssignMultipleAgents={false}
        users={users}
        currentUserId={currentUserId}
        loading={false}
        isInDrawer={true}
        error={null}
        canModifySchedule={false}
        focusedTechnicianId={agentId}
        canAssignOthers={false}
        viewOnly={true}
      />
    );
  };

  const scrollToTime = useMemo(() => {
    const time = new Date();
    time.setHours(8, 0, 0, 0);
    return time;
  }, []);

  return (
    <div className="h-full flex flex-col bg-[rgb(var(--color-background-50))]">
      <CalendarStyleProvider />
      <AgentScheduleDrawerStyles />
      <div className="flex-grow relative" ref={calendarRef}>
        {isLoading && (
          <div className="absolute inset-0 bg-white bg-opacity-50 flex items-center justify-center z-10">
            Loading...
          </div>
        )}
        {error && (
          <div className="absolute inset-0 bg-red-100 text-red-700 flex items-center justify-center z-10 p-4">
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
            selectable={false}
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
