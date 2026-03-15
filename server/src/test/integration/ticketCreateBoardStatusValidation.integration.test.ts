import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { TicketModel } from '@shared/models/ticketModel';

const HOOK_TIMEOUT = 180_000;

type ColumnInfoMap = Record<string, unknown>;

type TicketCreateFixture = {
  tenantId: string;
  userId: string;
  clientId: string;
  boardAId: string;
  boardBId: string;
  boardAStatusId: string;
  boardBStatusId: string;
  priorityId: string;
};

let db: Knex;
const tenantsToCleanup = new Set<string>();
let tenantColumns: ColumnInfoMap;
let userColumns: ColumnInfoMap;
let boardColumns: ColumnInfoMap;
let clientColumns: ColumnInfoMap;
let statusColumns: ColumnInfoMap;
let priorityColumns: ColumnInfoMap;

function hasColumn(columns: ColumnInfoMap, columnName: string): boolean {
  return Object.prototype.hasOwnProperty.call(columns, columnName);
}

async function cleanupTenant(tenantId: string): Promise<void> {
  await db('tickets').where({ tenant: tenantId }).del();
  await db('next_number').where({ tenant: tenantId }).del();
  await db('statuses').where({ tenant: tenantId }).del();
  await db('priorities').where({ tenant: tenantId }).del();
  await db('boards').where({ tenant: tenantId }).del();
  await db('clients').where({ tenant: tenantId }).del();
  await db('users').where({ tenant: tenantId }).del();
  await db('tenants').where({ tenant: tenantId }).del();
}

async function createFixture(): Promise<TicketCreateFixture> {
  const tenantId = uuidv4();
  const userId = uuidv4();
  const clientId = uuidv4();
  const boardAId = uuidv4();
  const boardBId = uuidv4();
  const boardAStatusId = uuidv4();
  const boardBStatusId = uuidv4();
  const priorityId = uuidv4();

  tenantsToCleanup.add(tenantId);

  await db('tenants').insert({
    tenant: tenantId,
    ...(hasColumn(tenantColumns, 'company_name')
      ? { company_name: `Tenant ${tenantId.slice(0, 8)}` }
      : { client_name: `Tenant ${tenantId.slice(0, 8)}` }),
    email: `tenant-${tenantId.slice(0, 8)}@example.com`,
    ...(hasColumn(tenantColumns, 'created_at') ? { created_at: db.fn.now() } : {}),
    ...(hasColumn(tenantColumns, 'updated_at') ? { updated_at: db.fn.now() } : {}),
  });

  await db('users').insert({
    tenant: tenantId,
    user_id: userId,
    username: `user-${tenantId.slice(0, 8)}`,
    hashed_password: 'not-used',
    ...(hasColumn(userColumns, 'role') ? { role: 'admin' } : {}),
    ...(hasColumn(userColumns, 'email') ? { email: `user-${tenantId.slice(0, 8)}@example.com` } : {}),
    ...(hasColumn(userColumns, 'created_at') ? { created_at: db.fn.now() } : {}),
    ...(hasColumn(userColumns, 'updated_at') ? { updated_at: db.fn.now() } : {}),
  });

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

  await db('boards').insert([
    {
      tenant: tenantId,
      board_id: boardAId,
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
    },
    {
      tenant: tenantId,
      board_id: boardBId,
      board_name: 'Billing',
      ...(hasColumn(boardColumns, 'description') ? { description: 'Billing board' } : {}),
      ...(hasColumn(boardColumns, 'display_order') ? { display_order: 20 } : {}),
      ...(hasColumn(boardColumns, 'is_default') ? { is_default: false } : {}),
      ...(hasColumn(boardColumns, 'is_inactive') ? { is_inactive: false } : {}),
      ...(hasColumn(boardColumns, 'is_active') ? { is_active: true } : {}),
      ...(hasColumn(boardColumns, 'category_type') ? { category_type: 'custom' } : {}),
      ...(hasColumn(boardColumns, 'priority_type') ? { priority_type: 'custom' } : {}),
      ...(hasColumn(boardColumns, 'created_at') ? { created_at: db.fn.now() } : {}),
      ...(hasColumn(boardColumns, 'updated_at') ? { updated_at: db.fn.now() } : {}),
    },
  ]);

  await db('priorities').insert({
    tenant: tenantId,
    priority_id: priorityId,
    priority_name: 'High',
    ...(hasColumn(priorityColumns, 'item_type') ? { item_type: 'ticket' } : {}),
    ...(hasColumn(priorityColumns, 'order_number') ? { order_number: 10 } : {}),
    ...(hasColumn(priorityColumns, 'color') ? { color: '#EF4444' } : {}),
    ...(hasColumn(priorityColumns, 'created_by') ? { created_by: userId } : {}),
    ...(hasColumn(priorityColumns, 'updated_by') ? { updated_by: userId } : {}),
    ...(hasColumn(priorityColumns, 'created_at') ? { created_at: db.fn.now() } : {}),
    ...(hasColumn(priorityColumns, 'updated_at') ? { updated_at: db.fn.now() } : {}),
  });

  await db('statuses').insert([
    {
      tenant: tenantId,
      status_id: boardAStatusId,
      ...(hasColumn(statusColumns, 'board_id') ? { board_id: boardAId } : {}),
      name: 'Support Open',
      ...(hasColumn(statusColumns, 'status_type') ? { status_type: 'ticket' } : {}),
      ...(hasColumn(statusColumns, 'item_type') ? { item_type: 'ticket' } : {}),
      is_closed: false,
      is_default: true,
      order_number: 10,
      created_by: userId,
      ...(hasColumn(statusColumns, 'is_custom') ? { is_custom: true } : {}),
      ...(hasColumn(statusColumns, 'standard_status_id') ? { standard_status_id: null } : {}),
      ...(hasColumn(statusColumns, 'created_at') ? { created_at: db.fn.now() } : {}),
      ...(hasColumn(statusColumns, 'updated_at') ? { updated_at: db.fn.now() } : {}),
    },
    {
      tenant: tenantId,
      status_id: boardBStatusId,
      ...(hasColumn(statusColumns, 'board_id') ? { board_id: boardBId } : {}),
      name: 'Billing Open',
      ...(hasColumn(statusColumns, 'status_type') ? { status_type: 'ticket' } : {}),
      ...(hasColumn(statusColumns, 'item_type') ? { item_type: 'ticket' } : {}),
      is_closed: false,
      is_default: true,
      order_number: 10,
      created_by: userId,
      ...(hasColumn(statusColumns, 'is_custom') ? { is_custom: true } : {}),
      ...(hasColumn(statusColumns, 'standard_status_id') ? { standard_status_id: null } : {}),
      ...(hasColumn(statusColumns, 'created_at') ? { created_at: db.fn.now() } : {}),
      ...(hasColumn(statusColumns, 'updated_at') ? { updated_at: db.fn.now() } : {}),
    },
  ]);

  return {
    tenantId,
    userId,
    clientId,
    boardAId,
    boardBId,
    boardAStatusId,
    boardBStatusId,
    priorityId,
  };
}

describe('Ticket board/status validation integration', () => {
  beforeAll(async () => {
    process.env.APP_ENV = process.env.APP_ENV || 'test';
    process.env.DB_PORT = process.env.DB_PORT || '5432';
    db = await createTestDbConnection({ runSeeds: false });
    tenantColumns = await db('tenants').columnInfo();
    userColumns = await db('users').columnInfo();
    boardColumns = await db('boards').columnInfo();
    clientColumns = await db('clients').columnInfo();
    statusColumns = await db('statuses').columnInfo();
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

  it('T014: ticket create succeeds with a board-owned status for the selected board and rejects cross-board status ids', async () => {
    const fixture = await createFixture();

    await db.transaction(async (trx) => {
      const created = await TicketModel.createTicket(
        {
          title: 'Valid board-scoped ticket',
          description: 'Created with matching board/status',
          client_id: fixture.clientId,
          board_id: fixture.boardAId,
          status_id: fixture.boardAStatusId,
          priority_id: fixture.priorityId,
          entered_by: fixture.userId,
        },
        fixture.tenantId,
        trx,
      );

      expect(created.status_id).toBe(fixture.boardAStatusId);

      await expect(
        TicketModel.createTicket(
          {
            title: 'Invalid board-scoped ticket',
            description: 'Created with mismatched board/status',
            client_id: fixture.clientId,
            board_id: fixture.boardAId,
            status_id: fixture.boardBStatusId,
            priority_id: fixture.priorityId,
            entered_by: fixture.userId,
          },
          fixture.tenantId,
          trx,
        )
      ).rejects.toThrow('selected status does not belong to the selected board');
    });

    const createdTickets = await db('tickets')
      .where({ tenant: fixture.tenantId })
      .orderBy('ticket_number', 'asc');

    expect(createdTickets).toHaveLength(1);
    expect(createdTickets[0]?.status_id).toBe(fixture.boardAStatusId);
    expect(createdTickets[0]?.board_id).toBe(fixture.boardAId);
  }, HOOK_TIMEOUT);

  it('T016: ticket update rejects incompatible board/status combinations and preserves the prior status on failure', async () => {
    const fixture = await createFixture();
    let ticketId: string | undefined;

    await db.transaction(async (trx) => {
      const created = await TicketModel.createTicket(
        {
          title: 'Ticket to update',
          description: 'Created before invalid update',
          client_id: fixture.clientId,
          board_id: fixture.boardAId,
          status_id: fixture.boardAStatusId,
          priority_id: fixture.priorityId,
          entered_by: fixture.userId,
        },
        fixture.tenantId,
        trx,
      );

      ticketId = created.ticket_id;

      await expect(
        TicketModel.updateTicket(
          created.ticket_id,
          { status_id: fixture.boardBStatusId },
          fixture.tenantId,
          trx,
        )
      ).rejects.toThrow('selected status does not belong to the selected board');
    });

    const persistedTicket = await db('tickets')
      .where({ tenant: fixture.tenantId, ticket_id: ticketId })
      .first('status_id', 'board_id');

    expect(persistedTicket?.status_id).toBe(fixture.boardAStatusId);
    expect(persistedTicket?.board_id).toBe(fixture.boardAId);
  }, HOOK_TIMEOUT);
});
