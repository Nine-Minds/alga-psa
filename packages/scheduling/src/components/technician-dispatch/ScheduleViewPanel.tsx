import React from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { SwitchWithLabel } from '@alga-psa/ui/components/SwitchWithLabel';
import DailyTechnicianScheduleGrid from './DailyTechnicianScheduleGrid';
import WeeklyTechnicianScheduleGrid from './WeeklyTechnicianScheduleGrid';
import { IScheduleEntry } from '@alga-psa/types';
import { IUser } from '@shared/interfaces/user.interfaces';
import { DropEvent, EventDrop, WorkItemDrop } from '@alga-psa/types';
import { View, NavigateAction } from 'react-big-calendar';
import { withDragAndDropProps } from 'react-big-calendar/lib/addons/dragAndDrop';
import { XCircle, Plus } from 'lucide-react';
import moment from 'moment';

interface ScheduleViewPanelProps {
  viewMode: 'day' | 'week';
  date: Date;
  events: Omit<IScheduleEntry, 'tenant'>[];
  technicians: Omit<IUser, 'tenant'>[];
  primaryTechnicianId: string | null;
  comparisonTechnicianIds: Set<string>;
  onNavigate: (action: 'prev' | 'next' | 'today', newDate?: Date) => void;
  onViewChange: (newViewMode: 'day' | 'week') => void;
  onTechnicianClick: (technicianId: string) => void;
  onComparisonChange?: (technicianId: string, isSelected: boolean) => void;
  onDrop?: (dropEvent: DropEvent) => void;
  onResize?: (eventId: string, techId: string, newStart: Date, newEnd: Date) => void;
  onDeleteEvent?: (eventId: string) => void;
  onEventClick: (event: Omit<IScheduleEntry, 'tenant'>) => void;
  onDropFromList?: (dropEvent: DropEvent) => void;
  onSelectSlot: (slotInfo: { start: Date; end: Date; resourceId?: string | number }) => void;
  onResetSelections?: () => void;
  onSelectAll?: () => void;
  canEdit?: boolean;
  showInactiveUsers?: boolean;
  onShowInactiveUsersChange?: (show: boolean) => void;
  onQuickAddTicket?: () => void;
}

const ScheduleViewPanel: React.FC<ScheduleViewPanelProps> = ({
  viewMode,
  date,
  events,
  technicians,
  primaryTechnicianId,
  comparisonTechnicianIds,
  onNavigate,
  onViewChange,
  onTechnicianClick,
  onComparisonChange,
  onDrop,
  onResize,
  onDeleteEvent,
  onEventClick,
  onDropFromList,
  onSelectSlot,
  onResetSelections,
  onSelectAll,
  canEdit,
  showInactiveUsers = false,
  onShowInactiveUsersChange,
  onQuickAddTicket,
}) => {

  const handleNavigate = (newDate: Date, view: string, action: string) => {
    // We only care about the action ('PREV', 'NEXT', 'TODAY', 'DATE') for the parent
    // but might use newDate if the parent handler is updated
    if (action === 'PREV' || action === 'NEXT' || action === 'TODAY') {
        onNavigate(action.toLowerCase() as 'prev' | 'next' | 'today', newDate);
    } else if (action === 'DATE') {
        onNavigate('today', newDate);
    }
  };

  const handleViewChange = (view: string) => {
    if (view === 'week') {
        onViewChange('week');
    }
  };

  const handleEventDrop: withDragAndDropProps<IScheduleEntry, object>['onEventDrop'] = ({ event, start, end, resourceId }) => {
    if (!event.entry_id) {
        console.error("Cannot drop event without an ID");
        return;
    }
    const startTime = typeof start === 'string' ? moment(start).toDate() : start;

    let techId: string;
    if (resourceId && typeof resourceId === 'string' && resourceId.trim() !== '') {
        techId = resourceId;
    } else if (event.assigned_user_ids && event.assigned_user_ids.length > 0 &&
               event.assigned_user_ids[0] !== null && event.assigned_user_ids[0] !== undefined) {
        techId = event.assigned_user_ids[0];
    } else if (primaryTechnicianId) {
        techId = primaryTechnicianId;
    } else {
        console.error("Cannot determine technician ID for drop event");
        return;
    }

    const dropData: EventDrop = {
        type: 'scheduleEntry',
        eventId: event.entry_id.toString(),
        techId: techId,
        startTime: startTime,
    };
    onDrop?.(dropData);
  };

  const handleEventResize: withDragAndDropProps<IScheduleEntry, object>['onEventResize'] = ({ event, start, end }) => {
     if (!event.entry_id || !event.assigned_user_ids || event.assigned_user_ids.length === 0) {
        console.error("Cannot resize event without ID or assigned user");
        return;
     }
     const techId = primaryTechnicianId || event.assigned_user_ids[0];
     const newStart = typeof start === 'string' ? moment(start).toDate() : start;
     const newEnd = typeof end === 'string' ? moment(end).toDate() : end;
     onResize?.(event.entry_id.toString(), techId, newStart, newEnd);
  };

  const handleDropFromList = (item: { workItemId: string; start: Date; end: Date; resourceId: string | number }) => {
      const dropData: WorkItemDrop = {
          type: 'workItem',
          workItemId: item.workItemId,
          techId: item.resourceId as string,
          startTime: item.start,
      };
      onDropFromList?.(dropData);
  };

  const handleSelectEvent = (event: IScheduleEntry, e: React.SyntheticEvent<HTMLElement>) => {
      onEventClick(event);
  };

   const handleSelectSlot = (slotInfo: { start: Date; end: Date; slots: Date[] | string[]; action: 'select' | 'click' | 'doubleClick', resourceId?: number | string }) => {
       onSelectSlot({
           start: slotInfo.start,
           end: slotInfo.end,
           resourceId: slotInfo.resourceId as string | undefined
       });
   };

  return (
    <div className="flex-1 p-4 bg-white overflow-hidden flex flex-col">
      {/* Header Section */}
      <div className="flex flex-col mb-4 gap-4 pb-4">
        <div className="flex justify-between items-center">
          <h2 className="text-xl font-bold text-[rgb(var(--color-text-900))]">Technician Dispatch</h2>
          <div className="flex items-center gap-4">
            {/* Show Inactive Users Switch */}
            <SwitchWithLabel
              label="Show Inactive Users"
              checked={showInactiveUsers}
              onCheckedChange={onShowInactiveUsersChange || (() => {})}
            />
            {/* Quick Add Ticket Button */}
            <Button
              id="quick-add-ticket-button"
              onClick={onQuickAddTicket}
              size="sm"
              className="flex items-center gap-2"
            >
              <Plus className="h-4 w-4" />
              Add Ticket
            </Button>
          </div>
        </div>
        <div className="flex justify-between items-center w-full">
          {/* Date Navigation - Left */}
          <div className="flex items-center justify-start">
            <div className="flex items-center rounded-md border border-[rgb(var(--color-border-200))] overflow-hidden">
              <Button
                id="dispatch-prev-button"
                variant="ghost"
                size="sm"
                onClick={() => onNavigate('prev')}
                aria-label={`Previous ${viewMode}`}
                className="px-3 py-1 rounded-none border-r border-[rgb(var(--color-border-200))] text-[rgb(var(--color-text-700))] hover:bg-[rgb(var(--color-border-100))]"
              >
                {'< Prev'}
              </Button>
              <Button
                id="dispatch-today-button"
                variant="ghost"
                size="sm"
                onClick={() => onNavigate('today')}
                className="px-3 py-1 rounded-none border-r border-[rgb(var(--color-border-200))] text-[rgb(var(--color-text-700))] hover:bg-[rgb(var(--color-border-100))]"
              >
                Today
              </Button>
              <Button
                id="dispatch-next-button"
                variant="ghost"
                size="sm"
                onClick={() => onNavigate('next')}
                aria-label={`Next ${viewMode}`}
                className="px-3 py-1 rounded-none text-[rgb(var(--color-text-700))] hover:bg-[rgb(var(--color-border-100))]"
              >
                {'Next >'}
              </Button>
            </div>
          </div>

          {/* Date Display - Center */}
          <div className="text-[rgb(var(--color-text-800))] font-medium text-center min-w-[250px] flex-grow flex items-center justify-center">
            <span>
              {date.toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'long',
                day: 'numeric'
              })}
            </span>
          </div>

          {/* View Mode Switcher - Right */}
          <div className="flex items-center rounded-md border border-[rgb(var(--color-border-200))] overflow-hidden justify-end">
            <Button
              id="dispatch-day-view-button"
              variant={viewMode === 'day' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => onViewChange('day')}
              className={`px-3 py-1 rounded-none border-r border-[rgb(var(--color-border-200))] ${viewMode === 'day' ? 'text-white hover:bg-[rgb(var(--color-primary-600))]' : 'text-[rgb(var(--color-text-700))] hover:bg-[rgb(var(--color-border-100))]'}`}
            >
              Day
            </Button>
            <Button
              id="dispatch-week-view-button"
              variant={viewMode === 'week' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => onViewChange('week')}
              className={`px-3 py-1 rounded-none ${viewMode === 'week' ? 'text-white hover:bg-[rgb(var(--color-primary-600))]' : 'text-[rgb(var(--color-text-700))] hover:bg-[rgb(var(--color-border-100))]'}`}
            >
              Week
            </Button>
          </div>
        </div>
      </div>

      {/* Schedule Area */}
      <div className="technician-schedule-grid flex-1 overflow-hidden">
        {viewMode === 'day' && (
          <DailyTechnicianScheduleGrid
            technicians={technicians}
            events={events}
            selectedDate={date}
            onDrop={onDrop}
            onTechnicianClick={onTechnicianClick}
            onResize={onResize}
            onDeleteEvent={onDeleteEvent}
            onEventClick={onEventClick}
            canEdit={canEdit}
          />
        )}

        {viewMode === 'week' && (
            <WeeklyTechnicianScheduleGrid
                date={date}
                primaryTechnicianId={primaryTechnicianId}
                comparisonTechnicianIds={Array.from(comparisonTechnicianIds)}
                allTechnicians={technicians as IUser[]}
                events={events as IScheduleEntry[]}
                onNavigate={handleNavigate}
                onViewChange={handleViewChange}
                onComparisonChange={onComparisonChange as any}
                onSelectSlot={handleSelectSlot}
                onEventDrop={handleEventDrop}
                onEventResize={handleEventResize}
                onDropFromList={handleDropFromList}
                onSelectEvent={handleSelectEvent}
                onSetFocus={onTechnicianClick}
                onDeleteEvent={onDeleteEvent}
                onResetSelections={onResetSelections}
                onSelectAll={onSelectAll}
                canEdit={canEdit}
            />
        )}
      </div>
    </div>
  );
};

export default ScheduleViewPanel;
