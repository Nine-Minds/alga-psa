'use client';

import { useEffect, useState, useCallback } from 'react';
import { DataTable } from 'server/src/components/ui/DataTable';
import { format } from 'date-fns';
import { getClientTickets, updateTicketStatus } from 'server/src/lib/actions/client-portal-actions/client-tickets';
import { getTicketStatuses } from 'server/src/lib/actions/status-actions/statusActions';
import { getAllPriorities } from 'server/src/lib/actions/priorityActions';
import { getTicketCategories } from 'server/src/lib/actions/ticketCategoryActions';
import { ColumnDefinition } from 'server/src/interfaces/dataTable.interfaces';
import { ITicketListItem, ITicketCategory } from 'server/src/interfaces/ticket.interfaces';
import { IStatus } from 'server/src/interfaces/status.interface';
import { TicketDetails } from './TicketDetails';
import { Button } from 'server/src/components/ui/Button';
import { SearchInput } from 'server/src/components/ui/SearchInput';
import CustomSelect, { SelectOption } from 'server/src/components/ui/CustomSelect';
import { CategoryPicker } from 'server/src/components/tickets/CategoryPicker';
import { ChevronDown, XCircle } from 'lucide-react';
import { ConfirmationDialog } from 'server/src/components/ui/ConfirmationDialog';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { ClientAddTicket } from 'server/src/components/client-portal/tickets/ClientAddTicket';

export function TicketList() {
  const [tickets, setTickets] = useState<ITicketListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
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

  // Load statuses, priorities, and categories
  useEffect(() => {
    const loadOptions = async () => {
      try {
        const [statuses, priorities, categories] = await Promise.all([
          getTicketStatuses(),
          getAllPriorities(),
          getTicketCategories()
        ]);

        setStatusOptions([
          { value: 'all', label: 'All Statuses' },
          { value: 'open', label: 'All Open Tickets' },
          { value: 'closed', label: 'All Closed Tickets' },
          ...statuses.map((status: { status_id: string; name: string | null; is_closed: boolean }): SelectOption => ({
            value: status.status_id!,
            label: status.name ?? "",
            className: status.is_closed ? 'bg-gray-200 text-gray-600' : undefined
          }))
        ]);

        setPriorityOptions([
          { value: 'all', label: 'All Priorities' },
          ...priorities.map((priority: { priority_id: string; priority_name: string }) => ({
            value: priority.priority_id,
            label: priority.priority_name
          }))
        ]);

        setCategories(categories);
      } catch (error) {
        console.error('Failed to load options:', error);
      }
    };

    loadOptions();
  }, []);

  // Load and filter tickets
  useEffect(() => {
    const loadTickets = async () => {
      setLoading(true);
      try {
        const result = await getClientTickets(selectedStatus);
        
        // Apply client-side filtering
        let filteredTickets = [...result];

        // Filter by categories
        if (selectedCategories.length > 0) {
          filteredTickets = filteredTickets.filter(ticket => {
            if (selectedCategories.includes('no-category')) {
              return !ticket.category_id && !ticket.subcategory_id;
            }
            return selectedCategories.includes(ticket.category_id || '') || 
                   selectedCategories.includes(ticket.subcategory_id || '');
          });
        }

        // Filter by excluded categories
        if (excludedCategories.length > 0) {
          filteredTickets = filteredTickets.filter(ticket => {
            if (excludedCategories.includes('no-category')) {
              return ticket.category_id || ticket.subcategory_id;
            }
            return !excludedCategories.includes(ticket.category_id || '') && 
                   !excludedCategories.includes(ticket.subcategory_id || '');
          });
        }

        // Filter by priority
        if (selectedPriority !== 'all') {
          filteredTickets = filteredTickets.filter(ticket => 
            ticket.priority_id === selectedPriority
          );
        }

        // Filter by search query
        if (searchQuery) {
          const query = searchQuery.toLowerCase();
          filteredTickets = filteredTickets.filter(ticket => 
            ticket.title?.toLowerCase().includes(query) ||
            ticket.ticket_number?.toLowerCase().includes(query) ||
            ticket.status_name?.toLowerCase().includes(query) ||
            ticket.priority_name?.toLowerCase().includes(query)
          );
        }

        // Apply sorting
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

          // Handle date fields
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
      }
      setLoading(false);
    };

    loadTickets();
  }, [selectedStatus, selectedPriority, selectedCategories, excludedCategories, searchQuery, sortField, sortDirection]);

  const handleSort = useCallback((field: string) => {
    setSortDirection(current => 
      sortField === field 
        ? current === 'asc' ? 'desc' : 'asc'
        : 'asc'
    );
    setSortField(field);
  }, [sortField]);

  const handleStatusChange = useCallback(async () => {
    if (!ticketToUpdateStatus) return;

    try {
      await updateTicketStatus(
        ticketToUpdateStatus.ticketId,
        ticketToUpdateStatus.newStatus
      );

      // Refresh tickets
      const result = await getClientTickets(selectedStatus);
      setTickets(result);
    } catch (error) {
      console.error('Failed to update ticket status:', error);
    } finally {
      setTicketToUpdateStatus(null);
    }
  }, [ticketToUpdateStatus, selectedStatus]);

  const handleCategorySelect = useCallback((categoryIds: string[], excludedIds: string[]) => {
    setSelectedCategories(categoryIds);
    setExcludedCategories(excludedIds);
  }, []);

  const handleResetFilters = useCallback(() => {
    setSelectedStatus('all');
    setSelectedPriority('all');
    setSelectedCategories([]);
    setExcludedCategories([]);
    setSearchQuery('');
  }, []);

  const columns: ColumnDefinition<ITicketListItem>[] = [
    {
      title: 'Title',
      dataIndex: 'title',
      width: '25%',
      render: (value: string, record: ITicketListItem) => (
        <div 
          className="font-medium cursor-pointer hover:text-blue-600"
          onClick={(e) => {
            e.stopPropagation();
            if (record.ticket_id) {
              setSelectedTicketId(record.ticket_id);
            }
          }}
        >
          {value}
        </div>
      ),
    },
    {
      title: 'Status',
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
      title: 'Priority',
      dataIndex: 'priority_name',
      width: '15%',
      render: (value: string) => (
        <div className="capitalize">{value}</div>
      ),
    },
    {
      title: 'Assigned To',
      dataIndex: 'assigned_to_name',
      width: '15%',
      render: (value: string) => (
        <div className="text-sm">{value || '-'}</div>
      ),
    },
    {
      title: 'Created',
      dataIndex: 'entered_at',
      width: '15%',
      render: (value: string | null) => (
        <div className="text-sm text-gray-500">
          {value ? format(new Date(value), 'MMM d, yyyy h:mm a') : '-'}
        </div>
      ),
    },
    {
      title: 'Updated',
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
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
      </div>
    );
  }

  return (
    <div className="bg-white shadow rounded-lg p-4 w-full">
      <div className="flex justify-between items-center mb-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Support Tickets</h1>
          <p className="text-gray-600">View and manage your support tickets</p>
        </div>
        <Button
          id="create-ticket-button"
          className="bg-[rgb(var(--color-primary-500))] text-white hover:bg-[rgb(var(--color-primary-600))] px-4 py-2"
          onClick={() => setIsAddTicketOpen(true)}
        >
          Create Support Ticket
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
            placeholder="Filter by category"
            multiSelect={true}
            showExclude={true}
            showReset={true}
            allowEmpty={true}
            className="text-sm min-w-[200px]"
          />

          <SearchInput
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search tickets..."
            className="min-w-[200px]"
          />

          <Button
            id="reset-filters-button"
            variant="outline"
            onClick={handleResetFilters}
            className="whitespace-nowrap flex items-center gap-2 ml-auto"
          >
            <XCircle className="h-4 w-4" />
            Reset Filters
          </Button>
        </div>

      <h2 className="text-xl font-semibold mt-6 mb-2">
        Tickets
      </h2>

      <div className="w-full overflow-x-auto">
        <div className="min-w-full">
          <DataTable
            data={tickets}
            columns={columns}
            pagination={true}
            currentPage={currentPage}
            onPageChange={setCurrentPage}
            pageSize={10}
            rowClassName={() => "hover:bg-gray-50"}
          />
        </div>
      </div>

      {selectedTicketId && (
        <TicketDetails
          ticketId={selectedTicketId}
          open={!!selectedTicketId}
          onClose={() => setSelectedTicketId(null)}
        />
      )}

      <ClientAddTicket 
        open={isAddTicketOpen} 
        onOpenChange={setIsAddTicketOpen} 
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
