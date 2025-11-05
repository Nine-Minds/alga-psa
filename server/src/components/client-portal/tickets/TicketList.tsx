'use client';

import { useEffect, useState, useCallback } from 'react';
import toast from 'react-hot-toast';
import { useSearchParams, useRouter } from 'next/navigation';
import { DataTable } from 'server/src/components/ui/DataTable';
import Spinner from 'server/src/components/ui/Spinner';
import { format } from 'date-fns';
import { getClientTickets, updateTicketStatus } from 'server/src/lib/actions/client-portal-actions/client-tickets';
import { getTicketStatuses } from 'server/src/lib/actions/status-actions/statusActions';
import { getAllPriorities } from 'server/src/lib/actions/priorityActions';
import { getTicketCategories } from 'server/src/lib/actions/ticketCategoryActions';
import { ColumnDefinition } from 'server/src/interfaces/dataTable.interfaces';
import { ITicketListItem, ITicketCategory } from 'server/src/interfaces/ticket.interfaces';
import { Button } from 'server/src/components/ui/Button';
import { Input } from 'server/src/components/ui/Input';
import CustomSelect, { SelectOption } from 'server/src/components/ui/CustomSelect';
import { CategoryPicker } from 'server/src/components/tickets/CategoryPicker';
import { ChevronDown, XCircle } from 'lucide-react';
import { ConfirmationDialog } from 'server/src/components/ui/ConfirmationDialog';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { ClientAddTicket } from 'server/src/components/client-portal/tickets/ClientAddTicket';
import { useTranslation } from 'server/src/lib/i18n/client';

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

  // Debounce search query to avoid triggering loadTickets on every keystroke
  const debouncedSearchQuery = useDebounce(searchQuery, 500);

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

        if (sortField === 'entered_at' || sortField === 'updated_at') {
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
  }, [selectedStatus, selectedPriority, selectedCategories, excludedCategories, debouncedSearchQuery, sortField, sortDirection]);

  // Load tickets on initial mount and when filters/sorting change
  useEffect(() => {
    loadTickets();
  }, [loadTickets]);

  // Handle deep link - navigate to ticket page from URL parameter
  useEffect(() => {
    const ticketParam = searchParams.get('ticket');
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
  }, []);

  // Handle page size change - reset to page 1
  const handlePageSizeChange = (newPageSize: number) => {
    setPageSize(newPageSize);
    setCurrentPage(1);
  };

  const handleResetFilters = useCallback(() => {
    setSelectedStatus('all');
    setSelectedPriority('all');
    setSelectedCategories([]);
    setExcludedCategories([]);
    setSearchQuery('');
  }, []);

  const columns: ColumnDefinition<ITicketListItem>[] = [
    {
      title: t('tickets.fields.ticketNumber'),
      dataIndex: 'ticket_number',
      width: '75px',
      render: (value: string, record: ITicketListItem) => (
        <div
          className="font-medium cursor-pointer hover:text-[rgb(var(--color-secondary-600))]"
          onClick={(e) => {
            e.stopPropagation();
            if (record.ticket_id) {
              router.push(`/client-portal/tickets/${record.ticket_id}`);
            }
          }}
        >
          {value}
        </div>
      ),
    },
    {
      title: t('tickets.fields.title'),
      dataIndex: 'title',
      width: '25%',
      render: (value: string, record: ITicketListItem) => (
        <div
          className="font-medium cursor-pointer hover:text-[rgb(var(--color-secondary-600))]"
          onClick={(e) => {
            e.stopPropagation();
            if (record.ticket_id) {
              router.push(`/client-portal/tickets/${record.ticket_id}`);
            }
          }}
        >
          {value}
        </div>
      ),
    },
    {
      title: t('tickets.fields.status'),
      dataIndex: 'status_name',
      width: '20%',
      render: (value: string, record: ITicketListItem) => (
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
      ),
    },
    {
      title: t('tickets.fields.priority'),
      dataIndex: 'priority_name',
      width: '15%',
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
      title: t('tickets.fields.assignedTo'),
      dataIndex: 'assigned_to_name',
      width: '15%',
      render: (value: string) => (
        <div className="text-sm">{value || '-'}</div>
      ),
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
    <div className="bg-white shadow rounded-lg p-4 w-full">
      <div className="flex justify-between items-center mb-4">
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
      <div className="flex items-center gap-3 flex-nowrap mb-4">
          <CustomSelect
            options={statusOptions}
            value={selectedStatus}
            onValueChange={setSelectedStatus}
            placeholder="Select Status"
          />

          <CustomSelect
            options={priorityOptions}
            value={selectedPriority}
            onValueChange={setSelectedPriority}
            placeholder="All Priorities"
          />

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

          <Input
            id="client-portal-search-tickets-input"
            placeholder={t('tickets.filters.search')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-[38px] min-w-[200px] text-sm"
            containerClassName=""
          />

          <Button
            id="reset-filters-button"
            variant="outline"
            onClick={handleResetFilters}
            className="whitespace-nowrap flex items-center gap-2 ml-auto"
          >
            <XCircle className="h-4 w-4" />
            {t('tickets.resetFilters')}
          </Button>
        </div>

      <h2 className="text-xl font-semibold mt-6 mb-2">
        {t('tickets.title')}
      </h2>

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
