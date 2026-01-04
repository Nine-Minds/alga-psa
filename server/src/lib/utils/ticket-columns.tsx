import React from 'react';
import Link from 'next/link';
import { ColumnDefinition } from 'server/src/interfaces/dataTable.interfaces';
import { ITicketListItem, ITicketCategory } from 'server/src/interfaces/ticket.interfaces';
import { TicketingDisplaySettings } from 'server/src/lib/actions/ticket-actions/ticketDisplaySettings';
import { TagManager } from 'server/src/components/tags';
import { ITag } from 'server/src/interfaces/tag.interfaces';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from 'server/src/components/ui/DropdownMenu';
import { Button } from 'server/src/components/ui/Button';
import { MoreVertical, Trash2, ChevronDown, ChevronRight } from 'lucide-react';
import { format } from 'date-fns';
import { IBoard } from 'server/src/interfaces/board.interface';

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
          <Link
            href={`/msp/tickets/${record.ticket_id}`}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onTicketClick(record.ticket_id as string);
            }}
            className="text-blue-600 hover:text-blue-800 block break-all whitespace-normal text-left"
            style={{ wordBreak: 'break-all', overflowWrap: 'anywhere' }}
          >
            <span className="flex items-center gap-2">
              {!record.master_ticket_id && (record.bundle_child_count ?? 0) > 0 && onToggleBundleExpanded ? (
                <button
                  type="button"
                  className="inline-flex items-center justify-center rounded hover:bg-gray-100"
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
              <span>{value}</span>
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
            </span>
          </Link>
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

  // Status
  if (columnVisibility.status) {
    columns.push({
      key: 'status',
      col: {
        title: 'Status',
        dataIndex: 'status_name',
        width: '10%',
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
            <span className="inline-flex items-center gap-2">
              <span>{value || 'No Client'}</span>
              {!record.master_ticket_id && (record.bundle_child_count ?? 0) > 0 && (record.bundle_distinct_client_count ?? 0) > 1 ? (
                <span className="rounded bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-900">
                  Multiple clients
                </span>
              ) : null}
            </span>
          </button>
        ) : undefined,
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
