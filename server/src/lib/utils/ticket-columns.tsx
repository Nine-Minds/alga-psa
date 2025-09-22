import React from 'react';
import { ColumnDefinition } from 'server/src/interfaces/dataTable.interfaces';
import { ITicketListItem, ITicketCategory } from 'server/src/interfaces/ticket.interfaces';
import { TicketingDisplaySettings } from 'server/src/lib/actions/ticket-actions/ticketDisplaySettings';
import { TagManager } from 'server/src/components/tags';
import { ITag } from 'server/src/interfaces/tag.interfaces';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from 'server/src/components/ui/DropdownMenu';
import { Button } from 'server/src/components/ui/Button';
import { MoreVertical, Trash2 } from 'lucide-react';
import { format } from 'date-fns';
import { IChannel } from 'server/src/interfaces/channel.interface';

interface CreateTicketColumnsOptions {
  categories: ITicketCategory[];
  channels: IChannel[];
  displaySettings?: TicketingDisplaySettings;
  onTicketClick: (ticketId: string) => void;
  onDeleteClick?: (ticketId: string, ticketName: string) => void;
  ticketTagsRef?: React.MutableRefObject<Record<string, ITag[]>>;
  onTagsChange?: (ticketId: string, tags: ITag[]) => void;
  showActions?: boolean;
  showTags?: boolean;
  showClient?: boolean;
  onClientClick?: (companyId: string) => void;
}

export function createTicketColumns(options: CreateTicketColumnsOptions): ColumnDefinition<ITicketListItem>[] {
  const {
    categories,
    channels,
    displaySettings,
    onTicketClick,
    onDeleteClick,
    ticketTagsRef,
    onTagsChange,
    showActions = true,
    showTags = true,
    showClient = true,
    onClientClick,
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

  // Helper function to get channel for a ticket
  const getChannelForTicket = (ticket: ITicketListItem): IChannel | undefined => {
    return channels.find(channel => channel.channel_id === ticket.channel_id);
  };

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
          <button
            onClick={() => onTicketClick(record.ticket_id as string)}
            className="text-blue-500 hover:underline cursor-pointer bg-transparent border-none p-0 block break-all whitespace-normal text-left"
            style={{ wordBreak: 'break-all', overflowWrap: 'anywhere' }}
          >
            {value}
          </button>
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
        <div className="flex flex-col gap-1">
          <span>{value}</span>
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

  // Board/Channel
  if (columnVisibility.board) {
    columns.push({
      key: 'board',
      col: {
        title: 'Board',
        dataIndex: 'channel_name',
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
        dataIndex: 'category_id',
        width: '10%',
        render: (value: string, record: ITicketListItem) => {
          const channel = getChannelForTicket(record);

          // Use unified category display for all channels (ITIL and custom)
          if (!value && !record.subcategory_id) return 'No Category';

          // If there's a subcategory, use that for display
          if (record.subcategory_id) {
            const subcategory = categories.find(c => c.category_id === record.subcategory_id);
            if (!subcategory) return 'Unknown Category';

            const parent = categories.find(c => c.category_id === subcategory.parent_category);
            return parent ? `${parent.category_name} → ${subcategory.category_name}` : subcategory.category_name;
          }

          // Otherwise use the main category
          const category = categories.find(c => c.category_id === value);
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
        dataIndex: 'company_name',
        width: '15%',
        render: onClientClick ? (value: string, record: ITicketListItem) => (
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (record.company_id) onClientClick(record.company_id);
            }}
            className="text-blue-500 hover:underline text-left whitespace-normal break-words bg-transparent border-none p-0"
          >
            {value || 'No Client'}
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