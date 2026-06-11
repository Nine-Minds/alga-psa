import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

/**
 * Shared fixture for the ticket close rules / checklists / auto-close tests:
 * a board with one default open status, a second open status, a closed
 * status, a priority, a client + contact, and a ticket factory. Everything is
 * created inside the dev-seeded tenant so seeded users/permissions apply.
 */

export interface CloseRulesFixture {
  tenantId: string;
  userId: string;
  boardId: string;
  openStatusId: string;
  waitingStatusId: string;
  closedStatusId: string;
  priorityId: string;
  clientId: string;
  contactId: string;
}

export async function createCloseRulesFixture(
  db: Knex,
  tenantId: string,
  userId: string
): Promise<CloseRulesFixture> {
  const boardId = uuidv4();
  const openStatusId = uuidv4();
  const waitingStatusId = uuidv4();
  const closedStatusId = uuidv4();
  const priorityId = uuidv4();
  const clientId = uuidv4();
  const contactId = uuidv4();
  const suffix = boardId.slice(0, 8);

  await db('boards').insert({
    tenant: tenantId,
    board_id: boardId,
    board_name: `Close Rules Board ${suffix}`,
    is_default: false,
    is_inactive: false,
    display_order: 999,
  });

  await db('priorities').insert({
    tenant: tenantId,
    priority_id: priorityId,
    priority_name: `Close Rules Priority ${suffix}`,
    item_type: 'ticket',
    color: '#3B82F6',
    order_number: 99,
    created_by: userId,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });

  await db('statuses').insert([
    {
      tenant: tenantId,
      status_id: openStatusId,
      board_id: boardId,
      name: 'Open',
      status_type: 'ticket',
      is_closed: false,
      is_default: true,
      order_number: 10,
      created_by: userId,
    },
    {
      tenant: tenantId,
      status_id: waitingStatusId,
      board_id: boardId,
      name: 'Waiting for Customer',
      status_type: 'ticket',
      is_closed: false,
      is_default: false,
      order_number: 20,
      created_by: userId,
    },
    {
      tenant: tenantId,
      status_id: closedStatusId,
      board_id: boardId,
      name: 'Closed',
      status_type: 'ticket',
      is_closed: true,
      is_default: false,
      order_number: 30,
      created_by: userId,
    },
  ]);

  await db('clients').insert({
    tenant: tenantId,
    client_id: clientId,
    client_name: `Close Rules Client ${suffix}`,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });

  await db('contacts').insert({
    tenant: tenantId,
    contact_name_id: contactId,
    full_name: `Close Rules Contact ${suffix}`,
    client_id: clientId,
    email: `close-rules-${suffix}@example.com`,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });

  return {
    tenantId,
    userId,
    boardId,
    openStatusId,
    waitingStatusId,
    closedStatusId,
    priorityId,
    clientId,
    contactId,
  };
}

let ticketCounter = 0;

export async function insertTicket(
  db: Knex,
  fixture: CloseRulesFixture,
  overrides: Partial<Record<string, unknown>> = {}
): Promise<string> {
  const ticketId = uuidv4();
  ticketCounter += 1;
  await db('tickets').insert({
    tenant: fixture.tenantId,
    ticket_id: ticketId,
    ticket_number: `CR-${Date.now()}-${ticketCounter}`,
    title: `Close rules test ticket ${ticketCounter}`,
    client_id: fixture.clientId,
    contact_name_id: fixture.contactId,
    board_id: fixture.boardId,
    status_id: fixture.openStatusId,
    priority_id: fixture.priorityId,
    entered_by: fixture.userId,
    entered_at: db.fn.now(),
    updated_at: db.fn.now(),
    ...overrides,
  });
  return ticketId;
}

export async function setBoardCloseRules(
  db: Knex,
  fixture: CloseRulesFixture,
  rules: Partial<{
    require_resolution_comment: boolean;
    require_time_entry: boolean;
    require_checklist_complete: boolean;
    require_no_open_children: boolean;
    required_fields: string[];
    is_enabled: boolean;
  }>
): Promise<void> {
  const values = {
    require_resolution_comment: rules.require_resolution_comment ?? false,
    require_time_entry: rules.require_time_entry ?? false,
    require_checklist_complete: rules.require_checklist_complete ?? false,
    require_no_open_children: rules.require_no_open_children ?? false,
    required_fields: JSON.stringify(rules.required_fields ?? []),
    is_enabled: rules.is_enabled ?? true,
    updated_at: db.fn.now(),
  };
  await db('board_close_rules')
    .insert({ tenant: fixture.tenantId, board_id: fixture.boardId, ...values })
    .onConflict(['tenant', 'board_id'])
    .merge(values);
}

export async function clearBoardCloseRules(db: Knex, fixture: CloseRulesFixture): Promise<void> {
  await db('board_close_rules')
    .where({ tenant: fixture.tenantId, board_id: fixture.boardId })
    .del();
}

export async function insertChecklistItem(
  db: Knex,
  fixture: CloseRulesFixture,
  ticketId: string,
  overrides: Partial<Record<string, unknown>> = {}
): Promise<string> {
  const itemId = uuidv4();
  await db('ticket_checklist_items').insert({
    tenant: fixture.tenantId,
    checklist_item_id: itemId,
    ticket_id: ticketId,
    item_name: `Checklist item ${itemId.slice(0, 6)}`,
    order_number: 0,
    is_required: true,
    completed: false,
    source: 'manual',
    ...overrides,
  });
  return itemId;
}

export async function insertTicketTimeEntry(
  db: Knex,
  fixture: CloseRulesFixture,
  ticketId: string
): Promise<void> {
  await db('time_entries').insert({
    tenant: fixture.tenantId,
    entry_id: uuidv4(),
    work_item_id: ticketId,
    work_item_type: 'ticket',
    user_id: fixture.userId,
    start_time: db.fn.now(),
    end_time: db.fn.now(),
    work_date: db.fn.now(),
    work_timezone: 'UTC',
    billable_duration: 30,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
}

export async function insertResolutionComment(
  db: Knex,
  fixture: CloseRulesFixture,
  ticketId: string,
  overrides: Partial<Record<string, unknown>> = {}
): Promise<string> {
  // comment_threads.root_comment_id and comments.thread_id are both NOT NULL,
  // so generate the ids up-front like the comment actions do.
  const commentId = uuidv4();
  const threadId = uuidv4();
  const nowIso = new Date().toISOString();

  await db('comment_threads').insert({
    tenant: fixture.tenantId,
    thread_id: threadId,
    ticket_id: ticketId,
    project_task_id: null,
    root_comment_id: commentId,
    is_internal: false,
    reply_count: 0,
    last_activity_at: nowIso,
    created_at: nowIso,
    created_by: fixture.userId,
  });

  await db('comments').insert({
    tenant: fixture.tenantId,
    comment_id: commentId,
    thread_id: threadId,
    ticket_id: ticketId,
    note: 'resolution note',
    is_internal: false,
    is_resolution: true,
    author_type: 'internal',
    user_id: fixture.userId,
    created_at: nowIso,
    ...overrides,
  });
  return commentId;
}

export async function createSecondaryTenant(
  db: Knex
): Promise<{ tenantId: string; userId: string }> {
  const tenantId = uuidv4();
  const userId = uuidv4();
  await db('tenants').insert({
    tenant: tenantId,
    client_name: `Close Rules Tenant ${tenantId.slice(0, 8)}`,
    email: `tenant-${tenantId.slice(0, 8)}@example.com`,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
  await db('users').insert({
    tenant: tenantId,
    user_id: userId,
    username: `close-rules-${tenantId.slice(0, 8)}`,
    hashed_password: 'not-used',
    first_name: 'Second',
    last_name: 'Tenant',
    email: `user-${tenantId.slice(0, 8)}@example.com`,
    user_type: 'internal',
    created_at: db.fn.now(),
  });
  return { tenantId, userId };
}
