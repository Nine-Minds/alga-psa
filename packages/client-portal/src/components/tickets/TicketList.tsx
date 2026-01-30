'use client';

import { useEffect, useState, useCallback } from 'react';
import toast from 'react-hot-toast';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import Spinner from '@alga-psa/ui/components/Spinner';
import { format } from 'date-fns';
import { getClientTickets, updateTicketStatus } from '@alga-psa/client-portal/actions';
import { getTicketStatuses } from '@alga-psa/reference-data/actions';
import { getAllPriorities } from '@alga-psa/reference-data/actions';
import { getTicketCategories } from '@alga-psa/tickets/actions';
import { ColumnDefinition } from '@alga-psa/types';
import { ITicketListItem, ITicketCategory, TicketResponseState } from '@alga-psa/types';
import { ResponseStateBadge, CategoryPicker } from '@alga-psa/tickets/components';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Tooltip } from '@alga-psa/ui/components/Tooltip';
import UserAvatar from '@alga-psa/ui/components/UserAvatar';
import CustomSelect, { SelectOption } from '@alga-psa/ui/components/CustomSelect';
import { ChevronDown, XCircle } from 'lucide-react';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { ClientAddTicket } from './ClientAddTicket';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { getUserAvatarUrlsBatchAction } from '@alga-psa/users/actions';

const useDebounce = <T,>(value: T, delay: number): T => {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);
    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);
  return debouncedValue;
};

export function TicketList() {
  const { t } = useTranslation('clientPortal');
  const searchParams = useSearchParams();
  const router = useRouter();
  const [tickets, setTickets] = useState<ITicketListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [sortField, setSortField] = useState<string>('entered_at');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [statusOptions, setStatusOptions] = useState<SelectOption[]>([]);
  const [priorityOptions, setPriorityOptions] = useState<{ value: string; label: string }[]>([]);
  const [categories, setCategories] = useState<ITicketCategory[]>([]);
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [selectedResponseStatus, setSelectedResponseStatus] = useState<'all' | 'awaiting_client' | 'awaiting_internal' | 'none'>('all');
  const [selectedPriority, setSelectedPriority] = useState('all');
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [excludedCategories, setExcludedCategories] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isAddTicketOpen, setIsAddTicketOpen] = useState(false);
  const [ticketToUpdateStatus, setTicketToUpdateStatus] = useState<{
    ticketId: string;
    newStatus: string;
    currentStatus: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [additionalAgentAvatarUrls, setAdditionalAgentAvatarUrls] = useState<Record<string, string | null>>({});

  // Debounce search query to avoid triggering loadTickets on every keystroke
  const debouncedSearchQuery = useDebounce(searchQuery, 500);

  // Fetch avatar URLs for additional agents when tickets change
  useEffect(() => {
    const fetchAvatarUrls = async () => {
      // Collect all unique user IDs from additional agents
      const userIds = new Set<string>();
      tickets.forEach(ticket => {
        ticket.additional_agents?.forEach(agent => {
          userIds.add(agent.user_id);
        });
      });

      if (userIds.size === 0) return;

      // Get tenant from first ticket
      const tenant = tickets[0]?.tenant;
      if (!tenant) return;

      try {
        const avatarUrlsMap = await getUserAvatarUrlsBatchAction(Array.from(userIds), tenant);
        // Convert Map to Record
        const urlsRecord: Record<string, string | null> = {};
        avatarUrlsMap.forEach((url, id) => {
          urlsRecord[id] = url;
        });
        setAdditionalAgentAvatarUrls(urlsRecord);
      } catch (error) {
        console.error('Failed to fetch avatar URLs:', error);
      }
    };

    fetchAvatarUrls();
  }, [tickets]);

  // Load statuses, priorities, and categories
  useEffect(() => {
    const loadOptions = async () => {
      try {
        const [statuses, priorities, categories] = await Promise.all([
          getTicketStatuses(),
          getAllPriorities('ticket'),
          getTicketCategories()
        ]);

        setStatusOptions([
          { value: 'all', label: t('tickets.filters.allStatuses') },
          { value: 'open', label: t('tickets.filters.allOpen') },
          { value: 'closed', label: t('tickets.filters.allClosed') },
          ...statuses.map((status: { status_id: string; name: string | null; is_closed: boolean }): SelectOption => ({
            value: status.status_id!,
            label: status.name ?? "",
            className: status.is_closed ? 'bg-gray-200 text-gray-600' : undefined
          }))
        ]);

        setPriorityOptions([
          { value: 'all', label: t('tickets.filters.allPriorities') },
          ...priorities.map((priority: { priority_id: string; priority_name: string }) => ({
            value: priority.priority_id,
            label: priority.priority_name
          }))
        ]);

        setCategories(categories);
      } catch (error) {
        console.error('Failed to load options:', error);
        setError(t('tickets.messages.filtersError', 'Failed to load filter options.'));
      }
    };

    loadOptions();
  }, []);

  const loadTickets = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getClientTickets(selectedStatus);

      let filteredTickets = [...result];

      const shouldFilterByResponseStatus =
        selectedResponseStatus === 'awaiting_client' ||
        selectedResponseStatus === 'awaiting_internal' ||
        selectedResponseStatus === 'none';

      if (shouldFilterByResponseStatus) {
        filteredTickets = filteredTickets.filter((ticket) => {
          if (selectedResponseStatus === 'none') return ticket.response_state == null;
          return ticket.response_state === selectedResponseStatus;
        });
      }

      if (selectedCategories.length > 0) {
        filteredTickets = filteredTickets.filter(ticket => {
          if (selectedCategories.includes('no-category')) {
            return !ticket.category_id && !ticket.subcategory_id;
          }
          return selectedCategories.includes(ticket.category_id || '') ||
                 selectedCategories.includes(ticket.subcategory_id || '');
        });
      }

      if (excludedCategories.length > 0) {
        filteredTickets = filteredTickets.filter(ticket => {
          if (excludedCategories.includes('no-category')) {
            return ticket.category_id || ticket.subcategory_id;
          }
          return !excludedCategories.includes(ticket.category_id || '') &&
                 !excludedCategories.includes(ticket.subcategory_id || '');
        });
      }

      if (selectedPriority !== 'all') {
        filteredTickets = filteredTickets.filter(ticket =>
          ticket.priority_id === selectedPriority
        );
      }

      if (debouncedSearchQuery) {
        const query = debouncedSearchQuery.toLowerCase();
        filteredTickets = filteredTickets.filter(ticket =>
          ticket.title?.toLowerCase().includes(query) ||
          ticket.ticket_number?.toLowerCase().includes(query) ||
          ticket.status_name?.toLowerCase().includes(query) ||
          ticket.priority_name?.toLowerCase().includes(query)
        );
      }

      const sortedTickets = [...filteredTickets].sort((a, b) => {
        const aValue = a[sortField as keyof ITicketListItem];
        const bValue = b[sortField as keyof ITicketListItem];

        if (!aValue && !bValue) return 0;
        if (!aValue) return 1;
        if (!bValue) return -1;

        if (typeof aValue === 'string' && typeof bValue === 'string') {
          return sortDirection === 'asc'
            ? aValue.localeCompare(bValue)
            : bValue.localeCompare(aValue);
        }

        if (sortField === 'entered_at' || sortField === 'updated_at' || sortField === 'due_date') {
          const aDate = new Date(aValue as string);
          const bDate = new Date(bValue as string);
          return sortDirection === 'asc'
            ? aDate.getTime() - bDate.getTime()
            : bDate.getTime() - aDate.getTime();
        }

        return 0;
      });

      setTickets(sortedTickets);
    } catch (error) {
      console.error('Failed to load tickets:', error);
      setError(t('tickets.messages.loadingError', 'Failed to load tickets. Please try again.'));
    }
    setLoading(false);
  }, [selectedStatus, selectedResponseStatus, selectedPriority, selectedCategories, excludedCategories, debouncedSearchQuery, sortField, sortDirection, t]);

  // Load tickets on initial mount and when filters/sorting change
  useEffect(() => {
    loadTickets();
  }, [loadTickets]);

  // Handle deep link - navigate to ticket page from URL parameter
  useEffect(() => {
    const ticketParam = searchParams?.get('ticket') ?? null;
    if (ticketParam && tickets.length > 0) {
      // Find ticket by ticket_id (UUID)
      const ticket = tickets.find(t => t.ticket_id === ticketParam);
      if (ticket && ticket.ticket_id) {
        // Navigate to the dedicated ticket page
        router.push(`/client-portal/tickets/${ticket.ticket_id}`);
      }
    }
  }, [searchParams, tickets, router]);

  const handleStatusChange = useCallback(async () => {
    if (!ticketToUpdateStatus) return;

    const { ticketId, newStatus } = ticketToUpdateStatus;
    const newStatusLabel = statusOptions.find(s => s.value === newStatus)?.label || 'Unknown Status';

    try {
      await updateTicketStatus(ticketId, newStatus);

      toast.success(t('tickets.messages.statusUpdateSuccess', 'Ticket status successfully updated to "{{status}}".', { status: newStatusLabel }));

      // Refresh tickets by calling loadTickets
      loadTickets(); 
    } catch (error) {
      console.error('Failed to update ticket status:', error);
      toast.error(t('tickets.messages.statusUpdateError', 'Failed to update ticket status.'));
    } finally {
      setTicketToUpdateStatus(null);
    }
  }, [ticketToUpdateStatus, selectedStatus, loadTickets, statusOptions]); 

  const handleCategorySelect = useCallback((categoryIds: string[], excludedIds: string[]) => {
    setSelectedCategories(categoryIds);
    setExcludedCategories(excludedIds);
    setCurrentPage(1);
  }, []);

  // Handle page size change - reset to page 1
  const handlePageSizeChange = (newPageSize: number) => {
    setPageSize(newPageSize);
    setCurrentPage(1);
  };

  const handleResetFilters = useCallback(() => {
    setSelectedStatus('all');
    setSelectedResponseStatus('all');
    setSelectedPriority('all');
    setSelectedCategories([]);
    setExcludedCategories([]);
    setSearchQuery('');
    setCurrentPage(1);
  }, []);

  const columns: ColumnDefinition<ITicketListItem>[] = [
    {
      title: t('tickets.fields.ticketNumber'),
      dataIndex: 'ticket_number',
      width: '75px',
      render: (value: string, record: ITicketListItem) => (
        <Link
          href={`/client-portal/tickets/${record.ticket_id}`}
          className="font-medium hover:text-[rgb(var(--color-secondary-600))]"
          onClick={(e) => e.stopPropagation()}
        >
          {value}
        </Link>
      ),
    },
    {
      title: t('tickets.fields.title'),
      dataIndex: 'title',
      width: '25%',
      render: (value: string, record: ITicketListItem) => (
        <div className="overflow-hidden">
          <Link
            href={`/client-portal/tickets/${record.ticket_id}`}
            className="font-medium hover:text-[rgb(var(--color-secondary-600))] block whitespace-normal break-words"
            onClick={(e) => e.stopPropagation()}
          >
            {value}
          </Link>
        </div>
      ),
    },
    {
      title: t('tickets.fields.status'),
      dataIndex: 'status_name',
      width: '20%',
      render: (value: string, record: ITicketListItem) => {
        // Get response_state from the record (F026-F030)
        const responseState = record.response_state as TicketResponseState | undefined;
        return (
          <div className="flex items-center gap-2 flex-wrap">
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <div
                  id="change-ticket-category-button"
                  className="text-sm cursor-pointer flex items-center gap-2"
                >
                  {value}
                  <ChevronDown className="h-3 w-3 text-gray-400" />
                </div>
              </DropdownMenu.Trigger>

              <DropdownMenu.Content
                className="w-48 rounded-md bg-white shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none z-50"
              >
                {statusOptions
                  .filter(option => !['all', 'open', 'closed'].includes(option.value))
                  .map((status) => (
                    <DropdownMenu.Item
                      key={status.value}
                      className="px-4 py-2 text-sm hover:bg-gray-100 cursor-pointer outline-none"
                      onSelect={() => {
                        if (record.status_id !== status.value) {
                          setTicketToUpdateStatus({
                            ticketId: record.ticket_id!,
                            newStatus: status.value,
                            currentStatus: record.status_name || ''
                          });
                        }
                      }}
                    >
                      {status.label}
                    </DropdownMenu.Item>
                  ))}
              </DropdownMenu.Content>
            </DropdownMenu.Root>
            {responseState && (
              <ResponseStateBadge
                responseState={responseState}
                isClientPortal={true}
                size="sm"
                labels={{
                  awaitingClient: t('tickets.responseState.awaitingYourResponse', 'Awaiting Your Response'),
                  awaitingInternal: t('tickets.responseState.awaitingSupportResponse', 'Awaiting Support Response'),
                  awaitingClientTooltip: t('tickets.responseState.awaitingYourResponseTooltip', 'Support is waiting for your response'),
                  awaitingInternalTooltip: t('tickets.responseState.awaitingSupportResponseTooltip', 'Your response has been received. Support will respond soon.'),
                }}
              />
            )}
          </div>
        );
      },
    },
    {
      title: t('tickets.fields.priority'),
      dataIndex: 'priority_name',
      width: '12%',
      render: (value: string, record: ITicketListItem) => (
        <div className="flex items-center gap-2">
          <div
            className={`w-3 h-3 rounded-full border border-gray-300 ${!record.priority_color ? 'bg-gray-500' : ''}`}
            style={record.priority_color ? { backgroundColor: record.priority_color } : undefined}
          />
          <span className="capitalize">{value}</span>
        </div>
      ),
    },
    {
      title: t('tickets.fields.dueDate', 'Due Date'),
      dataIndex: 'due_date',
      width: '12%',
      render: (value: string | null) => {
        if (!value) {
          return <span className="text-sm text-gray-500">-</span>;
        }

        const dueDate = new Date(value);
        const now = new Date();
        const hoursUntilDue = (dueDate.getTime() - now.getTime()) / (1000 * 60 * 60);

        // Check if time is midnight (00:00) - show date only
        const isMidnight = dueDate.getHours() === 0 && dueDate.getMinutes() === 0;
        const displayFormat = isMidnight ? 'MMM d, yyyy' : 'MMM d, yyyy h:mm a';

        // Determine styling based on due date status
        let textColorClass = 'text-gray-500';
        let bgColorClass = '';

        if (hoursUntilDue < 0) {
          // Overdue - red/warning style
          textColorClass = 'text-red-700';
          bgColorClass = 'bg-red-50';
        } else if (hoursUntilDue <= 24) {
          // Approaching due date (within 24 hours) - orange/caution style
          textColorClass = 'text-orange-700';
          bgColorClass = 'bg-orange-50';
        }

        return (
          <span className={`text-sm inline-block ${textColorClass} ${bgColorClass ? `${bgColorClass} px-2 py-0.5 rounded-full` : ''}`}>
            {format(dueDate, displayFormat)}
          </span>
        );
      },
    },
    {
      title: t('tickets.fields.assignedTo'),
      dataIndex: 'assigned_to_name',
      width: '15%',
      render: (value: string | null, record: ITicketListItem) => {
        const additionalCount = record.additional_agent_count || 0;
        const additionalAgents = record.additional_agents || [];
        return (
          <div className="text-sm flex items-center gap-1.5">
            {value || '-'}
            {additionalCount > 0 && (
              <Tooltip
                content={
                  <div className="text-xs space-y-1.5">
                    <div className="font-medium text-gray-300 mb-1">Additional Agents:</div>
                    {additionalAgents.map((agent, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <UserAvatar
                          userId={agent.user_id}
                          userName={agent.name}
                          avatarUrl={additionalAgentAvatarUrls[agent.user_id] ?? null}
                          size="xs"
                        />
                        <span>{agent.name}</span>
                      </div>
                    ))}
                  </div>
                }
              >
                <span
                  className="px-1.5 py-0.5 text-xs font-medium rounded-full cursor-help"
                  style={{
                    color: 'rgb(var(--color-primary-500))',
                    backgroundColor: 'rgb(var(--color-primary-50))'
                  }}
                >
                  +{additionalCount}
                </span>
              </Tooltip>
            )}
          </div>
        );
      },
    },
    {
      title: t('tickets.fields.createdAt'),
      dataIndex: 'entered_at',
      width: '15%',
      render: (value: string | null) => (
        <div className="text-sm text-gray-500">
          {value ? format(new Date(value), 'MMM d, yyyy h:mm a') : '-'}
        </div>
      ),
    },
    {
      title: t('tickets.fields.updatedAt'),
      dataIndex: 'updated_at',
      width: '15%',
      render: (value: string | null) => (
        <div className="text-sm text-gray-500">
          {value ? format(new Date(value), 'MMM d, yyyy h:mm a') : '-'}
        </div>
      ),
    },
  ];

  if (loading) {
    return (
      <div className="flex justify-center items-center h-32">
        <Spinner size="sm" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4">
        <p className="text-red-700">{error}</p>
      </div>
    );
  }

  return (
    <div className="bg-white shadow rounded-lg w-full">
      <div className="sticky top-0 z-40 bg-white rounded-t-lg p-6 border-b border-gray-100">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{t('tickets.title')}</h1>
            <p className="text-gray-600">{t('tickets.subtitle')}</p>
          </div>
          <Button
            id="create-ticket-button"
            className="bg-[rgb(var(--color-primary-500))] text-white hover:bg-[rgb(var(--color-primary-600))] px-4 py-2"
            onClick={() => setIsAddTicketOpen(true)}
          >
            {t('tickets.createButton')}
          </Button>
        </div>
        <div className="flex items-center gap-4 flex-wrap">
          <CustomSelect
            options={statusOptions}
            value={selectedStatus}
            onValueChange={(value) => {
              setSelectedStatus(value);
              setCurrentPage(1);
            }}
            placeholder="Select Status"
          />

          <CustomSelect
            options={[
              { value: 'all', label: t('tickets.filters.allResponseStatuses', 'All Response Statuses') },
              { value: 'awaiting_client', label: t('tickets.responseState.awaitingYourResponse', 'Awaiting Your Response') },
              { value: 'awaiting_internal', label: t('tickets.responseState.awaitingSupportResponse', 'Awaiting Support Response') },
              { value: 'none', label: t('tickets.responseState.none', 'No Response Pending') },
            ]}
            value={selectedResponseStatus}
            onValueChange={(value) => {
              const nextValue =
                value === 'awaiting_client' || value === 'awaiting_internal' || value === 'none'
                  ? value
                  : 'all';
              setSelectedResponseStatus(nextValue);
              setCurrentPage(1);
            }}
            placeholder={t('tickets.filters.responseStatus', 'Response Status')}
          />

          <CustomSelect
            options={priorityOptions}
            value={selectedPriority}
            onValueChange={(value) => {
              setSelectedPriority(value);
              setCurrentPage(1);
            }}
            placeholder="All Priorities"
          />

          <div className="h-6 w-px bg-gray-200 mx-1 shrink-0" />

          <CategoryPicker
            categories={categories}
            selectedCategories={selectedCategories}
            excludedCategories={excludedCategories}
            onSelect={handleCategorySelect}
            placeholder={t('tickets.filters.category')}
            multiSelect={true}
            showExclude={true}
            showReset={true}
            allowEmpty={true}
            className="text-sm min-w-[200px]"
          />

          <div className="h-6 w-px bg-gray-200 mx-1 shrink-0" />

          <Input
            id="client-portal-search-tickets-input"
            placeholder={t('tickets.filters.search')}
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setCurrentPage(1);
            }}
            className="h-[38px] min-w-[350px] text-sm"
            containerClassName=""
          />

          <Button
            variant="ghost"
            size="sm"
            onClick={handleResetFilters}
            className="text-gray-500 hover:text-gray-700 shrink-0"
            id="reset-filters-button"
          >
            <XCircle className="h-4 w-4 mr-1" />
            Reset
          </Button>
        </div>
      </div>

      <div className="p-6">
        <div className="w-full overflow-x-auto">
        <div className="min-w-full">
          <DataTable
            id="client-portal-tickets-table"
            data={tickets}
            columns={columns}
            pagination={true}
            currentPage={currentPage}
            onPageChange={setCurrentPage}
            pageSize={pageSize}
            onItemsPerPageChange={handlePageSizeChange}
            rowClassName={() => "hover:bg-gray-50"}
          />
        </div>
        </div>
      </div>

      <ClientAddTicket 
        open={isAddTicketOpen} 
        onOpenChange={setIsAddTicketOpen}
        onTicketAdded={loadTickets}
      />

      <ConfirmationDialog
        isOpen={!!ticketToUpdateStatus}
        onClose={() => setTicketToUpdateStatus(null)}
        onConfirm={handleStatusChange}
        title="Update Ticket Status"
        message={`Are you sure you want to change the status from "${ticketToUpdateStatus?.currentStatus}" to "${statusOptions.find(s => s.value === ticketToUpdateStatus?.newStatus)?.label}"?`}
        confirmLabel="Update"
        cancelLabel="Cancel"
      />
    </div>
  );
}
