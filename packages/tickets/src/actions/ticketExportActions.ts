'use server'

import type { ITicketListFilters, ITicketListItem } from '@alga-psa/types';
import { getTicketsForList } from './optimizedTicketActions';

const MAX_EXPORT_ROWS = 10000;

const CSV_FIELDS = [
  'ticket_number',
  'title',
  'status',
  'priority',
  'board',
  'category',
  'client',
  'assigned_to',
  'assigned_team',
  'entered_by',
  'entered_at',
  'updated_at',
  'closed_at',
  'due_date',
  'response_state',
] as const;

const CSV_HEADERS: Record<string, string> = {
  ticket_number: 'Ticket Number',
  title: 'Title',
  status: 'Status',
  priority: 'Priority',
  board: 'Board',
  category: 'Category',
  client: 'Client',
  assigned_to: 'Assigned To',
  assigned_team: 'Assigned Team',
  entered_by: 'Entered By',
  entered_at: 'Entered At',
  updated_at: 'Updated At',
  closed_at: 'Closed At',
  due_date: 'Due Date',
  response_state: 'Response State',
};

function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (isNaN(date.getTime())) return '';
  return date.toISOString();
}

function formatResponseState(state: string | null | undefined): string {
  if (!state) return '';
  switch (state) {
    case 'awaiting_client': return 'Awaiting Client';
    case 'awaiting_internal': return 'Awaiting Internal';
    default: return state;
  }
}

function ticketToRow(ticket: ITicketListItem): Record<string, string> {
  return {
    ticket_number: ticket.ticket_number || '',
    title: ticket.title || '',
    status: ticket.status_name || '',
    priority: ticket.priority_name || '',
    board: ticket.board_name || '',
    category: ticket.category_name || '',
    client: ticket.client_name || '',
    assigned_to: ticket.assigned_to_name || '',
    assigned_team: ticket.assigned_team_name || '',
    entered_by: ticket.entered_by_name || '',
    entered_at: formatDate(ticket.entered_at),
    updated_at: formatDate(ticket.updated_at),
    closed_at: formatDate(ticket.closed_at),
    due_date: formatDate(ticket.due_date),
    response_state: formatResponseState(ticket.response_state),
  };
}

export async function exportTicketsToCSV(
  filters: ITicketListFilters
): Promise<{ csv: string; count: number }> {
  const result = await getTicketsForList(filters, 1, MAX_EXPORT_ROWS);
  const rows = result.tickets.map(ticketToRow);

  const fields = [...CSV_FIELDS] as string[];

  // Build header row using friendly names
  const headerRow = fields.map(f => CSV_HEADERS[f] || f);
  const dataRows = rows.map(row =>
    fields.map(f => row[f] || '')
  );

  // Use unparseCSV-style escaping but with custom headers
  const escapeField = (field: string): string => {
    const str = String(field);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const csvLines = [
    headerRow.map(escapeField).join(','),
    ...dataRows.map(row => row.map(escapeField).join(','))
  ];

  return { csv: csvLines.join('\n'), count: result.tickets.length };
}
