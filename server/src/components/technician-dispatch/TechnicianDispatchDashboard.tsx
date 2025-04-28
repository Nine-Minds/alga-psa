'use client';

import React, { useState, useCallback, useRef, useEffect } from 'react';
import WorkItemCard from './WorkItemCard';
import { WorkItemDetailsDrawer } from './WorkItemDetailsDrawer';
import { useDrawer } from "server/src/context/DrawerContext";
import TechnicianScheduleGrid from './TechnicianScheduleGrid';
import { IScheduleEntry } from 'server/src/interfaces/schedule.interfaces';
import { WorkItemType, IWorkItem, IExtendedWorkItem } from 'server/src/interfaces/workItem.interfaces';
import { IUser } from 'server/src/interfaces/auth.interfaces';
import { getAllUsers } from 'server/src/lib/actions/user-actions/userActions';
import { searchDispatchWorkItems, getWorkItemById } from 'server/src/lib/actions/workItemActions';
import { addScheduleEntry, updateScheduleEntry, getScheduleEntries, deleteScheduleEntry, ScheduleActionResult } from 'server/src/lib/actions/scheduleActions';
import { getWorkItemStatusOptions, StatusOption } from 'server/src/lib/actions/status-actions/statusActions';
import { toast } from 'react-hot-toast';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import { Switch } from 'server/src/components/ui/Switch';
import { Input } from 'server/src/components/ui/Input';
import { Button } from 'server/src/components/ui/Button';
import { DragState } from 'server/src/interfaces/drag.interfaces';
import { HighlightedSlot } from 'server/src/interfaces/schedule.interfaces';
import { DropEvent } from 'server/src/interfaces/event.interfaces';
import { addDays, addWeeks, addMonths, startOfDay, subDays, subWeeks, subMonths } from 'date-fns';

interface TechnicianDispatchDashboardProps {
  filterWorkItemId?: string;
  filterWorkItemType?: WorkItemType;
}

const TechnicianDispatchDashboard: React.FC<TechnicianDispatchDashboardProps> = ({
  filterWorkItemId,
  filterWorkItemType
}) => {
  const [selectedPriority, setSelectedPriority] = useState('All');
  const [users, setUsers] = useState<Omit<IUser, 'tenant'>[]>([]);
  const [events, setEvents] = useState<Omit<IScheduleEntry, 'tenant'>[]>([]);
  const [workItems, setWorkItems] = useState<Omit<IExtendedWorkItem, "tenant">[]>([]);
  const [date, setDate] = useState(startOfDay(new Date()));
  const [viewMode, setViewMode] = useState<'day' | 'week'>('day');
  const [primaryTechnicianId, setPrimaryTechnicianId] = useState<string | null>(null);
  const [comparisonTechnicianIds, setComparisonTechnicianIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [highlightedSlots, setHighlightedSlots] = useState<Set<HighlightedSlot> | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [selectedStatusFilter, setSelectedStatusFilter] = useState<string>('all_open');
  const [filterUnscheduled, setFilterUnscheduled] = useState<boolean>(true);
  const [statusFilterOptions, setStatusFilterOptions] = useState<StatusOption[]>([]);
  const [totalItems, setTotalItems] = useState(0);
  const ITEMS_PER_PAGE = 10;

  const searchTimeoutRef = useRef<NodeJS.Timeout>();
  const isDraggingRef = useRef(false);
  const dragStateRef = useRef<DragState | null>(null);
  // Updated ref to use new state variables
  const searchParamsRef = useRef({
    selectedStatusFilter,
    filterUnscheduled,
    sortOrder,
    currentPage,
  });

  const saveTimeoutRef = useRef<number>();

  // Updated useEffect dependencies
  useEffect(() => {
    searchParamsRef.current = {
      selectedStatusFilter,
      filterUnscheduled,
      sortOrder,
      currentPage,
    };
  }, [selectedStatusFilter, filterUnscheduled, sortOrder, currentPage]);

  const performSearch = useCallback(async (query: string) => {
    try {
      const { selectedStatusFilter, filterUnscheduled, sortOrder, currentPage } = searchParamsRef.current;
      // TODO: Update date range calculation based on viewMode (Step 3.1 Data Fetching)
      const start = new Date(date);
      start.setHours(0, 0, 0, 0);
      const end = new Date(date);
      end.setHours(23, 59, 59, 999);

      const result = await searchDispatchWorkItems({
        searchTerm: query,
        statusFilter: selectedStatusFilter,
        filterUnscheduled: filterUnscheduled,
        sortBy: 'name',
        sortOrder,
        page: currentPage,
        pageSize: ITEMS_PER_PAGE,
        // TODO: Update date range based on viewMode (Step 3.1 Data Fetching)
        // dateRange: calculateDateRange(date, viewMode),
        dateRange: {
           start,
           end
        },
        workItemId: filterWorkItemId
      });
      setWorkItems(result.items);
      setTotalItems(result.total);
    } catch (err) {
      console.error('Error searching work items:', err);
      setError('Failed to search work items');
    }
  }, [date, filterWorkItemType, filterWorkItemId]);

  // Fetch status options on mount
  useEffect(() => {
    const fetchStatusOptions = async () => {
      try {
        const options = await getWorkItemStatusOptions(['ticket']);
        setStatusFilterOptions(options);
      } catch (err) {
        console.error("Failed to fetch status options:", err);
        toast.error("Failed to load status filter options.");
        // Set default basic options as fallback
        setStatusFilterOptions([
          { value: 'all_open', label: 'All Open' },
          { value: 'all_closed', label: 'All Closed' },
        ]);
      }
    };
    fetchStatusOptions();
  }, []);


  const refreshAllData = useCallback(async () => {
    try {
      await performSearch(searchQuery);
      // TODO: Update date range calculation based on viewMode 
      const start = new Date(date);
      start.setHours(0, 0, 0, 0);
      const end = new Date(date);
      end.setHours(23, 59, 59, 999);
      // TODO: Update getScheduleEntries call based on viewMode and selectedUserId 
      const scheduleResult = await getScheduleEntries(start, end);
      if (scheduleResult.success && scheduleResult.entries) {
        setEvents(scheduleResult.entries);
      } else {
         setError('Failed to refresh schedule entries');
         toast.error('Failed to refresh schedule entries');
      }
    } catch (err) {
      console.error('Error refreshing data:', err);
      toast.error('Failed to refresh data');
    }
  }, [performSearch, searchQuery, date]);


  const debouncedSearch = useCallback((query: string) => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    searchTimeoutRef.current = setTimeout(() => {
      performSearch(query);
    }, 300);
  }, [performSearch]);

  useEffect(() => {
    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const fetchInitialData = async () => {
      try {
        const fetchedUsers = await getAllUsers(true, 'internal');
        setUsers(fetchedUsers);

        // TODO: Update date range calculation based on viewMode (Step 3.1 Data Fetching)
        const start = new Date(date);
        start.setHours(0, 0, 0, 0);
        const end = new Date(date);
        end.setHours(23, 59, 59, 999);

        // TODO: Update getScheduleEntries call based on viewMode and selectedUserId (Step 3.1 Data Fetching)
        const scheduleResult = await getScheduleEntries(start, end);
        if (scheduleResult.success && scheduleResult.entries) {
          setEvents(scheduleResult.entries);
        } else {
          setError('Failed to fetch schedule entries');
        }
      } catch (err) {
        console.error('Error fetching data:', err);
        setError('Failed to fetch data');
      }
    };

    fetchInitialData();
  }, [date]);


  useEffect(() => {
    debouncedSearch(searchQuery);
  }, [searchQuery, selectedStatusFilter, filterUnscheduled, sortOrder, currentPage, debouncedSearch]);

  const debouncedSaveSchedule = useCallback(async (
    eventId: string,
    techId: string,
    startTime: Date,
    endTime: Date
  ) => {
    if (saveTimeoutRef.current) {
      window.clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = window.setTimeout(async () => {
      try {
        const result = await updateScheduleEntry(eventId, {
          assigned_user_ids: [techId],
          scheduled_start: startTime,
          scheduled_end: endTime,
          updated_at: new Date()
        });

        if (!result.success) {
          setError('Failed to update schedule');
        }
      } catch (err) {
        console.error('Error updating schedule:', err);
        setError('Failed to update schedule');
      }
    }, 500);
  }, []);

  const handleDrop = useCallback(async (dropEvent: DropEvent) => {
    if (dropEvent.type === 'workItem') {
      const workItem = workItems.find((w) => w.work_item_id === dropEvent.workItemId);

      if (workItem) {
        const endTime = new Date(dropEvent.startTime);
        endTime.setHours(endTime.getHours() + 1);

        const newEvent: Omit<IScheduleEntry, 'tenant' | 'entry_id' | 'created_at' | 'updated_at'> = {
          work_item_id: dropEvent.workItemId,
          assigned_user_ids: [dropEvent.techId],
          scheduled_start: dropEvent.startTime,
          scheduled_end: endTime,
          status: 'Scheduled',
          title: `${workItem.name}`,
          work_item_type: workItem.type,
        };

        try {
          const result = await addScheduleEntry(newEvent, { assignedUserIds: [dropEvent.techId] });
          if (result.success && result.entry) {
            setEvents((prevEvents) => [...prevEvents, result.entry]);
            setError(null);
          } else {
            setError('Failed to create schedule entry');
          }
        } catch (err) {
          console.error('Error creating schedule entry:', err);
          setError('Failed to create schedule entry');
        }
      }
    } else {
      const event = events.find((e) => e.entry_id === dropEvent.eventId);

      if (event) {
        const duration = new Date(event.scheduled_end).getTime() - new Date(event.scheduled_start).getTime();
        const endTime = new Date(dropEvent.startTime.getTime() + duration);

        setEvents((prevEvents) =>
          prevEvents.map((e): Omit<IScheduleEntry, 'tenant'> =>
            e.entry_id === dropEvent.eventId
              ? { ...e, assigned_user_ids: [dropEvent.techId], scheduled_start: dropEvent.startTime, scheduled_end: endTime }
              : e
          )
        );

        await debouncedSaveSchedule(dropEvent.eventId, dropEvent.techId, dropEvent.startTime, endTime);
      }
    }
  }, [workItems, events, debouncedSaveSchedule]);

  const { openDrawer, closeDrawer } = useDrawer();
  
  const [dragOverlay, setDragOverlay] = useState<{
    visible: boolean;
    x: number;
    y: number;
    item: Omit<IWorkItem, "tenant"> | null;
  } | null>(null);

  const handleDragStart = useCallback((e: React.DragEvent, workItemId: string, item: Omit<IWorkItem, "tenant">) => {
    e.dataTransfer.setData('text/plain', workItemId);
    e.dataTransfer.effectAllowed = 'move';

    // Create an invisible drag image
    const dragImage = document.createElement('div');
    dragImage.style.width = '1px';
    dragImage.style.height = '1px';
    document.body.appendChild(dragImage);
    e.dataTransfer.setDragImage(dragImage, 0, 0);
    setTimeout(() => document.body.removeChild(dragImage), 0);

    // Set dragging state
    isDraggingRef.current = true;
    dragStateRef.current = {
      sourceId: workItemId,
      sourceType: 'workItem',
      originalStart: new Date(),
      originalEnd: new Date(),
      currentStart: new Date(),
      currentEnd: new Date(),
      currentTechId: '',
      clickOffset15MinIntervals: 0
    };
    setIsDragging(true);
    setDragState(dragStateRef.current);

    // Show our custom overlay
    setDragOverlay({
      visible: true,
      x: e.clientX,
      y: e.clientY,
      item
    });
  }, []);

  // Add these handlers
  const handleDrag = useCallback((e: React.DragEvent) => {
    if (e.clientX === 0 && e.clientY === 0) return; // Ignore invalid coordinates

    setDragOverlay(prev => prev ? {
      ...prev,
      x: e.clientX,
      y: e.clientY
    } : null);
  }, []);

  const handleDragEnd = useCallback(() => {
    setDragOverlay(null);
    isDraggingRef.current = false;
    dragStateRef.current = null;
    setIsDragging(false);
    setDragState(null);
    setHighlightedSlots(null);
  }, []);

  // Add this useEffect to handle the drag overlay movement
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (dragOverlay?.visible) {
        setDragOverlay(prev => prev ? {
          ...prev,
          x: e.clientX,
          y: e.clientY
        } : null);
      }
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('dragend', handleDragEnd);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('dragend', handleDragEnd);
    };
  }, [dragOverlay?.visible]);

  const onResize = useCallback(async (eventId: string, techId: string, newStart: Date, newEnd: Date) => {
    setEvents((prevEvents) =>
      prevEvents.map((event): Omit<IScheduleEntry, 'tenant'> =>
        event.entry_id === eventId
          ? { ...event, scheduled_start: newStart, scheduled_end: newEnd }
          : event
      )
    );

    await debouncedSaveSchedule(eventId, techId, newStart, newEnd);
  }, [debouncedSaveSchedule]);

  const handleDeleteEvent = useCallback(async (eventId: string) => {
    try {
      const result = await deleteScheduleEntry(eventId);
      if (result.success) {
        setEvents((prevEvents) => prevEvents.filter(event => event.entry_id !== eventId));
        setError(null);
      } else {
        setError('Failed to delete schedule entry');
      }
    } catch (err) {
      console.error('Error deleting schedule entry:', err);
      setError('Failed to delete schedule entry');
    }
  }, []);

  const handleViewChange = (newViewMode: 'day' | 'week') => {
    setViewMode(newViewMode);
  };


  const handleTechnicianClick = (technicianId: string) => {
    console.log('Technician clicked:', technicianId);
    // Implementation will be added in a later step
    // For now, let's just set the primary technician
    setPrimaryTechnicianId(technicianId);
  };


  const handleNavigate = (action: 'prev' | 'next' | 'today') => {
    setDate(currentDate => {
      const today = startOfDay(new Date());
      if (action === 'today') {
        return today;
      }
      const amount = action === 'prev' ? -1 : 1;
      switch (viewMode) {
        case 'day':
          return addDays(currentDate, amount);
        case 'week':
          return addWeeks(currentDate, amount);
        default:
          return currentDate;
      }
    });
  };

  const totalPages = Math.ceil(totalItems / ITEMS_PER_PAGE);



  return (
    <div className="flex flex-col h-screen">
      {filterWorkItemId && (
        <div className="p-2 mx-4 mt-2 rounded border bg-[rgb(var(--color-primary-50))] border-[rgb(var(--color-primary-200))]">
          <p className="text-[rgb(var(--color-primary-800))] font-medium">
            Showing filtered work items
          </p>
        </div>
      )}
      <div className="flex flex-1 overflow-hidden">
        <div className="w-1/4 p-2 bg-[rgb(var(--color-border-50))] overflow-y-auto">
          <h2 className="text-xl font-bold mb-4 text-[rgb(var(--color-text-900))]">Work Items</h2>

          <div className="space-y-3 mb-4">
            <div className="flex gap-2 justify-between">
              <Input
                id="work-item-search"
                type="text"
                placeholder="Search work items..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setCurrentPage(1);
                }}
                className="flex-grow mb-0"
              />
              <Button
                id="sort-work-items"
                variant="outline"
                size="sm"
                onClick={() => {
                  setSortOrder(order => order === 'asc' ? 'desc' : 'asc');
                  setCurrentPage(1);
                }}
              >
                {sortOrder === 'asc' ? '↑' : '↓'}
              </Button>
            </div>

            <div className="flex gap-2 justify-between items-center">
              <CustomSelect
                value={selectedStatusFilter}
                onValueChange={(value: string) => {
                  setSelectedStatusFilter(value);
                  setCurrentPage(1);
                }}
                options={statusFilterOptions}
                placeholder="Filter by status..."
              />

              <div className="flex items-center gap-2">
                <span className={`text-sm`}>
                  {filterUnscheduled ? 'Unscheduled' : 'Scheduled'}
                </span>
                <Switch
                  id="schedule-filter"
                  checked={!filterUnscheduled}
                  onCheckedChange={(checked: boolean) => {
                    setFilterUnscheduled(!checked);
                    setCurrentPage(1);
                  }}
                />
              </div>
            </div>
          </div>

          <div className="space-y-2 mb-4">
            {workItems.map((item): JSX.Element => (
              <div
                key={item.work_item_id}
                className="p-2 border border-[rgb(var(--color-border-200))] rounded bg-white cursor-move hover:bg-[rgb(var(--color-border-50))] transition-colors"
                draggable="true"
                onDragStart={(e) => handleDragStart(e, item.work_item_id, item)}
                onDrag={handleDrag}
                onDragEnd={handleDragEnd}
              >
                <WorkItemCard
                  title={item.name}
                  description={item.description}
                  type={item.type}
                  isBillable={item.is_billable}
                  needsDispatch={item.needsDispatch}
                  agentsNeedingDispatch={item.agentsNeedingDispatch}
                  onClick={(e: React.MouseEvent) => {
                    e.stopPropagation(); // Prevent drag event from firing
                    openDrawer(
                      <WorkItemDetailsDrawer
                        workItem={item as IExtendedWorkItem}
                        onClose={async () => {
                          await refreshAllData();
                          closeDrawer();
                        }}
                        onTaskUpdate={async (updatedTask) => {
                          try {
                            await refreshAllData();
                            toast.success('Task updated successfully');
                            closeDrawer();
                          } catch (err) {
                            console.error('Error updating task:', err);
                            toast.error('Failed to update task');
                          }
                        }}
                        onScheduleUpdate={async (entryData) => {
                          try {
                            const existingEvent = events.find(e => e.work_item_id === item.work_item_id);

                            console.log('Existing event found:', existingEvent);
                            console.log('Current item:', item);
                            
                            if (existingEvent) {
                              // Update existing entry
                              const updateResult = await updateScheduleEntry(existingEvent.entry_id, {
                                ...entryData,
                                work_item_id: item.work_item_id,
                                work_item_type: item.type,
                                title: entryData.title || item.name
                              });
                              
                              if (updateResult.success && updateResult.entry) {
                                const updatedEntry = updateResult.entry as Omit<IScheduleEntry, 'tenant'>;
                                setEvents(prevEvents => prevEvents.map(e => 
                                  e.entry_id === existingEvent.entry_id ? updatedEntry : e
                                ));
                                toast.success('Schedule entry updated successfully');
                              } else {
                                setError('Failed to update schedule entry');
                                toast.error('Failed to update schedule entry');
                              }
                            } else if (item.type !== 'ad_hoc') {
                              // Create new entry
                              const createResult = await addScheduleEntry(
                                {
                                  ...entryData,
                                  work_item_id: item.work_item_id,
                                  work_item_type: item.type,
                                  title: entryData.title || item.name
                                },
                                { assignedUserIds: entryData.assigned_user_ids }
                              );
                              
                              if (createResult.success && createResult.entry) {
                                const newEntry = createResult.entry as Omit<IScheduleEntry, 'tenant'>;
                                setEvents(prevEvents => [...prevEvents, newEntry]);
                                toast.success('Schedule entry created successfully');
                              } else {
                                setError('Failed to create schedule entry');
                                toast.error('Failed to create schedule entry');
                              }
                            }
                          } catch (err) {
                            console.error('Error saving schedule entry:', err);
                            setError('Failed to save schedule entry');
                            toast.error('Failed to save schedule entry');
                          }
                          closeDrawer();
                        }}
                      />
                    );
                  }}
                />
              </div>
            ))}
          </div>

          {totalPages > 1 && (
            <div className="flex justify-center items-center gap-2">
              <button
                onClick={() => setCurrentPage(page => Math.max(1, page - 1))}
                disabled={currentPage === 1}
                className="p-2 border border-[rgb(var(--color-border-200))] rounded bg-white text-[rgb(var(--color-text-900))] hover:bg-[rgb(var(--color-border-100))] transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:border-[rgb(var(--color-primary-400))] focus:ring-1 focus:ring-[rgb(var(--color-primary-400))]"
              >
                Previous
              </button>
              <span className="text-[rgb(var(--color-text-700))]">
                Page {currentPage} of {totalPages}
              </span>
              <button
                onClick={() => setCurrentPage(page => Math.min(totalPages, page + 1))}
                disabled={currentPage === totalPages}
                className="p-2 border border-[rgb(var(--color-border-200))] rounded bg-white text-[rgb(var(--color-text-900))] hover:bg-[rgb(var(--color-border-100))] transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:border-[rgb(var(--color-primary-400))] focus:ring-1 focus:ring-[rgb(var(--color-primary-400))]"
              >
                Next
              </button>
            </div>
          )}

          <div className="text-sm text-[rgb(var(--color-text-600))] mt-2 text-center">
            Showing {workItems.length} of {totalItems} items
          </div>
        </div>

        {/* Right Panel: Schedule View */}
        <div className="flex-1 p-4 bg-white overflow-hidden flex flex-col">
          {/* Header Section */}
          <div className="flex flex-wrap justify-between items-center mb-4 gap-4 border-b border-[rgb(var(--color-border-200))] pb-4">
            <h2 className="text-xl font-bold text-[rgb(var(--color-text-900))]">Technician Dispatch</h2>
            <div className="flex items-center gap-2 flex-wrap">
               {/* View Mode Switcher - Styled like rbc-toolbar */}
               <div className="flex items-center rounded-md border border-[rgb(var(--color-border-200))] overflow-hidden">
                  <Button
                    id="dispatch-day-view-button"
                    variant={viewMode === 'day' ? 'default' : 'ghost'}
                    size="sm"
                    onClick={() => handleViewChange('day')}
                    className={`px-3 py-1 rounded-none border-r border-[rgb(var(--color-border-200))] ${viewMode === 'day' ? 'text-white hover:bg-[rgb(var(--color-primary-600))]' : 'text-[rgb(var(--color-text-700))] hover:bg-[rgb(var(--color-border-100))]'}`}
                  >
                    Day
                  </Button>
                  <Button
                    id="dispatch-week-view-button"
                    variant={viewMode === 'week' ? 'default' : 'ghost'}
                    size="sm"
                    onClick={() => handleViewChange('week')}
                    className={`px-3 py-1 rounded-none border-r border-[rgb(var(--color-border-200))] ${viewMode === 'week' ? 'text-white hover:bg-[rgb(var(--color-primary-600))]' : 'text-[rgb(var(--color-text-700))] hover:bg-[rgb(var(--color-border-100))]'}`}
                  >
                    Week
                  </Button>
                </div>


              {/* Date Navigation - Styled like rbc-toolbar */}
              <div className="flex items-center gap-1">
                <Button
                  id="dispatch-prev-button"
                  variant="outline"
                  size="sm"
                  onClick={() => handleNavigate('prev')}
                  aria-label={`Previous ${viewMode}`}
                  className="px-3 py-1 text-[rgb(var(--color-text-700))] border-[rgb(var(--color-border-200))] hover:bg-[rgb(var(--color-border-100))]"
                >
                  {'< Prev'}
                </Button>
                <Button
                  id="dispatch-today-button"
                  variant="outline"
                  size="sm"
                  onClick={() => handleNavigate('today')}
                  className="px-3 py-1 text-[rgb(var(--color-text-700))] border-[rgb(var(--color-border-200))] hover:bg-[rgb(var(--color-border-100))]"
                >
                  Today
                </Button>
                <Button
                  id="dispatch-next-button"
                  variant="outline"
                  size="sm"
                  onClick={() => handleNavigate('next')}
                  aria-label={`Next ${viewMode}`}
                  className="px-3 py-1 text-[rgb(var(--color-text-700))] border-[rgb(var(--color-border-200))] hover:bg-[rgb(var(--color-border-100))]"
                >
                  {'Next >'}
                </Button>
              </div>
              <div className="text-[rgb(var(--color-text-900))] font-medium text-center min-w-[250px]">
                {date.toLocaleDateString('en-US', {
                  // Adjust format based on view? Maybe just keep it simple for now.
                  // weekday: 'long',
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric'
                })}
              </div>
            </div>
          </div>

          {/* Schedule Area */}
          {/* TODO: Implement conditional rendering based on viewMode (Step 3.1 Conditional Rendering) */}
          <div className="technician-schedule-grid flex-1 overflow-hidden">
            {/* Placeholder for conditional rendering */}
            {viewMode === 'day' && (
              <TechnicianScheduleGrid
                // TODO: Update technicians prop based on primary/comparison IDs
                technicians={users}
                events={events}
                selectedDate={date}
                onDrop={handleDrop}
                onTechnicianClick={handleTechnicianClick}
                onResize={onResize}
                onDeleteEvent={handleDeleteEvent}
                onEventClick={async (event: Omit<IScheduleEntry, 'tenant'>) => {
                  try {
                    const workItemDetails = await getWorkItemById(event.work_item_id || event.entry_id, event.work_item_type);

                  if (!workItemDetails) {
                    toast.error('Could not load work item details.');
                    return;
                  }

                  openDrawer(
                    <WorkItemDetailsDrawer
                      workItem={workItemDetails}
                      onClose={async () => {
                        await refreshAllData();
                        closeDrawer();
                      }}
                      onTaskUpdate={async (updatedTask) => {
                        try {
                          await refreshAllData();
                          toast.success('Task updated successfully');
                          closeDrawer();
                        } catch (err) {
                          console.error('Error updating task:', err);
                          toast.error('Failed to update task');
                        }
                      }}
                      onScheduleUpdate={async (entryData) => {
                        try {
                           const updateResult = await updateScheduleEntry(event.entry_id, {
                              ...entryData,
                              work_item_id: workItemDetails.work_item_id,
                              work_item_type: workItemDetails.type,
                              title: entryData.title || workItemDetails.name
                            });

                            if (updateResult.success && updateResult.entry) {
                              const updatedEntry = updateResult.entry as Omit<IScheduleEntry, 'tenant'>;
                              setEvents(prevEvents => prevEvents.map(e =>
                                e.entry_id === event.entry_id ? updatedEntry : e
                              ));
                              toast.success('Schedule entry updated successfully');
                            } else {
                              setError('Failed to update schedule entry');
                              toast.error('Failed to update schedule entry');
                            }
                        } catch (err) {
                          console.error('Error saving schedule entry:', err);
                          setError('Failed to save schedule entry');
                          toast.error('Failed to save schedule entry');
                        }
                        closeDrawer();
                      }}
                    /> 
                  );
                } catch (err) {
                  console.error('Error opening work item details:', err);
                  toast.error('Failed to open work item details.');
                }
              }}
                />
            )}
             {viewMode === 'week' && <div className="p-4 text-center text-[rgb(var(--color-text-500))]">Weekly View Placeholder</div>}
          </div>
        </div>
      </div>

      {totalPages > 1 && (
        <div className="flex justify-center items-center gap-2">
          <button
            onClick={() => setCurrentPage(page => Math.max(1, page - 1))}
            disabled={currentPage === 1}
            className="p-2 border border-[rgb(var(--color-border-200))] rounded bg-white text-[rgb(var(--color-text-900))] hover:bg-[rgb(var(--color-border-100))] transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:border-[rgb(var(--color-primary-400))] focus:ring-1 focus:ring-[rgb(var(--color-primary-400))]"
          >
            Previous
          </button>
          <span className="text-[rgb(var(--color-text-700))]">
            Page {currentPage} of {totalPages}
          </span>
          <button
            onClick={() => setCurrentPage(page => Math.min(totalPages, page + 1))}
            disabled={currentPage === totalPages}
            className="p-2 border border-[rgb(var(--color-border-200))] rounded bg-white text-[rgb(var(--color-text-900))] hover:bg-[rgb(var(--color-border-100))] transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:border-[rgb(var(--color-primary-400))] focus:ring-1 focus:ring-[rgb(var(--color-primary-400))]"
          >
            Next
          </button>
        </div>
      )}

      <div className="text-sm text-[rgb(var(--color-text-600))] mt-2 text-center">
        Showing {workItems.length} of {totalItems} items
      </div>
      {dragOverlay && dragOverlay.visible && (
        <div
          style={{
            position: 'fixed',
            left: dragOverlay.x ?? 0, 
            top: dragOverlay.y ?? 0,
            transform: 'translate(-50%, -50%)', 
            pointerEvents: 'none',
            zIndex: 9999,
            opacity: 0.6,
          }}
          className="p-2 border border-[rgb(var(--color-border-200))] rounded bg-white shadow-lg"
        >
          <WorkItemCard
            title={dragOverlay.item?.name || ''}
            description={dragOverlay.item?.description || ''}
            type={dragOverlay.item?.type || 'ticket'}
            isBillable={dragOverlay.item?.is_billable || false}
          />
        </div>
      )}
    </div>
  );
};

export default TechnicianDispatchDashboard;
