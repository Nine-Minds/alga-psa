'use client';

import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { produce, enableMapSet } from 'immer';
import { useSession } from 'next-auth/react';
import { WorkItemDetailsDrawer } from './WorkItemDetailsDrawer';
import { useDrawer } from "@alga-psa/ui";
import { IScheduleEntry, IEditScope } from '@alga-psa/types';
import { WorkItemType, IWorkItem, IExtendedWorkItem } from '@alga-psa/types';
import { IUser } from '@shared/interfaces/user.interfaces';
import WorkItemListPanel from './WorkItemListPanel';
import ScheduleViewPanel from './ScheduleViewPanel';
import WorkItemCard from './WorkItemCard';
import { getAllUsersBasic } from '@alga-psa/users/actions';
import { useUserPreference } from '@alga-psa/ui';
import { searchDispatchWorkItems, getWorkItemById, DispatchSearchOptions } from '@alga-psa/scheduling/actions';
import { addScheduleEntry, updateScheduleEntry, getScheduleEntries, deleteScheduleEntry, ScheduleActionResult } from '@alga-psa/scheduling/actions';
import { getWorkItemStatusOptions, StatusOption } from '@alga-psa/reference-data/actions';
import { checkCurrentUserPermission, checkCurrentUserPermissions } from '@alga-psa/auth/actions';
import { getCurrentUser } from '@alga-psa/users/actions';
import { toast } from 'react-hot-toast';
import { DragState } from '@alga-psa/types';
import { HighlightedSlot } from '@alga-psa/types';
import { DropEvent } from '@alga-psa/types';
import { addDays, addWeeks, addMonths, startOfDay, subDays, subWeeks, subMonths, endOfDay, startOfWeek, endOfWeek } from 'date-fns';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { AlertCircle } from 'lucide-react';
import EntryPopup from '@alga-psa/scheduling/components/schedule/EntryPopup';
import Spinner from '@alga-psa/ui/components/Spinner';
import { QuickAddTicket } from '@alga-psa/tickets/components';
import { ITicket } from '@alga-psa/types';

enableMapSet();

const calculateDateRange = (date: Date, viewMode: 'day' | 'week') => {
  if (viewMode === 'day') {
    return { start: startOfDay(date), end: endOfDay(date) };
  } else {
    return { start: startOfWeek(date), end: endOfWeek(date) };
  }
};


interface TechnicianDispatchDashboardProps {
  filterWorkItemId?: string;
  filterWorkItemType?: WorkItemType;
}

const TechnicianDispatchDashboard: React.FC<TechnicianDispatchDashboardProps> = ({
  filterWorkItemId,
  filterWorkItemType
}) => {
  const { data: session } = useSession();
  const currentUser = session?.user;

  const [selectedPriority, setSelectedPriority] = useState('All');
  const [users, setUsers] = useState<Omit<IUser, 'tenant'>[]>([]); // Changed type here
  const [events, setEvents] = useState<Omit<IScheduleEntry, 'tenant'>[]>([]);
  const [workItems, setWorkItems] = useState<Omit<IExtendedWorkItem, "tenant">[]>([]);
  const [date, setDate] = useState(startOfDay(new Date()));
  
  // Use the custom hook for dispatch view preference
  const { 
    value: viewMode, 
    setValue: setViewMode,
    isLoading: isViewModeLoading 
  } = useUserPreference<'day' | 'week'>(
    'defaultDispatchView',
    {
      defaultValue: 'day',
      localStorageKey: 'defaultDispatchView',
      debounceMs: 300
    }
  );
  
  const [primaryTechnicianId, setPrimaryTechnicianId] = useState<string | null>(null);
  const [comparisonTechnicianIds, setComparisonTechnicianIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null); // General error state
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
  const [showInactiveUsers, setShowInactiveUsers] = useState<boolean>(false);
  const [isQuickAddTicketOpen, setIsQuickAddTicketOpen] = useState<boolean>(false);

  // Permission states
  const [canView, setCanView] = useState<boolean | null>(null);
  const [canEdit, setCanEdit] = useState<boolean | null>(null);
  const [isAdmin, setIsAdmin] = useState<boolean>(false);
  const [isLoadingPermissions, setIsLoadingPermissions] = useState(true);
  const [permissionError, setPermissionError] = useState<string | null>(null);

  const searchTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);
  const isDraggingRef = useRef(false);
  const dragStateRef = useRef<DragState | null>(null);
  // Updated ref to use new state variables
  const searchParamsRef = useRef({
    selectedStatusFilter,
    filterUnscheduled,
    sortOrder,
    currentPage,
  });

  const saveTimeoutRef = useRef<number | undefined>(undefined);

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
      const start = startOfDay(date);
      const end = endOfDay(date);

      const searchOptions: DispatchSearchOptions = {
        searchTerm: query,
        statusFilter: selectedStatusFilter,
        filterUnscheduled: filterUnscheduled,
        sortBy: 'name',
        sortOrder,
        page: currentPage,
        pageSize: ITEMS_PER_PAGE,
        dateRange: {
           start,
           end
        },
        workItemId: filterWorkItemId
      };


      const result = await searchDispatchWorkItems(searchOptions);
      setWorkItems(result.items);
      setTotalItems(result.total);
    } catch (err) {
      console.error('Error searching work items:', err);
      setError('Failed to search work items');
    }
  }, [date, filterWorkItemType, filterWorkItemId, currentUser, canEdit, canView]);

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

      const { start, end } = calculateDateRange(date, viewMode);

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
  }, [performSearch, searchQuery, date, viewMode]);


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

  // Fetch Permissions and Admin Status using batched permission check
  useEffect(() => {
    const fetchPermissionsAndAdminStatus = async () => {
      setIsLoadingPermissions(true);
      setPermissionError(null);
      try {
        // Check if user is admin
        const currentUser = await getCurrentUser();
        const userIsAdmin = currentUser ? currentUser.roles.some(role => role.role_name.toLowerCase() === 'admin') : false;
        setIsAdmin(userIsAdmin);

        
        // If admin, grant all permissions
        if (userIsAdmin) {
          setCanView(true);
          setCanEdit(true);
        } else {
          // Otherwise, check specific permissions
          const permissionResults = await checkCurrentUserPermissions([
            { resource: 'technician_dispatch', action: 'read' },
            { resource: 'technician_dispatch', action: 'update' }
          ]);
          
          const viewPermission = permissionResults.find(
            p => p.resource === 'technician_dispatch' && p.action === 'read'
          );
          const editPermission = permissionResults.find(
            p => p.resource === 'technician_dispatch' && p.action === 'update'
          );
          
          setCanView(viewPermission?.granted ?? false);
          setCanEdit(editPermission?.granted ?? false);
        }
      } catch (err) {
        console.error('Error fetching permissions:', err);
        setPermissionError('Failed to load permissions.');
        setCanView(false);
        setCanEdit(false);
      } finally {
        setIsLoadingPermissions(false);
      }
    };
    fetchPermissionsAndAdminStatus();
  }, []);

  useEffect(() => {
    if (isLoadingPermissions || !canView) return;

    const fetchInitialData = async () => {
      try {
        if (canEdit || canView) {
          // Fetch all users including inactive ones - we'll filter them in the display logic
          const fetchedUsers = await getAllUsersBasic(true, 'internal');
          setUsers(fetchedUsers);
        } else {
          setUsers([]);
        }

        const { start, end } = calculateDateRange(date, viewMode);

        const scheduleResult = await getScheduleEntries(start, end);
        if (scheduleResult.success && scheduleResult.entries) {
          setEvents(scheduleResult.entries);
        } else {
          setError('Failed to fetch schedule entries');
        }
        await performSearch(searchQuery);

      } catch (err) {
        console.error('Error fetching data:', err);
        setError('Failed to fetch data');
      }
    };

    fetchInitialData();
  }, [date, viewMode, isLoadingPermissions, canView, canEdit, performSearch, searchQuery]);


  useEffect(() => {
    if (isLoadingPermissions || !canView) return;
    debouncedSearch(searchQuery);
  }, [searchQuery, selectedStatusFilter, filterUnscheduled, sortOrder, currentPage, debouncedSearch, isLoadingPermissions, canView]);

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
    const canPerformDrop = canEdit || (currentUser && dropEvent.techId === currentUser.id);

    if (!canPerformDrop) {
      toast.error("You don't have permission to schedule for this technician.");
      setHighlightedSlots(null);
      return;
    }

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
        if (result.isPrivateError) {
          toast.error(result.error || 'This is a private entry. Only the creator can delete it.');
        } else {
          setError('Failed to delete schedule entry');
        }
      }
    } catch (err) {
      console.error('Error deleting schedule entry:', err);
      setError('Failed to delete schedule entry');
    }
  }, []);

  const handleViewChange = (newViewMode: 'day' | 'week') => {
    setViewMode(newViewMode);
  };

  useEffect(() => {
    if (viewMode === 'week' && canView && !canEdit && currentUser) {
      setPrimaryTechnicianId(currentUser.id);
      setComparisonTechnicianIds(new Set());
    }
    else if (viewMode !== 'week' && primaryTechnicianId === currentUser?.id && !canEdit) {
       setPrimaryTechnicianId(null);
    }
  }, [viewMode, canView, canEdit, currentUser, primaryTechnicianId]);


  const handleTechnicianClick = (technicianId: string) => {
    setViewMode('week');
    
    setComparisonTechnicianIds(
      produce((draft) => {
        draft.delete(technicianId);
      })
    );
    
    setPrimaryTechnicianId(technicianId);
  };

  const handleComparisonChange = (technicianId: string, isSelected: boolean) => {
    setComparisonTechnicianIds(
      produce((draft) => {
        if (isSelected) {
          draft.add(technicianId);
        } else {
          draft.delete(technicianId);
        }
      })
    );
  };
  
  const handleResetSelections = () => {
    setPrimaryTechnicianId(null);
    setComparisonTechnicianIds(new Set());
  };
  
  const handleSelectAll = () => {
    const techIds = new Set<string>();
    displayedTechnicians.forEach(tech => {
      if (tech.user_id !== primaryTechnicianId) {
        techIds.add(tech.user_id);
      }
    });
    setComparisonTechnicianIds(techIds);
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

  const displayedTechnicians = useMemo(() => {
    if (isLoadingPermissions || !currentUser) {
      return [];
    }
    
    // Filter users based on permissions
    let filteredUsers: Omit<IUser, 'tenant'>[] = [];
    if (canEdit) {
      filteredUsers = [...users];
    } else if (canView) {
      filteredUsers = users.filter(user => user.user_id === currentUser.id);
    }
    
    // Filter out inactive users unless showInactiveUsers is true
    if (!showInactiveUsers) {
      filteredUsers = filteredUsers.filter(user => !user.is_inactive);
    }
    
    // Sort technicians alphabetically by first name, then last name
    return filteredUsers.sort((a, b) => {
      // First sort by first name
      const firstNameA = (a.first_name || '').toLowerCase();
      const firstNameB = (b.first_name || '').toLowerCase();
      
      if (firstNameA < firstNameB) return -1;
      if (firstNameA > firstNameB) return 1;
      
      // If first names are the same, sort by last name
      const lastNameA = (a.last_name || '').toLowerCase();
      const lastNameB = (b.last_name || '').toLowerCase();
      
      if (lastNameA < lastNameB) return -1;
      if (lastNameA > lastNameB) return 1;
      
      return 0;
    });
  }, [users, canView, canEdit, currentUser, isLoadingPermissions, showInactiveUsers]);

  const displayedEvents = useMemo(() => {
    if (displayedTechnicians.length === 0 && viewMode === 'week') {
      return [];
    }
    const displayedTechIds = new Set(displayedTechnicians.map(t => t.user_id));
    return events.filter(event =>
      event.assigned_user_ids.some(assignedId => displayedTechIds.has(assignedId))
    );
  }, [events, displayedTechnicians, viewMode]);


  const handleWorkItemClick = useCallback((e: React.MouseEvent, item: Omit<IExtendedWorkItem, "tenant">) => {
    e.stopPropagation();
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
            const existingEvent = events.find(ev => ev.work_item_id === item.work_item_id);

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
                setEvents(prevEvents => prevEvents.map(ev =>
                  ev.entry_id === existingEvent.entry_id ? updatedEntry : ev
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
  }, [openDrawer, closeDrawer, refreshAllData, events, updateScheduleEntry, addScheduleEntry]);

  const handleTicketAdded = useCallback(async (ticket: ITicket) => {
    await refreshAllData();
    toast.success('Ticket created successfully');
  }, [refreshAllData]);

  const handleEventClick = useCallback(async (event: Omit<IScheduleEntry, 'tenant'>) => {
    try {
      // Check if this is a private event that the user doesn't own
      const isPrivateEvent = event.is_private;
      const isCreator = event.assigned_user_ids?.length === 1 && 
                       event.assigned_user_ids[0] === session?.user?.id;
      const isPrivateNonOwner = isPrivateEvent && !isCreator;
      
      // If this is a private event and the user is not the creator, show the entry popup in view-only mode with "Busy" title
      if (isPrivateNonOwner) {
        // Create a modified version of the event with "Busy" title for non-owners
        const privateEvent = {
          ...event,
          title: "Busy",
          notes: ""
        };
        
        // Get all users for the EntryPopup component
        const allUsers = await getAllUsersBasic();
        
        // Open the entry popup in view-only mode
        openDrawer(
          <EntryPopup
            event={privateEvent}
            onClose={closeDrawer}
            onSave={async () => {}} // No-op since it's view-only
            canAssignMultipleAgents={true}
            users={allUsers}
            currentUserId={session?.user?.id || ""}
            canModifySchedule={false}
            focusedTechnicianId={null}
            canAssignOthers={false}
            viewOnly={true}
            isInDrawer={true}
          />
        );
        return;
      }
      
      let workItemId = event.work_item_id || event.entry_id;
      
      if (workItemId.includes('_')) {
        const [masterId] = workItemId.split('_');
        console.log(`Detected recurring event. Using master ID: ${masterId} instead of virtual ID: ${workItemId}`);
        workItemId = masterId;
      }
      
      const workItemDetails = await getWorkItemById(workItemId, event.work_item_type);

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
              let entryId = event.entry_id;
              
              if (entryId.includes('_')) {
                console.log(`Updating recurring event instance: ${entryId} with type: SINGLE`);
              }
              
              const updateResult = await updateScheduleEntry(entryId, {
                ...entryData,
                work_item_id: workItemDetails.work_item_id,
                work_item_type: workItemDetails.type,
                title: entryData.title || workItemDetails.name,
                updateType: IEditScope.SINGLE
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
  }, [openDrawer, closeDrawer, refreshAllData, getWorkItemById, updateScheduleEntry]);


  if (isLoadingPermissions || isViewModeLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Spinner size="lg" />
      </div>
    );
  }

  if (permissionError) {
    return (
      <div className="p-4">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{permissionError || 'An unknown error occurred.'}</AlertDescription>
        </Alert>
      </div>
    );
  }

  if (canView === false) {
     return (
      <div className="p-4">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>Access Denied: You do not have permission to view the Technician Dispatch dashboard.</AlertDescription>
        </Alert>
      </div>
    );
  }

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
        <WorkItemListPanel
          workItems={workItems}
          totalItems={totalItems}
          currentPage={currentPage}
          totalPages={totalPages}
          searchQuery={searchQuery}
          selectedStatusFilter={selectedStatusFilter}
          filterUnscheduled={filterUnscheduled}
          sortOrder={sortOrder}
          statusFilterOptions={statusFilterOptions}
          onSearchChange={(query) => {
            setSearchQuery(query);
            setCurrentPage(1);
          }}
          onStatusFilterChange={(value) => {
            setSelectedStatusFilter(value);
            setCurrentPage(1);
          }}
          onUnscheduledFilterChange={(checked) => {
            setFilterUnscheduled(!checked);
            setCurrentPage(1);
          }}
          onSortChange={() => {
            setSortOrder(order => order === 'asc' ? 'desc' : 'asc');
            setCurrentPage(1);
          }}
          onPageChange={setCurrentPage}
          onWorkItemClick={handleWorkItemClick}
          onWorkItemDragStart={handleDragStart}
          onWorkItemDrag={handleDrag}
          onWorkItemDragEnd={handleDragEnd}
          canEdit={canEdit ?? false}
        />

        <ScheduleViewPanel
          viewMode={viewMode}
          date={date}
          events={displayedEvents}
          technicians={displayedTechnicians}
          primaryTechnicianId={primaryTechnicianId}
          comparisonTechnicianIds={comparisonTechnicianIds}
          onNavigate={handleNavigate}
          onViewChange={handleViewChange}
          onTechnicianClick={handleTechnicianClick}
          onComparisonChange={handleComparisonChange}
          onDrop={handleDrop}
          onResize={onResize}
          onDeleteEvent={handleDeleteEvent}
          onEventClick={handleEventClick}
          onDropFromList={handleDrop}
          onSelectSlot={(slotInfo) => { /* Placeholder for select slot */ console.log("Slot selected:", slotInfo); }}
          onResetSelections={handleResetSelections}
          onSelectAll={handleSelectAll}
          canEdit={canEdit ?? false}
          showInactiveUsers={showInactiveUsers}
          onShowInactiveUsersChange={setShowInactiveUsers}
          onQuickAddTicket={() => setIsQuickAddTicketOpen(true)}
        />
      </div>

      {/* Drag Overlay remains in the parent */}
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
            // isBillable
          />
        </div>
      )}

      {/* Quick Add Ticket Dialog */}
      <QuickAddTicket
        open={isQuickAddTicketOpen}
        onOpenChange={setIsQuickAddTicketOpen}
        onTicketAdded={handleTicketAdded}
      />
    </div>
  );
};

export default TechnicianDispatchDashboard;
