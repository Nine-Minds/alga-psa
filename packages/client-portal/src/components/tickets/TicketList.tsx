'use client';

/* eslint-disable custom-rules/no-feature-to-feature-imports -- Client portal ticket lists intentionally compose ticket feature components/actions for customer support navigation. */

import { useEffect, useState, useCallback, useMemo } from 'react';
import toast from 'react-hot-toast';
import { handleError } from '@alga-psa/ui/lib/errorHandling';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import Spinner from '@alga-psa/ui/components/Spinner';
import { format } from 'date-fns';
import { getClientTickets, updateTicketStatus } from '@alga-psa/client-portal/actions';
import { getTicketStatuses } from '@alga-psa/reference-data/actions';
import { getAllPriorities } from '@alga-psa/reference-data/actions';
import { getTicketCategories } from '@alga-psa/tickets/actions/ticketCategoryActions';
import { ColumnDefinition } from '@alga-psa/types';
import { ITicketListItem, ITicketCategory, TicketResponseState } from '@alga-psa/types';
import type { IStatus } from '@alga-psa/types';
import { ResponseStateBadge } from '@alga-psa/ui/components';
import { CategoryPicker } from '@alga-psa/tickets/components';
import { getTicketingDisplaySettings } from '@alga-psa/tickets/actions/ticketDisplaySettings';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Tooltip } from '@alga-psa/ui/components/Tooltip';
import UserAvatar from '@alga-psa/ui/components/UserAvatar';
import TeamAvatar from '@alga-psa/ui/components/TeamAvatar';
import CustomSelect, { SelectOption } from '@alga-psa/ui/components/CustomSelect';
import { ChevronDown, XCircle } from 'lucide-react';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { ClientAddTicket } from './ClientAddTicket';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { getUserAvatarUrlsBatchAction } from '@alga-psa/user-composition/actions';
import { getTeamAvatarUrlsBatchAction } from '@alga-psa/teams/actions';
import {
  buildTicketStatusFilterOptions,
  TICKET_STATUS_FILTER_ALL,
  TICKET_STATUS_FILTER_CLOSED,
  TICKET_STATUS_FILTER_OPEN,
  type TicketStatusFilterOption,
  statusPillHue,
  formatDuePrimary,
  daysUntil,
  formatCategoryLabel,
} from '@alga-psa/tickets/lib';

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
  const { t } = useTranslation('features/tickets');
  const searchParams = useSearchParams();
  const router = useRouter();
  const [tickets, setTickets] = useState<ITicketListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [sortField, setSortField] = useState<string>('entered_at');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [rawStatusOptions, setRawStatusOptions] = useState<TicketStatusFilterOption[]>([]);
  const [boardStatusOptions, setBoardStatusOptions] = useState<Record<string, SelectOption[]>>({});
  const [priorityOptions, setPriorityOptions] = useState<{ value: string; label: string }[]>([]);
  const [categories, setCategories] = useState<ITicketCategory[]>([]);
  const [selectedStatus, setSelectedStatus] = useState<string>(TICKET_STATUS_FILTER_ALL);
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
  const [teamAvatarUrls, setTeamAvatarUrls] = useState<Record<string, string | null>>({});
  const [responseStateTrackingEnabled, setResponseStateTrackingEnabled] = useState<boolean>(true);

  // Load response state tracking setting
  useEffect(() => {
    getTicketingDisplaySettings()
      .then((s) => setResponseStateTrackingEnabled(s?.responseStateTrackingEnabled ?? true))
      .catch(() => {});
  }, []);

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

  // Fetch team avatar URLs when tickets change
  useEffect(() => {
    const fetchTeamAvatars = async () => {
      const teamIds = new Set<string>();
      tickets.forEach(ticket => {
        if (ticket.assigned_team_id) {
          teamIds.add(ticket.assigned_team_id);
        }
      });
      if (teamIds.size === 0) return;
      const tenant = tickets[0]?.tenant;
      if (!tenant) return;
      try {
        const result = await getTeamAvatarUrlsBatchAction(Array.from(teamIds), tenant);
        const urls: Record<string, string | null> = {};
        if (result instanceof Map) {
          result.forEach((url, id) => { urls[id] = url; });
        } else {
          Object.entries(result).forEach(([id, url]) => { urls[id] = url as string | null; });
        }
        setTeamAvatarUrls(urls);
      } catch (error) {
        console.error('Failed to fetch team avatar URLs:', error);
      }
    };
    fetchTeamAvatars();
  }, [tickets]);

  // Load statuses, priorities, and categories
  useEffect(() => {
    const loadOptions = async () => {
      try {
        const [statuses, priorities, categories] = await Promise.all([
          getTicketStatuses() as Promise<IStatus[]>,
          getAllPriorities('ticket'),
          getTicketCategories()
        ]);

        setRawStatusOptions(
          statuses.map((status: IStatus): TicketStatusFilterOption => ({
            value: status.status_id!,
            label: status.name ?? "",
            className: status.is_closed ? 'bg-gray-200 text-gray-600' : undefined,
            statusName: status.name ?? '',
            boardId: status.board_id ?? null,
            isClosed: Boolean(status.is_closed),
          }))
        );

        setPriorityOptions([
          { value: 'all', label: t('filters.allPriorities') },
          ...priorities.map((priority: { priority_id: string; priority_name: string }) => ({
            value: priority.priority_id,
            label: priority.priority_name
          }))
        ]);

        setCategories(categories);
      } catch (error) {
        console.error('Failed to load options:', error);
        setError(t('messages.filtersError', 'Failed to load filter options.'));
      }
    };

    loadOptions();
  }, []);

  useEffect(() => {
    let active = true;

    const loadBoardStatuses = async () => {
      const uniqueBoardIds = Array.from(
        new Set(
          tickets
            .map((ticket) => ticket.board_id)
            .filter((boardId): boardId is string => Boolean(boardId))
        )
      );

      if (uniqueBoardIds.length === 0) {
        setBoardStatusOptions({});
        return;
      }

      try {
        const boardStatusEntries = await Promise.all(
          uniqueBoardIds.map(async (boardId) => {
            const statuses: IStatus[] = await getTicketStatuses(boardId);
            return [
              boardId,
              statuses.map((status: IStatus): SelectOption => ({
                value: status.status_id!,
                label: status.name ?? '',
                className: status.is_closed ? 'bg-gray-200 text-gray-600' : undefined,
              })),
            ] as const;
          })
        );

        if (!active) {
          return;
        }

        setBoardStatusOptions(Object.fromEntries(boardStatusEntries));
      } catch (error) {
        console.error('Failed to load board-scoped client portal statuses:', error);
        if (active) {
          setBoardStatusOptions({});
        }
      }
    };

    loadBoardStatuses();

    return () => {
      active = false;
    };
  }, [tickets]);

  const statusOptions = useMemo<SelectOption[]>(() => {
    const groupedOptions = buildTicketStatusFilterOptions(rawStatusOptions, undefined, selectedStatus)
      .filter((option) =>
        option.value !== TICKET_STATUS_FILTER_ALL &&
        option.value !== TICKET_STATUS_FILTER_OPEN
      );

    return [
      { value: TICKET_STATUS_FILTER_ALL, label: t('filters.allStatuses') },
      { value: TICKET_STATUS_FILTER_OPEN, label: t('filters.allOpen') },
      { value: TICKET_STATUS_FILTER_CLOSED, label: t('filters.allClosed') },
      ...groupedOptions,
    ];
  }, [rawStatusOptions, selectedStatus, t]);

  // Authoritative status_id → is_closed, so the status pill colors green from
  // the status definition (consistent per status) rather than the per-ticket
  // is_closed flag, which can drift so two tickets sharing a status differ.
  // Falls back to the record flag only when the status isn't in the list.
  const statusClosedById = useMemo(
    () => new Map(rawStatusOptions.map((o) => [o.value, !!o.isClosed])),
    [rawStatusOptions]
  );

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
      setError(t('messages.loadingError', 'Failed to load tickets. Please try again.'));
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
    const newStatusLabel = rawStatusOptions.find(s => s.value === newStatus)?.label || 'Unknown Status';

    try {
      await updateTicketStatus(ticketId, newStatus);

      toast.success(t('messages.statusUpdateSuccess', 'Ticket status successfully updated to "{{status}}".', { status: newStatusLabel }));

      // Refresh tickets by calling loadTickets
      loadTickets(); 
    } catch (error) {
      handleError(error, t('messages.statusUpdateError', 'Failed to update ticket status.'));
    } finally {
      setTicketToUpdateStatus(null);
    }
  }, [ticketToUpdateStatus, loadTickets, rawStatusOptions]);

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

  const isFiltered = useMemo(() => {
    return selectedStatus !== TICKET_STATUS_FILTER_ALL ||
      selectedResponseStatus !== 'all' ||
      selectedPriority !== 'all' ||
      selectedCategories.length > 0 ||
      excludedCategories.length > 0 ||
      searchQuery !== '';
  }, [selectedStatus, selectedResponseStatus, selectedPriority, selectedCategories, excludedCategories, searchQuery]);

  const handleResetFilters = useCallback(() => {
    setSelectedStatus(TICKET_STATUS_FILTER_ALL);
    setSelectedResponseStatus('all');
    setSelectedPriority('all');
    setSelectedCategories([]);
    setExcludedCategories([]);
    setSearchQuery('');
    setCurrentPage(1);
  }, []);

  const columns: ColumnDefinition<ITicketListItem>[] = [
    // Ticket — the hero cell: bold title with the mono ticket number and
    // category folded underneath (mirrors the MSP Refined List design).
    {
      title: t('fields.title'),
      dataIndex: 'title',
      width: '32%',
      render: (value: string, record: ITicketListItem) => {
        const hasCategory = !!(record.category_id || record.subcategory_id);
        const categoryLabel = hasCategory ? formatCategoryLabel(record, categories) : null;
        return (
          <div className="flex flex-col gap-0.5 overflow-hidden">
            <Link
              href={`/client-portal/tickets/${record.ticket_id}`}
              className="block truncate font-semibold text-[rgb(var(--color-text-900))] hover:text-[rgb(var(--color-secondary-600))]"
              onClick={(e) => e.stopPropagation()}
            >
              {value}
            </Link>
            <div className="flex items-center gap-1.5 overflow-hidden text-[11px] leading-tight text-[rgb(var(--color-text-500))]">
              <Link
                href={`/client-portal/tickets/${record.ticket_id}`}
                className="shrink-0 font-mono text-[11px] text-[rgb(var(--color-text-400))] hover:text-[rgb(var(--color-secondary-600))]"
                onClick={(e) => e.stopPropagation()}
              >
                {record.ticket_number}
              </Link>
              {categoryLabel && (
                <>
                  <span className="text-[rgb(var(--color-text-300))]">·</span>
                  <span className="truncate">{categoryLabel}</span>
                </>
              )}
            </div>
          </div>
        );
      },
    },
    {
      title: t('fields.status'),
      dataIndex: 'status_name',
      width: '20%',
      render: (value: string, record: ITicketListItem) => {
        // Get response_state from the record (F026-F030)
        const responseState = record.response_state as TicketResponseState | undefined;
        const closed =
          record.status_id && statusClosedById.has(record.status_id)
            ? !!statusClosedById.get(record.status_id)
            : ((record as { is_closed?: boolean }).is_closed ?? false);
        const hue = statusPillHue(value || '', closed);
        return (
          <div className="flex items-center gap-2">
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <button
                  id="change-ticket-status-button"
                  type="button"
                  className="inline-flex min-w-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium text-[rgb(var(--color-text-700))] cursor-pointer"
                  style={{ backgroundColor: `rgb(${hue} / 0.14)`, borderColor: `rgb(${hue} / 0.30)` }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: `rgb(${hue})` }} />
                  <span className="overflow-hidden text-ellipsis">{value || 'No Status'}</span>
                  <ChevronDown className="h-3 w-3 shrink-0 text-[rgb(var(--color-text-400))]" />
                </button>
              </DropdownMenu.Trigger>

              <DropdownMenu.Content
                className="w-48 rounded-md bg-white shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none z-50"
              >
                {(record.board_id ? (boardStatusOptions[record.board_id] ?? []) : [])
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
            {responseStateTrackingEnabled && responseState && (
              <ResponseStateBadge
                responseState={responseState}
                isClientPortal={true}
                size="sm"
                className="ml-auto shrink-0"
                labels={{
                  awaitingClient: t('responseState.awaitingYourResponse', 'Awaiting Your Response'),
                  awaitingInternal: t('responseState.awaitingSupportResponse', 'Awaiting Support Response'),
                  awaitingClientTooltip: t('responseState.awaitingYourResponseTooltip', 'Support is waiting for your response'),
                  awaitingInternalTooltip: t('responseState.awaitingSupportResponseTooltip', 'Your response has been received. Support will respond soon.'),
                }}
              />
            )}
          </div>
        );
      },
    },
    {
      title: t('fields.priority'),
      dataIndex: 'priority_name',
      width: '12%',
      render: (value: string, record: ITicketListItem) => (
        <div className="flex items-center gap-2">
          <span
            className="h-3.5 w-[3px] shrink-0 rounded-full"
            style={{ backgroundColor: record.priority_color || '#94a3b8' }}
          />
          <span className="font-medium text-[rgb(var(--color-text-700))]">{value || 'No Priority'}</span>
        </div>
      ),
    },
    {
      // Two-line due cell: smart primary label + a relative "in N days" hint,
      // colored for overdue/soon urgency. (No SLA line — clients don't see SLA.)
      title: t('fields.dueDate', 'Due Date'),
      dataIndex: 'due_date',
      width: '13%',
      render: (value: string | null) => {
        if (!value) {
          return <span className="text-sm text-[rgb(var(--color-text-400))]">No due date</span>;
        }

        const now = new Date();
        const dueDate = new Date(value);
        const hoursUntilDue = (dueDate.getTime() - now.getTime()) / (1000 * 60 * 60);

        let primaryClass = 'text-[rgb(var(--color-text-700))]';
        if (hoursUntilDue < 0) primaryClass = 'text-red-600 dark:text-red-400';
        else if (hoursUntilDue <= 24) primaryClass = 'text-orange-600 dark:text-orange-400';

        const d = daysUntil(dueDate, now);
        const secondary = d >= 2 ? `in ${d} days` : null;

        return (
          <div className="flex flex-col leading-tight">
            <span className={`text-sm font-medium ${primaryClass}`}>{formatDuePrimary(dueDate, now)}</span>
            {secondary && <span className="text-[11px] text-[rgb(var(--color-text-400))]">{secondary}</span>}
          </div>
        );
      },
    },
    {
      title: t('fields.assignedTo'),
      dataIndex: 'assigned_to_name',
      width: '15%',
      render: (value: string | null, record: ITicketListItem) => {
        const additionalCount = record.additional_agent_count || 0;
        const additionalAgents = record.additional_agents || [];
        return (
          <div className="text-sm text-[rgb(var(--color-text-700))] flex items-center gap-2">
            {value ? (
              <UserAvatar
                userId={record.assigned_to || value}
                userName={value}
                avatarUrl={additionalAgentAvatarUrls[record.assigned_to ?? ''] ?? null}
                size="xs"
              />
            ) : (
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-dashed border-[rgb(var(--color-border-400))] text-xs text-[rgb(var(--color-text-400))]">
                +
              </span>
            )}
            <span className="truncate">{value || 'Unassigned'}</span>
            {record.assigned_team_id && record.assigned_team_name && (
              <Tooltip content={record.assigned_team_name}>
                <span className="inline-flex items-center cursor-help">
                  <TeamAvatar
                    teamId={record.assigned_team_id}
                    teamName={record.assigned_team_name}
                    avatarUrl={teamAvatarUrls[record.assigned_team_id] ?? null}
                    size="xs"
                  />
                </span>
              </Tooltip>
            )}
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
      title: t('fields.updatedAt'),
      dataIndex: 'updated_at',
      width: '14%',
      render: (value: string | null) => (
        <div className="text-sm text-[rgb(var(--color-text-500))]">
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
      <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-4">
        <p className="text-destructive">{error}</p>
      </div>
    );
  }

  return (
    <div className="bg-white shadow rounded-lg w-full">
      <div className="sticky top-0 z-40 bg-white rounded-t-lg p-6 border-b border-gray-100">
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

          {responseStateTrackingEnabled && (
            <CustomSelect
              options={[
                { value: 'all', label: t('filters.allResponseStatuses', 'All Response Statuses') },
                { value: 'awaiting_client', label: t('responseState.awaitingYourResponse', 'Awaiting Your Response') },
                { value: 'awaiting_internal', label: t('responseState.awaitingSupportResponse', 'Awaiting Support Response') },
                { value: 'none', label: t('responseState.none', 'No Response Pending') },
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
              placeholder={t('filters.responseStatus', 'Response Status')}
            />
          )}

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
            placeholder={t('filters.category')}
            multiSelect={true}
            showExclude={true}
            showReset={true}
            allowEmpty={true}
            className="text-sm min-w-[200px]"
          />

          <div className="h-6 w-px bg-gray-200 mx-1 shrink-0" />

          <Input
            id="client-portal-search-tickets-input"
            placeholder={t('filters.search')}
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
              className={`shrink-0 flex items-center gap-1 ${isFiltered ? 'text-gray-500 hover:text-gray-700' : 'invisible'}`}
              disabled={!isFiltered}
              id="reset-filters-button"
            >
              <XCircle className="h-4 w-4" />
              Reset
            </Button>

            <Button
              id="create-ticket-button"
              className="ml-auto bg-[rgb(var(--color-primary-500))] text-white hover:bg-[rgb(var(--color-primary-600))] px-4 py-2 shrink-0"
              onClick={() => setIsAddTicketOpen(true)}
            >
              {t('createButton')}
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
            rowClassName={() => ""}
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
        message={`Are you sure you want to change the status from "${ticketToUpdateStatus?.currentStatus}" to "${rawStatusOptions.find(s => s.value === ticketToUpdateStatus?.newStatus)?.label}"?`}
        confirmLabel="Update"
        cancelLabel="Cancel"
      />
    </div>
  );
}
