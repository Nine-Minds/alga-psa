import { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

export interface TicketTestData {
  title: string;
  description?: string;
  status_id?: string;
  priority_id?: string;
  assigned_to?: string;
  company_id?: string;
  contact_name_id?: string;
  board_id?: string;
  category_id?: string;
  subcategory_id?: string;
  url?: string;
  attributes?: Record<string, any>;
  tags?: string[];
}

export interface TicketCommentTestData {
  comment_text: string;
  is_internal?: boolean;
  time_spent?: number;
}

/**
 * Create a test ticket with default values
 */
export function createTicketTestData(overrides: Partial<TicketTestData> = {}): TicketTestData {
  const now = Date.now();
  const baseData = {
    title: `Test Ticket ${now}`,
    tags: ['test', 'automated'],
    ...overrides
  };

  // Put description in attributes if provided
  if (overrides.description && !overrides.attributes) {
    baseData.attributes = { description: overrides.description };
    delete baseData.description;
  }

  return baseData;
}

/**
 * Create a test ticket comment
 */
export function createTicketCommentTestData(overrides: Partial<TicketCommentTestData> = {}): TicketCommentTestData {
  const now = Date.now();
  return {
    comment_text: `Test comment created at ${new Date(now).toISOString()}`,
    is_internal: false,
    ...overrides
  };
}

/**
 * Create a ticket in the database
 */
export async function createTestTicket(
  db: Knex,
  tenant: string,
  data: Partial<TicketTestData> = {}
): Promise<any> {
  // Generate a unique ticket number using timestamp and random string
  const timestamp = Date.now();
  const randomStr = Math.random().toString(36).substring(2, 8);
  const ticketNumber = `T-${timestamp}-${randomStr}`;

  const ticketData = {
    ticket_id: uuidv4(),
    tenant,
    ticket_number: ticketNumber,
    title: data.title || `Test Ticket ${Date.now()}`,
    url: data.url || null,
    status_id: data.status_id,
    priority_id: data.priority_id,
    assigned_to: data.assigned_to || null,
    company_id: data.company_id,
    contact_name_id: data.contact_name_id || null,
    board_id: data.board_id,
    category_id: data.category_id || null,
    subcategory_id: data.subcategory_id || null,
    attributes: data.attributes || (data.description ? { description: data.description } : null),
    entered_by: data.assigned_to || uuidv4(),
    entered_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    updated_by: null,
    closed_by: null,
    closed_at: null
  };

  const [ticket] = await db('tickets').insert(ticketData).returning('*');
  
  // Tags are now handled through tag_definitions and tag_mappings tables
  // Skip tag insertion for now as it requires more complex logic

  return ticket;
}

/**
 * Create multiple test tickets
 */
export async function createTestTickets(
  db: Knex,
  tenant: string,
  count: number,
  defaults: Partial<TicketTestData> = {}
): Promise<any[]> {
  const tickets = [];
  for (let i = 0; i < count; i++) {
    const ticket = await createTestTicket(db, tenant, {
      ...defaults,
      title: `Test Ticket ${i + 1} - ${Date.now()}`
    });
    tickets.push(ticket);
  }
  return tickets;
}

/**
 * Create a test ticket set with various statuses and priorities
 */
export async function createTestTicketSet(
  db: Knex,
  tenant: string,
  companyId: string,
  statusIds: { open: string; inProgress: string; closed: string },
  priorityIds: { low: string; medium: string; high: string },
  boardId: string
): Promise<any[]> {
  const tickets = [];

  // Create tickets with different statuses
  tickets.push(await createTestTicket(db, tenant, {
    title: 'Open High Priority Ticket',
    board_id: boardId,
    status_id: statusIds.open,
    priority_id: priorityIds.high,
    company_id: companyId,
    tags: ['urgent', 'customer-issue']
  }));

  tickets.push(await createTestTicket(db, tenant, {
    title: 'In Progress Medium Priority Ticket',
    board_id: boardId,
    status_id: statusIds.inProgress,
    priority_id: priorityIds.medium,
    company_id: companyId,
    tags: ['in-progress', 'feature-request']
  }));

  tickets.push(await createTestTicket(db, tenant, {
    title: 'Closed Low Priority Ticket',
    board_id: boardId,
    status_id: statusIds.closed,
    priority_id: priorityIds.low,
    company_id: companyId,
    tags: ['resolved', 'maintenance']
  }));

  // Create overdue ticket
  tickets.push(await createTestTicket(db, tenant, {
    title: 'Overdue Ticket',
    board_id: boardId,
    status_id: statusIds.open,
    priority_id: priorityIds.high,
    company_id: companyId,
    attributes: { 
      description: 'This ticket is overdue',
      due_date: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString() // Yesterday
    },
    tags: ['overdue', 'critical']
  }));

  // Create scheduled ticket
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  tickets.push(await createTestTicket(db, tenant, {
    title: 'Scheduled Maintenance',
    board_id: boardId,
    status_id: statusIds.open,
    priority_id: priorityIds.medium,
    company_id: companyId,
    attributes: {
      description: 'Scheduled maintenance task',
      scheduled_start: tomorrow.toISOString(),
      scheduled_end: new Date(tomorrow.getTime() + 2 * 60 * 60 * 1000).toISOString() // 2 hours later
    },
    tags: ['scheduled', 'maintenance']
  }));

  return tickets;
}

/**
 * Create tickets for pagination testing
 */
export async function createTicketsForPagination(
  db: Knex,
  tenant: string,
  companyId: string,
  boardId: string,
  count: number = 30
): Promise<any[]> {
  const tickets = [];
  const baseTime = Date.now();

  for (let i = 0; i < count; i++) {
    const ticket = await createTestTicket(db, tenant, {
      title: `Pagination Test Ticket ${i + 1}`,
      board_id: boardId,
      company_id: companyId,
      description: `Ticket for pagination testing - item ${i + 1} of ${count}`,
      tags: ['pagination-test'],
      // Stagger creation times for consistent ordering - store as component in attributes
      attributes: { creation_order: i }
    });
    tickets.push(ticket);
  }

  return tickets;
}

/**
 * Create a ticket comment in the database
 */
export async function createTestTicketComment(
  db: Knex,
  tenant: string,
  ticketId: string,
  userId: string,
  data: Partial<TicketCommentTestData> = {}
): Promise<any> {
  const commentData = {
    comment_id: uuidv4(),
    ticket_id: ticketId,
    tenant,
    user_id: userId,
    note: data.comment_text || `Test comment at ${new Date().toISOString()}`,
    is_internal: data.is_internal || false,
    is_resolution: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  const [comment] = await db('comments').insert(commentData).returning('*');
  return comment;
}