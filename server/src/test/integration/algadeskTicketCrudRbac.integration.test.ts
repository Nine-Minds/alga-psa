import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { TicketModel } from '@shared/models/ticketModel';

const HOOK_TIMEOUT = 180_000;

type ColumnInfoMap = Record<string, unknown>;

type Fixture = {
  tenantId: string;
  enteredByUserId: string;
  assigneeUserId: string;
  clientId: string;
  contactId: string;
  boardId: string;
  statusOpenId: string;
  statusAwaitingClientId: string;
  categoryId: string;
  priorityId: string;
};

let db: Knex;
const tenantsToCleanup = new Set<string>();
let tenantColumns: ColumnInfoMap;
let userColumns: ColumnInfoMap;
let boardColumns: ColumnInfoMap;
let clientColumns: ColumnInfoMap;
let statusColumns: ColumnInfoMap;
let categoryColumns: ColumnInfoMap;
let priorityColumns: ColumnInfoMap;

function hasColumn(columns: ColumnInfoMap, columnName: string): boolean {
  return Object.prototype.hasOwnProperty.call(columns, columnName);
}

async function cleanupTenant(tenantId: string): Promise<void> {
  await db('tickets').where({ tenant: tenantId }).del();
  await db('next_number').where({ tenant: tenantId }).del();
  await db('categories').where({ tenant: tenantId }).del();
  await db('statuses').where({ tenant: tenantId }).del();
  await db('priorities').where({ tenant: tenantId }).del();
  await db('boards').where({ tenant: tenantId }).del();
  await db('contacts').where({ tenant: tenantId }).del();
  await db('clients').where({ tenant: tenantId }).del();
  await db('users').where({ tenant: tenantId }).del();
  await db('tenants').where({ tenant: tenantId }).del();
}

async function createFixture(): Promise<Fixture> {
  const tenantId = uuidv4();
  const enteredByUserId = uuidv4();
  const assigneeUserId = uuidv4();
  const clientId = uuidv4();
  const contactId = uuidv4();
  const boardId = uuidv4();
  const statusOpenId = uuidv4();
  const statusAwaitingClientId = uuidv4();
  const categoryId = uuidv4();
  const priorityId = uuidv4();

  tenantsToCleanup.add(tenantId);

  await db('tenants').insert({
    tenant: tenantId,
    ...(hasColumn(tenantColumns, 'company_name')
      ? { company_name: `Tenant ${tenantId.slice(0, 8)}` }
      : { client_name: `Tenant ${tenantId.slice(0, 8)}` }),
    email: `tenant-${tenantId.slice(0, 8)}@example.com`,
    ...(hasColumn(tenantColumns, 'product_code') ? { product_code: 'algadesk' } : {}),
    ...(hasColumn(tenantColumns, 'created_at') ? { created_at: db.fn.now() } : {}),
    ...(hasColumn(tenantColumns, 'updated_at') ? { updated_at: db.fn.now() } : {}),
  });

  await db('users').insert([
    {
      tenant: tenantId,
      user_id: enteredByUserId,
      username: `creator-${tenantId.slice(0, 8)}`,
      hashed_password: 'not-used',
      ...(hasColumn(userColumns, 'role') ? { role: 'admin' } : {}),
      ...(hasColumn(userColumns, 'email') ? { email: `creator-${tenantId.slice(0, 8)}@example.com` } : {}),
      ...(hasColumn(userColumns, 'created_at') ? { created_at: db.fn.now() } : {}),
      ...(hasColumn(userColumns, 'updated_at') ? { updated_at: db.fn.now() } : {}),
    },
    {
      tenant: tenantId,
      user_id: assigneeUserId,
      username: `assignee-${tenantId.slice(0, 8)}`,
      hashed_password: 'not-used',
      ...(hasColumn(userColumns, 'role') ? { role: 'technician' } : {}),
      ...(hasColumn(userColumns, 'email') ? { email: `assignee-${tenantId.slice(0, 8)}@example.com` } : {}),
      ...(hasColumn(userColumns, 'created_at') ? { created_at: db.fn.now() } : {}),
      ...(hasColumn(userColumns, 'updated_at') ? { updated_at: db.fn.now() } : {}),
    },
  ]);

  await db('clients').insert({
    tenant: tenantId,
    client_id: clientId,
    client_name: `Client ${tenantId.slice(0, 8)}`,
    ...(hasColumn(clientColumns, 'is_inactive') ? { is_inactive: false } : {}),
    ...(hasColumn(clientColumns, 'billing_cycle') ? { billing_cycle: 'monthly' } : {}),
    ...(hasColumn(clientColumns, 'is_tax_exempt') ? { is_tax_exempt: false } : {}),
    ...(hasColumn(clientColumns, 'created_at') ? { created_at: db.fn.now() } : {}),
    ...(hasColumn(clientColumns, 'updated_at') ? { updated_at: db.fn.now() } : {}),
  });

  await db('contacts').insert({
    tenant: tenantId,
    contact_name_id: contactId,
    client_id: clientId,
    full_name: `Contact ${tenantId.slice(0, 8)}`,
    email: `contact-${tenantId.slice(0, 8)}@example.com`,
    ...(hasColumn(categoryColumns, 'created_at') ? { created_at: db.fn.now() } : {}),
    ...(hasColumn(categoryColumns, 'updated_at') ? { updated_at: db.fn.now() } : {}),
  });

  await db('boards').insert({
    tenant: tenantId,
    board_id: boardId,
    board_name: 'Support',
    ...(hasColumn(boardColumns, 'description') ? { description: 'Support board' } : {}),
    ...(hasColumn(boardColumns, 'display_order') ? { display_order: 10 } : {}),
    ...(hasColumn(boardColumns, 'is_default') ? { is_default: true } : {}),
    ...(hasColumn(boardColumns, 'is_inactive') ? { is_inactive: false } : {}),
    ...(hasColumn(boardColumns, 'is_active') ? { is_active: true } : {}),
    ...(hasColumn(boardColumns, 'category_type') ? { category_type: 'custom' } : {}),
    ...(hasColumn(boardColumns, 'priority_type') ? { priority_type: 'custom' } : {}),
    ...(hasColumn(boardColumns, 'created_at') ? { created_at: db.fn.now() } : {}),
    ...(hasColumn(boardColumns, 'updated_at') ? { updated_at: db.fn.now() } : {}),
  });

  await db('priorities').insert({
    tenant: tenantId,
    priority_id: priorityId,
    priority_name: 'High',
    ...(hasColumn(priorityColumns, 'item_type') ? { item_type: 'ticket' } : {}),
    ...(hasColumn(priorityColumns, 'order_number') ? { order_number: 10 } : {}),
    ...(hasColumn(priorityColumns, 'color') ? { color: '#EF4444' } : {}),
    ...(hasColumn(priorityColumns, 'created_by') ? { created_by: enteredByUserId } : {}),
    ...(hasColumn(priorityColumns, 'updated_by') ? { updated_by: enteredByUserId } : {}),
    ...(hasColumn(priorityColumns, 'created_at') ? { created_at: db.fn.now() } : {}),
    ...(hasColumn(priorityColumns, 'updated_at') ? { updated_at: db.fn.now() } : {}),
  });

  await db('statuses').insert([
    {
      tenant: tenantId,
      status_id: statusOpenId,
      ...(hasColumn(statusColumns, 'board_id') ? { board_id: boardId } : {}),
      name: 'Open',
      ...(hasColumn(statusColumns, 'status_type') ? { status_type: 'ticket' } : {}),
      ...(hasColumn(statusColumns, 'item_type') ? { item_type: 'ticket' } : {}),
      is_closed: false,
      is_default: true,
      order_number: 10,
      created_by: enteredByUserId,
      ...(hasColumn(statusColumns, 'is_custom') ? { is_custom: true } : {}),
      ...(hasColumn(statusColumns, 'standard_status_id') ? { standard_status_id: null } : {}),
      ...(hasColumn(statusColumns, 'created_at') ? { created_at: db.fn.now() } : {}),
      ...(hasColumn(statusColumns, 'updated_at') ? { updated_at: db.fn.now() } : {}),
    },
    {
      tenant: tenantId,
      status_id: statusAwaitingClientId,
      ...(hasColumn(statusColumns, 'board_id') ? { board_id: boardId } : {}),
      name: 'Waiting Client',
      ...(hasColumn(statusColumns, 'status_type') ? { status_type: 'ticket' } : {}),
      ...(hasColumn(statusColumns, 'item_type') ? { item_type: 'ticket' } : {}),
      is_closed: false,
      is_default: false,
      order_number: 20,
      created_by: enteredByUserId,
      ...(hasColumn(statusColumns, 'is_custom') ? { is_custom: true } : {}),
      ...(hasColumn(statusColumns, 'standard_status_id') ? { standard_status_id: null } : {}),
      ...(hasColumn(statusColumns, 'created_at') ? { created_at: db.fn.now() } : {}),
      ...(hasColumn(statusColumns, 'updated_at') ? { updated_at: db.fn.now() } : {}),
    },
  ]);

  await db('categories').insert({
    tenant: tenantId,
    category_id: categoryId,
    category_name: 'General Support',
    board_id: boardId,
    ...(hasColumn(categoryColumns, 'created_by') ? { created_by: enteredByUserId } : {}),
    ...(hasColumn(categoryColumns, 'updated_by') ? { updated_by: enteredByUserId } : {}),
    ...(hasColumn(categoryColumns, 'created_at') ? { created_at: db.fn.now() } : {}),
    ...(hasColumn(categoryColumns, 'updated_at') ? { updated_at: db.fn.now() } : {}),
  });

  return {
    tenantId,
    enteredByUserId,
    assigneeUserId,
    clientId,
    contactId,
    boardId,
    statusOpenId,
    statusAwaitingClientId,
    categoryId,
    priorityId,
  };
}

describe('Algadesk ticket create/update integration', () => {
  beforeAll(async () => {
    process.env.APP_ENV = process.env.APP_ENV || 'test';
    process.env.DB_PORT = process.env.DB_PORT || '5432';
    db = await createTestDbConnection({ runSeeds: false });
    tenantColumns = await db('tenants').columnInfo();
    userColumns = await db('users').columnInfo();
    boardColumns = await db('boards').columnInfo();
    clientColumns = await db('clients').columnInfo();
    statusColumns = await db('statuses').columnInfo();
    categoryColumns = await db('categories').columnInfo();
    priorityColumns = await db('priorities').columnInfo();
  }, HOOK_TIMEOUT);

  afterEach(async () => {
    for (const tenantId of tenantsToCleanup) {
      await cleanupTenant(tenantId);
      tenantsToCleanup.delete(tenantId);
    }
  });

  afterAll(async () => {
    await db?.destroy().catch(() => undefined);
  }, HOOK_TIMEOUT);

  it('T010: Algadesk tenant can create a ticket with assignment/category/priority and update status, while ticket actions keep RBAC checks', async () => {
    const fixture = await createFixture();

    let createdTicketId: string;

    await db.transaction(async (trx) => {
      const created = await TicketModel.createTicket(
        {
          title: 'Algadesk integration ticket',
          description: 'Create and update flow coverage',
          client_id: fixture.clientId,
          board_id: fixture.boardId,
          status_id: fixture.statusOpenId,
          priority_id: fixture.priorityId,
          category_id: fixture.categoryId,
          contact_id: fixture.contactId,
          assigned_to: fixture.assigneeUserId,
          entered_by: fixture.enteredByUserId,
          source: 'web_app',
        },
        fixture.tenantId,
        trx,
      );

      createdTicketId = created.ticket_id;

      await TicketModel.updateTicket(
        created.ticket_id,
        {
          status_id: fixture.statusAwaitingClientId,
        },
        fixture.tenantId,
        trx,
      );
    });

    const persisted = await db('tickets')
      .where({ tenant: fixture.tenantId, ticket_id: createdTicketId! })
      .first();

    expect(persisted).toBeDefined();
    expect(persisted.client_id).toBe(fixture.clientId);
    expect(persisted.contact_name_id).toBe(fixture.contactId);
    expect(persisted.board_id).toBe(fixture.boardId);
    expect(persisted.category_id).toBe(fixture.categoryId);
    expect(persisted.priority_id).toBe(fixture.priorityId);
    expect(persisted.assigned_to).toBe(fixture.assigneeUserId);
    expect(persisted.status_id).toBe(fixture.statusAwaitingClientId);
    expect(persisted.response_state ?? null).toBeNull();

  }, HOOK_TIMEOUT);
});
