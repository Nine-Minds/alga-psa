'use client'
import { useState, useEffect, useCallback } from 'react';
import { WorkItemList } from './WorkItemList';
import { Filter, XCircle } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { Input } from 'server/src/components/ui/Input';
import { SwitchWithLabel } from 'server/src/components/ui/SwitchWithLabel';
import Spinner from 'server/src/components/ui/Spinner';
import { IWorkItem, IExtendedWorkItem, WorkItemWithStatus, WorkItemType } from 'server/src/interfaces/workItem.interfaces';
import { ITimePeriodView } from 'server/src/interfaces/timeEntry.interfaces';
import { searchPickerWorkItems, createWorkItem } from 'server/src/lib/actions/workItemActions';
import { Button } from 'server/src/components/ui/Button';
import UserPicker from 'server/src/components/ui/UserPicker';
import { ClientPicker } from 'server/src/components/clients/ClientPicker';
import { DatePicker } from 'server/src/components/ui/DatePicker';
import { DateTimePicker } from 'server/src/components/ui/DateTimePicker';
import { IUser } from '@shared/interfaces/user.interfaces';
import { getAllUsersBasic, getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import { getAllClients } from 'server/src/lib/actions/client-actions/clientActions';
import { IClient } from 'server/src/interfaces/client.interfaces';
import CustomSelect from 'server/src/components/ui/CustomSelect';

interface WorkItemPickerProps {
  onSelect: (workItem: IWorkItem | null) => void;
  availableWorkItems: IWorkItem[];
  initialWorkItemId?: string | null;
  initialWorkItemType?: WorkItemType;
  timePeriod?: ITimePeriodView;
}

export function WorkItemPicker({ onSelect, availableWorkItems, timePeriod }: WorkItemPickerProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [workItems, setWorkItems] = useState<WorkItemWithStatus[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [includeInactive, setIncludeInactive] = useState(false);
  const [assignedTo, setAssignedTo] = useState<string>('');
  const [assignedToMe, setAssignedToMe] = useState(false);
  const [clientId, setClientId] = useState<string>('');
  const [startDate, setStartDate] = useState<Date | undefined>();
  const [endDate, setEndDate] = useState<Date | undefined>();
  const [users, setUsers] = useState<IUser[]>([]);
  const [clients, setClients] = useState<IClient[]>([]);
  const [filterState, setFilterState] = useState<'all' | 'active' | 'inactive'>('active');
  const [clientTypeFilter, setClientTypeFilter] = useState<'all' | 'company' | 'individual'>('all');
  const [isFiltersExpanded, setIsFiltersExpanded] = useState(false);
  const [showAdHocForm, setShowAdHocForm] = useState(false);
  const [adHocTitle, setAdHocTitle] = useState('');
  const [startTime, setStartTime] = useState<Date>(new Date());
  const [endTime, setEndTime] = useState<Date>(() => {
    const date = new Date();
    date.setHours(date.getHours() + 1); // Default to 1 hour duration
    return date;
  });
  const [dateErrors, setDateErrors] = useState<{
    start?: string;
    end?: string;
  }>({});
  const [searchType, setSearchType] = useState<WorkItemType | 'all'>('all');

  const validateDates = useCallback((start: Date, end: Date) => {
    const errors: { start?: string; end?: string } = {};

    // First check if end is after start
    if (end <= start) {
      errors.end = 'End time must be after start time';
    }

    // Then check time period constraints if provided
    if (timePeriod) {
      // Parse period dates (they are in YYYY-MM-DD format)
      const [periodStartYear, periodStartMonth, periodStartDay] = timePeriod.start_date.split('-').map(Number);
      const [periodEndYear, periodEndMonth, periodEndDay] = timePeriod.end_date.split('-').map(Number);

      // Create period boundaries in local time
      const periodStart = new Date(periodStartYear, periodStartMonth - 1, periodStartDay);
      const periodEnd = new Date(periodEndYear, periodEndMonth - 1, periodEndDay);

      // Get dates for comparison (strip time component)
      const startDate = new Date(start.getFullYear(), start.getMonth(), start.getDate());
      const endDate = new Date(end.getFullYear(), end.getMonth(), end.getDate());

      // Ensure we're comparing just the dates
      periodStart.setHours(0, 0, 0, 0);
      periodEnd.setHours(23, 59, 59, 999);
      startDate.setHours(0, 0, 0, 0);
      endDate.setHours(23, 59, 59, 999);

      // Format dates for display
      const formatDate = (date: Date) => {
        return date.toLocaleDateString(undefined, {
          year: 'numeric',
          month: 'long',
          day: 'numeric'
        });
      };

      const periodRange = `${formatDate(periodStart)} - ${formatDate(periodEnd)}`;
      
      if (startDate < periodStart || startDate > periodEnd) {
        errors.start = `Date must be within the current period (${periodRange})`;
      }

      if (endDate < periodStart || endDate > periodEnd) {
        errors.end = `Date must be within the current period (${periodRange})`;
      }
    }

    setDateErrors(errors);
    return Object.keys(errors).length === 0;
  }, [timePeriod]);

  // Validate dates whenever they change
  useEffect(() => {
    validateDates(startTime, endTime);
  }, [startTime, endTime, validateDates]);

  useEffect(() => {
    const loadData = async () => {
      try {
        const [fetchedUsers, fetchedClients] = await Promise.all([
          getAllUsersBasic(),
          getAllClients()
        ]);
        setUsers(fetchedUsers);
        setClients(fetchedClients);
      } catch (error) {
        console.error('Error loading data:', error);
      }
    };
    loadData();
  }, []);

  // Handle "Assigned to me" toggle
  const handleAssignedToMeChange = async (checked: boolean) => {
    setAssignedToMe(checked);
    if (checked) {
      try {
        const currentUser = await getCurrentUser();
        if (currentUser) {
          setAssignedTo(currentUser.user_id);
        }
      } catch (error) {
        console.error('Error getting current user:', error);
      }
    } else {
      setAssignedTo('');
    }
    setCurrentPage(1);
    loadWorkItems(searchTerm, 1);
  };
  const pageSize = 10;

  const loadWorkItems = useCallback(async (term: string, page: number) => {
    setIsSearching(true);
    try {
      const result = await searchPickerWorkItems({
        searchTerm: term,
        page,
        pageSize,
        sortBy: 'name',
        sortOrder: 'asc',
        includeInactive,
        assignedTo: assignedTo || undefined,
        assignedToMe,
        clientId: clientId || undefined,
        type: searchType,
        dateRange: startDate || endDate ? {
          start: startDate,
          end: endDate
        } : undefined,
        availableWorkItemIds: availableWorkItems.map(item => item.work_item_id),
        isTimesheet: !!timePeriod?.period_id,
      });
      
      const itemsWithStatus = result.items.map((item: Omit<IExtendedWorkItem, "tenant">): WorkItemWithStatus => ({
        ...item,
        status: 'Active',
        scheduled_start: item.type === 'ad_hoc' ? item.scheduled_start : undefined,
        scheduled_end: item.type === 'ad_hoc' ? item.scheduled_end : undefined
      }));

      setWorkItems(itemsWithStatus);
      setTotal(result.total);
      setHasMore(page * pageSize < result.total);
    } catch (error) {
      console.error('Error loading work items:', error);
      // Show error state in the list
      setWorkItems([]);
      setTotal(0);
      setHasMore(false);
    } finally {
      setIsSearching(false);
    }
  }, [availableWorkItems, includeInactive, assignedTo, assignedToMe, clientId, startDate, endDate, searchType]);

  // Set initial date range based on time period, but only for timesheet context
  useEffect(() => {
    // Check if we're in a timesheet context by checking if timePeriod has a period_id
    if (timePeriod?.period_id) {
      const [startYear, startMonth, startDay] = timePeriod.start_date.split('-').map(Number);
      const [endYear, endMonth, endDay] = timePeriod.end_date.split('-').map(Number);
      
      // Create Date objects for start and end of the time period
      const periodStart = new Date(startYear, startMonth - 1, startDay);
      const periodEnd = new Date(endYear, endMonth - 1, endDay);
      periodEnd.setHours(23, 59, 59, 999); // Set to end of day
      
      setStartDate(periodStart);
      setEndDate(periodEnd);
    }
  }, [timePeriod]);

  // Load initial items when component mounts or when timePeriod changes
  useEffect(() => {
    loadWorkItems('', 1);
  }, [loadWorkItems]);

  const debouncedSearch = useCallback(
    debounce((term: string) => {
      setCurrentPage(1);
      loadWorkItems(term, 1);
    }, 200),
    [loadWorkItems]
  );

  useEffect(() => {
    debouncedSearch(searchTerm);
  }, [searchTerm, debouncedSearch]);

  const handlePageChange = (newPage: number) => {
    if (!isSearching && newPage >= 1 && newPage <= Math.ceil(total / pageSize)) {
      setCurrentPage(newPage);
      loadWorkItems(searchTerm, newPage);
    }
  };

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="flex flex-col h-auto max-h-[70vh] min-h-[200px] transition-all duration-300 ease-in-out">
      <div className="flex-none bg-white dark:bg-[rgb(var(--color-border-50))] pb-4 overflow-visible">
        <div className="flex justify-between items-center mb-4">
          {!showAdHocForm ? (
            <Button
              onClick={() => setShowAdHocForm(true)}
              variant="outline"
              className="text-sm"
              id="create-adhoc-entry-btn"
            >
              Create Ad-hoc Entry
            </Button>
          ) : (
            <div className="flex items-center gap-2">
              <div className="flex flex-col gap-2 w-full">
                <Input
                  value={adHocTitle}
                  onChange={(e) => setAdHocTitle(e.target.value)}
                  placeholder="Enter title for ad-hoc entry"
                  className="flex-1"
                  autoFocus
                />
                <div className="grid grid-cols-2 gap-2">
                  <div className="flex flex-col gap-1">
                    <DateTimePicker
                      value={startTime}
                      onChange={setStartTime}
                      placeholder="Start time"
                      id="adhoc-start-time"
                      className={dateErrors.start ? 'border-red-500' : ''}
                    />
                    {dateErrors.start && (
                      <div className="text-red-500 text-sm">
                        {dateErrors.start}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col gap-1">
                    <DateTimePicker
                      value={endTime}
                      onChange={setEndTime}
                      placeholder="End time"
                      id="adhoc-end-time"
                      minDate={startTime}
                      className={dateErrors.end ? 'border-red-500' : ''}
                    />
                    {dateErrors.end && (
                      <div className="text-red-500 text-sm">
                        {dateErrors.end}
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <Button
                onClick={async () => {
                  if (!adHocTitle.trim()) return;
                  
                  // Revalidate dates before saving
                  if (!validateDates(startTime, endTime)) {
                    if (dateErrors.start) toast.error(dateErrors.start);
                    if (dateErrors.end) toast.error(dateErrors.end);
                    return;
                  }

                  try {
                    const newItem = await createWorkItem({
                      type: 'ad_hoc',
                      name: adHocTitle,
                      title: adHocTitle,
                      // is_billable: true,
                      description: '',
                      startTime,
                      endTime,
                      scheduled_start: startTime.toISOString(),
                      scheduled_end: endTime.toISOString()
                    });
                    
                    // Add to available work items to prevent duplicate showing
                    availableWorkItems.push(newItem);
                    onSelect(newItem);
                    
                    // Reset form
                    setShowAdHocForm(false);
                    setAdHocTitle('');
                  } catch (error) {
                    console.error('Error creating ad-hoc entry:', error);
                    // TODO: Show error to user
                  }
                }}
                variant="outline"
                className="text-sm whitespace-nowrap"
                disabled={!adHocTitle.trim() || Object.keys(dateErrors).length > 0}
                id="save-adhoc-entry-btn"
              >
                Save Entry
              </Button>
              <Button
                onClick={() => {
                  setShowAdHocForm(false);
                  setAdHocTitle('');
                }}
                variant="ghost"
                className="text-sm"
                id="cancel-adhoc-entry-btn"
              >
                Cancel
              </Button>
            </div>
          )}
        </div>
        <div className="flex items-center gap-4 mb-4">
          <div className="relative flex-1">
            <Input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search work items..."
              className="pl-8 bg-white dark:bg-[rgb(var(--color-border-50))] border-[rgb(var(--color-border-200))]"
            />
            <svg
              className="absolute left-2.5 top-1/2 transform -translate-y-1/2 h-4 w-4 text-[rgb(var(--color-text-400))]"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
            {isSearching && (
              <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
                <Spinner size="sm" className="scale-75" />
              </div>
            )}
          </div>
          <SwitchWithLabel
            label="Include inactive"
            checked={includeInactive}
            onCheckedChange={(checked) => {
              setIncludeInactive(checked);
              setCurrentPage(1);
              loadWorkItems(searchTerm, 1);
            }}
            className="text-sm text-[rgb(var(--color-text-600))]"
          />
          <Button
            id="toggle-filters-btn"
            variant="ghost"
            onClick={() => setIsFiltersExpanded(!isFiltersExpanded)}
            className="flex items-center gap-2 bg-[rgb(var(--color-primary-100))] hover:bg-[rgb(var(--color-primary-100))]"
          >
            <Filter className="h-4 w-4" />
            Filters
            <svg
              className={`h-4 w-4 transition-transform ${isFiltersExpanded ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </Button>
        </div>
        <div className="relative">
          <div className={`space-y-4 transition-all duration-300 ease-in-out ${isFiltersExpanded ? 'max-h-[500px] opacity-100 pointer-events-auto' : 'max-h-0 opacity-0 pointer-events-none'}`} style={{ overflow: 'visible', zIndex: 600 }}>

            <div className="grid grid-cols-2 gap-4">
              <div className="flex items-center gap-4">
                <UserPicker
                  label="Assigned to"
                  value={assignedTo}
                  onValueChange={(value) => {
                    setAssignedTo(value);
                    setCurrentPage(1);
                    loadWorkItems(searchTerm, 1);
                  }}
                  disabled={assignedToMe}
                  users={users}
                />
                <SwitchWithLabel
                  label="Assigned to me"
                  checked={assignedToMe}
                  onCheckedChange={handleAssignedToMeChange}
                  className="text-sm text-[rgb(var(--color-text-600))]"
                />
              </div>

            <div className="flex justify-end">
                <Button
                  variant="outline"
                  onClick={() => {
                    setAssignedTo('');
                    setAssignedToMe(false);
                    setClientId('');
                    setStartDate(undefined);
                    setEndDate(undefined);
                    setFilterState('active');
                    setClientTypeFilter('all');
                    setSearchType('all');
                    setSearchTerm('');
                    setCurrentPage(1);
                    loadWorkItems('', 1);
                  }}
                  className="whitespace-nowrap flex items-center gap-2"
                  id="reset-filters"
                >
                  <XCircle className="h-4 w-4" />
                  Reset Filters
                </Button>
              </div>
              </div>
            <div className="grid grid-cols-4 gap-4">
              <div className="flex items-center">
                <ClientPicker
                  id="client-picker"
                  selectedClientId={clientId}
                  onSelect={(value: string | null) => {
                    setClientId(value || '');
                    setCurrentPage(1);
                    loadWorkItems(searchTerm, 1);
                  }}
                  filterState={filterState}
                  onFilterStateChange={setFilterState}
                  clientTypeFilter={clientTypeFilter}
                  onClientTypeFilterChange={setClientTypeFilter}
                  clients={clients}
                  fitContent
                />
              </div>
              <div className="flex items-center">
                <CustomSelect
                  value={searchType}
                  onValueChange={(value) => {
                    setSearchType(value as WorkItemType | 'all');
                    setCurrentPage(1);
                    loadWorkItems(searchTerm, 1);
                  }}
                  options={[
                    { value: 'all', label: 'All Types' },
                    { value: 'ticket', label: 'Tickets' },
                    { value: 'project_task', label: 'Project Tasks' },
                    { value: 'interaction', label: 'Interactions' },
                    { value: 'ad_hoc', label: 'Ad-hoc Entries' }
                  ]}
                />
              </div>
              <div className="flex items-center">
                <DatePicker
                  label="Start date"
                  value={startDate}
                  onChange={(date) => {
                    setStartDate(date);
                    setCurrentPage(1);
                    loadWorkItems(searchTerm, 1);
                  }}
                  placeholder="Start date"
                  className="w-full"
                />
              </div>
              <div className="flex items-center">
                <DatePicker
                  label="End date"
                  value={endDate}
                  onChange={(date) => {
                    setEndDate(date);
                    setCurrentPage(1);
                    loadWorkItems(searchTerm, 1);
                  }}
                  placeholder="End date"
                  className="w-full"
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      <WorkItemList
        items={workItems}
        isSearching={isSearching}
        currentPage={currentPage}
        totalPages={totalPages}
        total={total}
        hasMore={hasMore}
        onPageChange={handlePageChange}
        onSelect={onSelect}
      />
    </div>
  );
}

// Debounce function
function debounce<F extends (...args: any[]) => any>(func: F, wait: number): F {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  return function(this: any, ...args: Parameters<F>) {
    if (timeout !== null) {
      clearTimeout(timeout);
    }
    timeout = setTimeout(() => func.apply(this, args), wait);
  } as F;
}
