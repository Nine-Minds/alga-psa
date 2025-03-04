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
import { searchWorkItems } from 'server/src/lib/actions/workItemActions';
import { addScheduleEntry, updateScheduleEntry, getScheduleEntries, deleteScheduleEntry, ScheduleActionResult } from 'server/src/lib/actions/scheduleActions';
import { toast } from 'react-hot-toast';
import CustomSelect from 'server/src/components/ui/CustomSelect';
import { DragState } from 'server/src/interfaces/drag.interfaces';
import { HighlightedSlot } from 'server/src/interfaces/schedule.interfaces';
import { DropEvent } from 'server/src/interfaces/event.interfaces';

const TechnicianDispatchDashboard: React.FC = () => {
  const [selectedPriority, setSelectedPriority] = useState('All');
  const [technicians, setTechnicians] = useState<Omit<IUser, 'tenant'>[]>([]);
  const [events, setEvents] = useState<Omit<IScheduleEntry, 'tenant'>[]>([]);
  const [workItems, setWorkItems] = useState<Omit<IWorkItem, "tenant">[]>([]);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [highlightedSlots, setHighlightedSlots] = useState<Set<HighlightedSlot> | null>(null);
  const [selectedType, setSelectedType] = useState<WorkItemType | 'all'>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [sortBy, setSortBy] = useState<'name' | 'type'>('name');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [totalItems, setTotalItems] = useState(0);
  const ITEMS_PER_PAGE = 10;

  const typeOptions = [
    { value: 'all', label: 'All Types' },
    { value: 'ticket', label: 'Tickets' },
    { value: 'project_task', label: 'Project Tasks' },
    { value: 'ad_hoc', label: 'Ad Hoc Entries'},
    { value: 'non_billable_category', label: 'Non-Billable' }
  ];

  const sortOptions = [
    { value: 'name', label: 'Sort by Name' },
    { value: 'type', label: 'Sort by Type' }
  ];

  const searchTimeoutRef = useRef<NodeJS.Timeout>();
  const isDraggingRef = useRef(false);
  const dragStateRef = useRef<DragState | null>(null);
  const searchParamsRef = useRef({
    selectedType,
    sortBy,
    sortOrder,
    currentPage,
  });

  const saveTimeoutRef = useRef<number>();

  useEffect(() => {
    searchParamsRef.current = {
      selectedType,
      sortBy,
      sortOrder,
      currentPage,
    };
  }, [selectedType, sortBy, sortOrder, currentPage]);

  const performSearch = useCallback(async (query: string) => {
    try {
      const { selectedType, sortBy, sortOrder, currentPage } = searchParamsRef.current;
      // Get start and end of selected date
      const start = new Date(selectedDate);
      start.setHours(0, 0, 0, 0);
      const end = new Date(selectedDate);
      end.setHours(23, 59, 59, 999);

      const result = await searchWorkItems({
        searchTerm: query,
        type: selectedType,
        sortBy,
        sortOrder,
        page: currentPage,
        pageSize: ITEMS_PER_PAGE,
        dateRange: {
          start,
          end
        }
      });

      setWorkItems(result.items);
      setTotalItems(result.total);
    } catch (err) {
      console.error('Error searching work items:', err);
      setError('Failed to search work items');
    }
  }, []);

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
        const users = await getAllUsers();
        setTechnicians(users);

        const start = new Date(selectedDate);
        start.setHours(0, 0, 0, 0);
        const end = new Date(selectedDate);
        end.setHours(23, 59, 59, 999);

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
  }, [selectedDate]);

  useEffect(() => {
    debouncedSearch(searchQuery);
  }, [searchQuery, selectedType, sortBy, sortOrder, currentPage, debouncedSearch]);

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

    // const handleDragEnd = () => {
    //   setDragOverlay(null);
    // };

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

  const totalPages = Math.ceil(totalItems / ITEMS_PER_PAGE);

  return (
    <div className="flex flex-col h-screen">
      <div className="flex flex-1 overflow-hidden">
        <div className="w-1/4 p-2 bg-[rgb(var(--color-border-50))] overflow-y-auto">
          <h2 className="text-xl font-bold mb-4 text-[rgb(var(--color-text-900))]">Unassigned Work Items</h2>

          <div className="space-y-3 mb-4">
            <input
              type="text"
              placeholder="Search work items..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full p-2 border border-[rgb(var(--color-border-200))] rounded bg-white text-[rgb(var(--color-text-900))] placeholder-[rgb(var(--color-text-400))] focus:outline-none focus:border-[rgb(var(--color-primary-400))] focus:ring-1 focus:ring-[rgb(var(--color-primary-400))]"
            />

            <div className="flex gap-2">
              <CustomSelect
                value={selectedType}
                onValueChange={(value: string) => {
                  setSelectedType(value as WorkItemType | 'all');
                  setCurrentPage(1);
                }}
                options={typeOptions}
                className="flex-1"
              />

              <CustomSelect
                value={sortBy}
                onValueChange={(value: string) => {
                  setSortBy(value as 'name' | 'type');
                  setCurrentPage(1);
                }}
                options={sortOptions}
                className="flex-1"
              />

              <button
                onClick={() => {
                  setSortOrder(order => order === 'asc' ? 'desc' : 'asc');
                  setCurrentPage(1);
                }}
                className="p-1 border border-[rgb(var(--color-border-200))] rounded bg-white text-[rgb(var(--color-text-900))] hover:bg-[rgb(var(--color-border-100))] transition-colors focus:outline-none focus:border-[rgb(var(--color-primary-400))] focus:ring-1 focus:ring-[rgb(var(--color-primary-400))]"
              >
                {sortOrder === 'asc' ? '↑' : '↓'}
              </button>
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
                  onClick={(e: React.MouseEvent) => {
                    e.stopPropagation(); // Prevent drag event from firing
                    const refreshData = async () => {
                      try {
                        // Refresh the work items list
                        await performSearch(searchQuery);
                        // Refresh schedule entries
                        const start = new Date(selectedDate);
                        start.setHours(0, 0, 0, 0);
                        const end = new Date(selectedDate);
                        end.setHours(23, 59, 59, 999);
                        const scheduleResult = await getScheduleEntries(start, end);
                        if (scheduleResult.success && scheduleResult.entries) {
                          setEvents(scheduleResult.entries);
                        }
                      } catch (err) {
                        console.error('Error refreshing data:', err);
                        toast.error('Failed to refresh data');
                      }
                    };

                    openDrawer(
                      <WorkItemDetailsDrawer
                        workItem={item as IExtendedWorkItem}
                        onClose={async () => {
                          await refreshData();
                          closeDrawer();
                        }}
                        onTaskUpdate={async (updatedTask) => {
                          try {
                            await refreshData();
                            toast.success('Task updated successfully');
                            closeDrawer();
                          } catch (err) {
                            console.error('Error updating task:', err);
                            toast.error('Failed to update task');
                          }
                        }}
                        onScheduleUpdate={async (entryData) => {
                          try {
                            // For ad hoc entries, update the existing entry instead of creating a new one
                            // For ad hoc entries, find the existing entry by work_item_id
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
                            } else {
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

        <div className="flex-1 p-4 bg-white overflow-hidden">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-bold">Technician Schedules</h2>
            <div className="flex items-center gap-4">
              <button
                onClick={() => {
                  const newDate = new Date(selectedDate);
                  newDate.setDate(newDate.getDate() - 1);
                  setSelectedDate(newDate);
                }}
                className="px-4 py-2 bg-[rgb(var(--color-primary-400))] text-white rounded hover:bg-[rgb(var(--color-primary-500))] transition-colors focus:outline-none focus:ring-2 focus:ring-[rgb(var(--color-primary-300))] focus:ring-offset-2"
              >
                Previous Day
              </button>
              <div className="text-[rgb(var(--color-text-900))] font-medium">
                {selectedDate.toLocaleDateString('en-US', { 
                  weekday: 'long',
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric'
                })}
              </div>
              <button
                onClick={() => {
                  const newDate = new Date(selectedDate);
                  newDate.setDate(newDate.getDate() + 1);
                  setSelectedDate(newDate);
                }}
                className="px-4 py-2 bg-[rgb(var(--color-primary-400))] text-white rounded hover:bg-[rgb(var(--color-primary-500))] transition-colors focus:outline-none focus:ring-2 focus:ring-[rgb(var(--color-primary-300))] focus:ring-offset-2"
              >
                Next Day
              </button>
            </div>
          </div>
          <div className="technician-schedule-grid h-[calc(100vh-160px)]">
            <TechnicianScheduleGrid
              technicians={technicians}
              events={events}
              selectedDate={selectedDate}
              onDrop={handleDrop}
              onResize={onResize}
              onDeleteEvent={handleDeleteEvent}
            />
          </div>
        </div>
      </div>
      {dragOverlay && dragOverlay.visible && (
        <div
          style={{
            position: 'fixed',
            left: dragOverlay.x,
            top: dragOverlay.y,
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
