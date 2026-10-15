import React from 'react';
import type { ColumnDefinition, ITicketListItem } from '@alga-psa/types';
import { Button } from '@alga-psa/ui/components/Button';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@alga-psa/ui/components/DropdownMenu';
import { MoreVertical, Copy, LayoutTemplate } from 'lucide-react';

interface CreateTicketActionsColumnOptions {
  t: (key: string, defaultValue: string) => string;
  onDuplicate: (ticketId: string) => void;
  /** "Create template from ticket"; the item is only rendered when `canCreateTemplate` is true. */
  onCreateTemplate?: (ticketId: string) => void;
  canCreateTemplate?: boolean;
}

/**
 * Trailing row-actions column of the ticket list.
 *
 * dataIndex MUST be 'actions': computeColumnFit pins a trailing actions column
 * by that id (titles are JSX/localized), otherwise the ⋮ menu is column-fitted
 * away at common widths.
 */
export function createTicketActionsColumn({
  t,
  onDuplicate,
  onCreateTemplate,
  canCreateTemplate = false,
}: CreateTicketActionsColumnOptions): ColumnDefinition<ITicketListItem> {
  return {
    title: <span className="sr-only">{t('actions.rowActions', 'Actions')}</span>,
    dataIndex: 'actions',
    width: '4%',
    headerClassName: 'text-center px-2',
    cellClassName: 'text-center px-2',
    sortable: false,
    render: (_value: unknown, record: ITicketListItem) => {
      const ticketId = record.ticket_id;
      if (!ticketId) {
        return null;
      }

      return (
        <div
          className="flex items-center justify-center"
          onClick={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                id={`ticket-actions-menu-${ticketId}`}
                variant="ghost"
                className="h-8 w-8 p-0"
                onClick={(event) => event.stopPropagation()}
              >
                <span className="sr-only">{t('actions.openMenu', 'Open menu')}</span>
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                id="duplicate-ticket-menu-item"
                onClick={(event) => {
                  // Menu content is portaled, but React still bubbles the click to the
                  // row's onClick (open ticket) unless it is stopped here.
                  event.stopPropagation();
                  onDuplicate(ticketId);
                }}
              >
                <Copy className="h-4 w-4 mr-2" />
                {t('actions.duplicate', 'Duplicate')}
              </DropdownMenuItem>
              {canCreateTemplate && onCreateTemplate && (
                <DropdownMenuItem
                  id="create-template-ticket-menu-item"
                  onClick={(event) => {
                    event.stopPropagation();
                    onCreateTemplate(ticketId);
                  }}
                >
                  <LayoutTemplate className="h-4 w-4 mr-2" />
                  {t('actions.createTemplate', 'Create template from ticket')}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      );
    },
  };
}
