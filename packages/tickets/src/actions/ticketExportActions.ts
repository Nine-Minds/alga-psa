'use server'

import type { ITicketListFilters, ITicketListItem, ITag } from '@alga-psa/types';
import { createTenantKnex } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import { getTicketsForList } from './optimizedTicketActions';

const MAX_EXPORT_ROWS = 10000;

const CSV_FIELDS = [
  'ticket_number',
  'title',
  'status',
  'is_closed',
  'priority',
  'board',
  'category',
  'subcategory',
  'client',
  'contact',
  'assigned_to',
  'assigned_team',
  'entered_by',
  'updated_by',
  'closed_by',
  'entered_at',
  'updated_at',
  'closed_at',
  'due_date',
  'response_state',
  'ticket_origin',
  'tags',
] as const;

const CSV_HEADERS: Record<string, string> = {
  ticket_number: 'Ticket Number',
  title: 'Title',
  status: 'Status',
  is_closed: 'Is Closed',
  priority: 'Priority',
  board: 'Board',
  category: 'Category',
  subcategory: 'Subcategory',
  client: 'Client',
  contact: 'Contact',
  assigned_to: 'Assigned To',
  assigned_team: 'Assigned Team',
  entered_by: 'Entered By',
  updated_by: 'Updated By',
  closed_by: 'Closed By',
  entered_at: 'Entered At',
  updated_at: 'Updated At',
  closed_at: 'Closed At',
  due_date: 'Due Date',
  response_state: 'Response State',
  ticket_origin: 'Ticket Origin',
  tags: 'Tags',
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

function formatTicketOrigin(origin: string | null | undefined): string {
  if (!origin) return '';
  switch (origin) {
    case 'email': return 'Email';
    case 'client_portal': return 'Client Portal';
    case 'manual': return 'Manual';
    default: return origin;
  }
}

interface NameLookups {
  contacts: Record<string, string>;
  users: Record<string, string>;
  categories: Record<string, string>;
}

function ticketToRow(
  ticket: ITicketListItem,
  lookups: NameLookups,
  ticketTags: Record<string, ITag[]>,
): Record<string, string> {
  const contactName = ticket.contact_name_id
    ? lookups.contacts[ticket.contact_name_id] || ''
    : '';
  const updatedByName = ticket.updated_by
    ? lookups.users[ticket.updated_by] || ''
    : '';
  const closedByName = ticket.closed_by
    ? lookups.users[ticket.closed_by] || ''
    : '';

  // Resolve subcategory name
  let subcategoryName = '';
  if (ticket.subcategory_id) {
    subcategoryName = lookups.categories[ticket.subcategory_id] || '';
  }

  // Format tags as comma-separated string
  const tags = ticket.ticket_id
    ? (ticketTags[ticket.ticket_id] || []).map(t => t.tag_text).join(', ')
    : '';

  return {
    ticket_number: ticket.ticket_number || '',
    title: ticket.title || '',
    status: ticket.status_name || '',
    is_closed: (ticket as any).is_closed ? 'Yes' : 'No',
    priority: ticket.priority_name || '',
    board: ticket.board_name || '',
    category: ticket.category_name || '',
    subcategory: subcategoryName,
    client: ticket.client_name || '',
    contact: contactName,
    assigned_to: ticket.assigned_to_name || '',
    assigned_team: ticket.assigned_team_name || '',
    entered_by: ticket.entered_by_name || '',
    updated_by: updatedByName,
    closed_by: closedByName,
    entered_at: formatDate(ticket.entered_at),
    updated_at: formatDate(ticket.updated_at),
    closed_at: formatDate(ticket.closed_at),
    due_date: formatDate(ticket.due_date),
    response_state: formatResponseState(ticket.response_state),
    ticket_origin: formatTicketOrigin(ticket.ticket_origin),
    tags,
  };
}

/**
 * Batch-resolve contact names, user names, and subcategory names
 * for all tickets in a single set of queries.
 */
async function resolveNameLookups(tickets: ITicketListItem[], tenant: string): Promise<NameLookups> {
  const { knex: db } = await createTenantKnex();

  // Collect unique IDs
  const contactIds = new Set<string>();
  const userIds = new Set<string>();
  const subcategoryIds = new Set<string>();

  for (const t of tickets) {
    if (t.contact_name_id) contactIds.add(t.contact_name_id);
    if (t.updated_by) userIds.add(t.updated_by);
    if (t.closed_by) userIds.add(t.closed_by);
    if (t.subcategory_id) subcategoryIds.add(t.subcategory_id);
  }

  const lookups: NameLookups = { contacts: {}, users: {}, categories: {} };

  // Resolve contacts
  if (contactIds.size > 0) {
    const contacts = await db('contacts')
      .select('contact_name_id', 'full_name')
      .whereIn('contact_name_id', Array.from(contactIds))
      .andWhere('tenant', tenant);
    for (const c of contacts) {
      lookups.contacts[c.contact_name_id] = c.full_name || '';
    }
  }

  // Resolve user names (for updated_by and closed_by)
  if (userIds.size > 0) {
    const users = await db('users')
      .select('user_id', db.raw("CONCAT(first_name, ' ', last_name) as full_name"))
      .whereIn('user_id', Array.from(userIds))
      .andWhere('tenant', tenant);
    for (const u of users) {
      lookups.users[u.user_id] = u.full_name || '';
    }
  }

  // Resolve subcategory names
  if (subcategoryIds.size > 0) {
    const categories = await db('categories')
      .select('category_id', 'category_name')
      .whereIn('category_id', Array.from(subcategoryIds))
      .andWhere('tenant', tenant);
    for (const c of categories) {
      lookups.categories[c.category_id] = c.category_name || '';
    }
  }

  return lookups;
}

export const exportTicketsToCSV = withAuth(async (
  _user,
  { tenant },
  filters: ITicketListFilters,
  selectedFields?: string[],
  ticketIds?: string[]
): Promise<{ csv: string; count: number }> => {
  const result = await getTicketsForList(filters, 1, MAX_EXPORT_ROWS);

  // Filter to only selected tickets if IDs are provided
  const tickets = ticketIds && ticketIds.length > 0
    ? result.tickets.filter(t => t.ticket_id && ticketIds.includes(t.ticket_id))
    : result.tickets;

  // Resolve names that aren't part of the standard list query
  const lookups = await resolveNameLookups(tickets, tenant);
  const ticketTags = result.metadata?.ticketTags || {};

  const rows = tickets.map(t => ticketToRow(t, lookups, ticketTags));

  // Use selected fields if provided, otherwise all fields
  const allFieldKeys = CSV_FIELDS as readonly string[];
  const fields = selectedFields
    ? selectedFields.filter(f => allFieldKeys.includes(f))
    : [...CSV_FIELDS] as string[];

  if (fields.length === 0) {
    return { csv: '', count: 0 };
  }

  // Build header row using friendly names
  const headerRow = fields.map(f => CSV_HEADERS[f] || f);
  const dataRows = rows.map(row =>
    fields.map(f => row[f] || '')
  );

  const escapeField = (field: string): string => {
    let str = String(field);
    // Guard against CSV injection: prefix dangerous leading characters with a single quote
    // so spreadsheet apps don't interpret the value as a formula.
    if (/^[=+\-@\t\r]/.test(str)) {
      str = "'" + str;
    }
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const csvLines = [
    headerRow.map(escapeField).join(','),
    ...dataRows.map(row => row.map(escapeField).join(','))
  ];

  return { csv: csvLines.join('\n'), count: tickets.length };
});
