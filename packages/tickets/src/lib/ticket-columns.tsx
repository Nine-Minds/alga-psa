import React from 'react';
import Link from 'next/link';
import type { ColumnDefinition, ITicketListItem, ITicketCategory, TicketResponseState, ITag, IBoard } from '@alga-psa/types';
import { TagManager } from '@alga-psa/tags/components';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@alga-psa/ui/components/DropdownMenu';
import { Button } from '@alga-psa/ui/components/Button';
import { Tooltip } from '@alga-psa/ui/components/Tooltip';
import UserAvatar from '@alga-psa/ui/components/UserAvatar';
import { MoreVertical, Trash2, ChevronDown, ChevronRight } from 'lucide-react';
import { format } from 'date-fns';
import { ResponseStateBadge } from '@alga-psa/ui/components';

type TicketListColumnKey =
  | 'ticket_number'
  | 'title'
  | 'status'
  | 'priority'
  | 'board'
  | 'category'
  | 'client'
  | 'assigned_to'
  | 'due_date'
  | 'created'
  | 'created_by'
  | 'tags'
  | 'actions';

type TicketListSettings = {
  columnVisibility?: Partial<Record<TicketListColumnKey, boolean>>;
  tagsInlineUnderTitle?: boolean;
};

type TicketingDisplaySettings = {
  dateTimeFormat?: string;
  list?: TicketListSettings;
};

interface CreateTicketColumnsOptions {
  categories: ITicketCategory[];
  boards: IBoard[];
  displaySettings?: TicketingDisplaySettings;
  onTicketClick: (ticketId: string) => void;
  onDeleteClick?: (ticketId: string, ticketName: string) => void;
  ticketTagsRef?: React.MutableRefObject<Record<string, ITag[]>>;
  onTagsChange?: (ticketId: string, tags: ITag[]) => void;
  showActions?: boolean;
  showTags?: boolean;
  showClient?: boolean;
  onClientClick?: (clientId: string) => void;
  /** Map of user IDs to avatar URLs for displaying in additional agents tooltip */
  additionalAgentAvatarUrls?: Record<string, string | null>;
  isBundleExpanded?: (masterTicketId: string) => boolean;
  onToggleBundleExpanded?: (masterTicketId: string) => void;
}

export function createTicketColumns(options: CreateTicketColumnsOptions): ColumnDefinition<ITicketListItem>[] {
  const {
    categories,
    boards: _boards,
    displaySettings,
    onTicketClick,
    onDeleteClick,
    ticketTagsRef,
    onTagsChange,
    showActions = true,
    showTags = true,
    showClient = true,
    onClientClick,
    additionalAgentAvatarUrls = {},
    isBundleExpanded,
    onToggleBundleExpanded,
  } = options;

  const columnVisibility = displaySettings?.list?.columnVisibility || {
    ticket_number: true,
    title: true,
    status: true,
    priority: true,
    board: true,
    category: true,
    client: true,
    assigned_to: true,
    due_date: true,
    created: true,
    created_by: true,
    tags: true,
    actions: true,
  };

  const tagsInlineUnderTitle = displaySettings?.list?.tagsInlineUnderTitle || false;
  const dateTimeFormat = displaySettings?.dateTimeFormat || 'MMM d, yyyy h:mm a';

  const columns: Array<{ key: string; col: ColumnDefinition<ITicketListItem> }> = [];

  // Ticket Number
  if (columnVisibility.ticket_number) {
    columns.push({
      key: 'ticket_number',
      col: {
        title: 'Ticket Number',
        dataIndex: 'ticket_number',
        width: '10%',
        render: (value: string, record: ITicketListItem) => (
          <div className="flex flex-col gap-1">
            <span className="flex items-center gap-2">
              {!record.master_ticket_id && (record.bundle_child_count ?? 0) > 0 && onToggleBundleExpanded ? (
                <button
                  type="button"
                  className="inline-flex items-center justify-center rounded hover:bg-gray-100 relative z-10"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onToggleBundleExpanded(record.ticket_id as string);
                  }}
                  aria-label="Toggle bundle children"
                >
                  {isBundleExpanded && isBundleExpanded(record.ticket_id as string) ? (
                    <ChevronDown className="h-4 w-4 text-gray-600" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-gray-600" />
                  )}
                </button>
              ) : null}
              <Link
                href={`/msp/tickets/${record.ticket_id}`}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onTicketClick(record.ticket_id as string);
                }}
                className="text-blue-600 hover:text-blue-800 break-all whitespace-normal text-left"
                style={{ wordBreak: 'break-all', overflowWrap: 'anywhere' }}
              >
                {value}
              </Link>
            </span>
            {(record.master_ticket_id || (!record.master_ticket_id && (record.bundle_child_count ?? 0) > 0)) && (
              <div className="flex items-center gap-1">
                {record.master_ticket_id ? (
                  <span className="rounded bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-900">
                    Bundled → {record.bundle_master_ticket_number || 'Master'}
                  </span>
                ) : null}
                {!record.master_ticket_id && (record.bundle_child_count ?? 0) > 0 ? (
                  <span className="rounded bg-indigo-100 px-2 py-0.5 text-[11px] font-medium text-indigo-900">
                    Bundle · {record.bundle_child_count}
                  </span>
                ) : null}
              </div>
            )}
          </div>
        ),
      }
    });
  }

  // Title (with optional inline tags)
  columns.push({
    key: 'title',
    col: {
      title: 'Title',
      dataIndex: 'title',
      width: tagsInlineUnderTitle ? '26%' : '20%',
      render: (value: string, record: ITicketListItem) => (
        <div className="flex flex-col gap-1 overflow-hidden">
          <Link
            href={`/msp/tickets/${record.ticket_id}`}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onTicketClick(record.ticket_id as string);
            }}
            className="text-blue-600 hover:text-blue-800 block whitespace-normal break-words"
          >
            {value}
          </Link>
          {tagsInlineUnderTitle && columnVisibility.tags && showTags && ticketTagsRef && onTagsChange && record.ticket_id && (
            <div onClick={(e) => e.stopPropagation()}>
              <TagManager
                entityId={record.ticket_id}
                entityType="ticket"
                initialTags={ticketTagsRef.current[record.ticket_id] || []}
                onTagsChange={(tags) => onTagsChange(record.ticket_id!, tags)}
              />
            </div>
          )}
        </div>
      ),
    }
  });

  // Status (with response state badge)
  if (columnVisibility.status) {
    columns.push({
      key: 'status',
      col: {
        title: 'Status',
        dataIndex: 'status_name',
        width: '12%',
        render: (value: string, record: ITicketListItem) => {
          // Get response_state from the record - it may be on the record if fetched
          const responseState = (record as any).response_state as TicketResponseState | undefined;
          return (
            <div className="flex items-center gap-1.5 flex-wrap">
              <span>{value || 'No Status'}</span>
              {responseState && (
                <ResponseStateBadge
                  responseState={responseState}
                  variant="badge"
                  size="sm"
                />
              )}
            </div>
          );
        },
      }
    });
  }

  // Priority
  if (columnVisibility.priority) {
    columns.push({
      key: 'priority',
      col: {
        title: 'Priority',
        dataIndex: 'priority_name',
        width: '10%',
        render: (value: string, record: ITicketListItem) => {
          // All tickets now use the unified priority system with priority_name and priority_color
          return (
            <div className="flex items-center gap-2">
              <div
                className="w-3 h-3 rounded-full border border-gray-300"
                style={{ backgroundColor: record.priority_color || '#6B7280' }}
              />
              <span>{value || 'No Priority'}</span>
            </div>
          );
        },
      }
    });
  }

  // Board
  if (columnVisibility.board) {
    columns.push({
      key: 'board',
      col: {
        title: 'Board',
        dataIndex: 'board_name',
        width: '10%',
      }
    });
  }

  // Category
  if (columnVisibility.category) {
    columns.push({
      key: 'category',
      col: {
        title: 'Category',
        dataIndex: 'category_name',
        width: '10%',
        render: (_value: string, record: ITicketListItem) => {
          const categoryId = record.category_id || null;

          // Use unified category display for all boards (ITIL and custom)
          if (!categoryId && !record.subcategory_id) return 'No Category';

          // If there's a subcategory, use that for display
          if (record.subcategory_id) {
            const subcategory = categories.find(c => c.category_id === record.subcategory_id);
            if (!subcategory) return 'Unknown Category';

            const parent = categories.find(c => c.category_id === subcategory.parent_category);
            return parent ? `${parent.category_name} → ${subcategory.category_name}` : subcategory.category_name;
          }

          // Otherwise use the main category
          const category = categories.find(c => c.category_id === categoryId);
          if (!category) return 'Unknown Category';
          return category.category_name;
        },
      }
    });
  }

  // Client
  if (columnVisibility.client && showClient) {
    columns.push({
      key: 'client',
      col: {
        title: 'Client',
        dataIndex: 'client_name',
        width: '15%',
        render: onClientClick ? (value: string, record: ITicketListItem) => (
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (record.client_id) onClientClick(record.client_id);
            }}
            className="text-blue-500 hover:underline text-left whitespace-normal break-words bg-transparent border-none p-0"
          >
            <div className="flex flex-col gap-1">
              <span>{value || 'No Client'}</span>
              {!record.master_ticket_id && (record.bundle_child_count ?? 0) > 0 && (record.bundle_distinct_client_count ?? 0) > 1 ? (
                <span className="rounded bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-900">
                  Multiple clients
                </span>
              ) : null}
            </div>
          </button>
        ) : undefined,
      }
    });
  }

  // Assigned To
  if (columnVisibility.assigned_to) {
    columns.push({
      key: 'assigned_to',
      col: {
        title: 'Assigned To',
        dataIndex: 'assigned_to_name',
        width: '12%',
        render: (value: string | null, record: ITicketListItem) => {
          const additionalCount = record.additional_agent_count || 0;
          const additionalAgents = record.additional_agents || [];
          return (
            <span className="text-gray-700 flex items-center gap-1.5">
              {value || 'Unassigned'}
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
            </span>
          );
        },
      }
    });
  }

  // Due Date
  if (columnVisibility.due_date) {
    columns.push({
      key: 'due_date',
      col: {
        title: 'Due Date',
        dataIndex: 'due_date',
        width: '12%',
        render: (value: string | null) => {
          if (!value) {
            return <div className="text-sm text-gray-500">-</div>;
          }

          const dueDate = new Date(value);
          const now = new Date();
          const hoursUntilDue = (dueDate.getTime() - now.getTime()) / (1000 * 60 * 60);

          // Check if time is midnight (00:00) - show date only
          const isMidnight = dueDate.getHours() === 0 && dueDate.getMinutes() === 0;
          const displayFormat = isMidnight ? 'MMM d, yyyy' : dateTimeFormat;

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
      }
    });
  }

  // Created
  if (columnVisibility.created) {
    columns.push({
      key: 'created',
      col: {
        title: 'Created',
        dataIndex: 'entered_at',
        width: '12%',
        render: (value: string | null) => (
          <div className="text-sm text-gray-500">
            {value ? format(new Date(value), dateTimeFormat) : '-'}
          </div>
        ),
      }
    });
  }

  // Created By
  if (columnVisibility.created_by) {
    columns.push({
      key: 'created_by',
      col: {
        title: 'Created By',
        dataIndex: 'entered_by_name',
        width: '12%',
      }
    });
  }

  // Tags (as separate column)
  if (columnVisibility.tags && !tagsInlineUnderTitle && showTags && ticketTagsRef && onTagsChange) {
    columns.push({
      key: 'tags',
      col: {
        title: 'Tags',
        dataIndex: 'tags',
        width: '13%',
        sortable: false,
        render: (_value: string, record: ITicketListItem) => {
          if (!record.ticket_id) return null;
          return (
            <div onClick={(e) => e.stopPropagation()}>
              <TagManager
                entityId={record.ticket_id}
                entityType="ticket"
                initialTags={ticketTagsRef.current[record.ticket_id] || []}
                onTagsChange={(tags) => onTagsChange(record.ticket_id!, tags)}
              />
            </div>
          );
        },
      }
    });
  }

  // Actions
  if (columnVisibility.actions && showActions && onDeleteClick) {
    columns.push({
      key: 'actions',
      col: {
        title: 'Actions',
        dataIndex: 'actions',
        width: '3%',
        sortable: false,
        render: (_value: string, record: ITicketListItem) => (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button id={`ticket-actions-${record.ticket_id}`} variant="ghost" size="sm" className="h-8 w-8 p-0">
                <span className="sr-only">Open menu</span>
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="bg-white z-50">
              <DropdownMenuItem
                className="px-2 py-1 text-sm cursor-pointer hover:bg-gray-100 text-red-600 flex items-center"
                onSelect={() => onDeleteClick(record.ticket_id as string, record.title || record.ticket_number)}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ),
      }
    });
  }

  return columns.map(c => c.col);
}
