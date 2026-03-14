import { afterAll, beforeAll, afterEach, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import path from 'node:path';
import { createRequire } from 'node:module';
import { v4 as uuidv4 } from 'uuid';

import { createTestDbConnection } from '../../../test-utils/dbConfig';

const require = createRequire(import.meta.url);
const HOOK_TIMEOUT = 180_000;
const migration = require(path.resolve(process.cwd(), 'migrations', '20260314113000_clone_global_ticket_statuses_to_boards.cjs'));

let db: Knex;
const tenantsToCleanup = new Set<string>();

type LegacyFixture = {
  tenantId: string;
  boardIds: [string, string];
  legacyStatuses: Array<Record<string, unknown> & { status_id: string }>;
  tickets: Array<{
    ticket_id: string;
    board_id: string;
    original_status_id: string;
  }>;
};

type ColumnInfoMap = Record<string, unknown>;

let tenantColumns: ColumnInfoMap;
let userColumns: ColumnInfoMap;
let boardColumns: ColumnInfoMap;
let clientColumns: ColumnInfoMap;
let ticketColumns: ColumnInfoMap;
let statusColumns: ColumnInfoMap;

function hasColumn(columns: ColumnInfoMap, columnName: string): boolean {
  return Object.prototype.hasOwnProperty.call(columns, columnName);
}

function projectComparableStatus(status: Record<string, unknown>) {
  return {
    name: status.name,
    order_number: status.order_number,
    is_default: status.is_default,
    is_closed: status.is_closed,
    ...(hasColumn(statusColumns, 'color') ? { color: status.color ?? null } : {}),
    ...(hasColumn(statusColumns, 'icon') ? { icon: status.icon ?? null } : {}),
    ...(hasColumn(statusColumns, 'standard_status_id')
      ? { standard_status_id: status.standard_status_id ?? null }
      : {}),
    ...(hasColumn(statusColumns, 'item_type') ? { item_type: status.item_type } : {}),
    ...(hasColumn(statusColumns, 'status_type') ? { status_type: status.status_type } : {}),
    ...(hasColumn(statusColumns, 'is_custom') ? { is_custom: status.is_custom } : {}),
    created_by: status.created_by,
  };
}

async function cleanupTenant(tenantId: string): Promise<void> {
  await db('tickets').where({ tenant: tenantId }).del();
  await db('statuses').where({ tenant: tenantId }).del();
  await db('boards').where({ tenant: tenantId }).del();
  await db('clients').where({ tenant: tenantId }).del();
  await db('users').where({ tenant: tenantId }).del();
  await db('tenants').where({ tenant: tenantId }).del();
}

async function createLegacyFixture(): Promise<LegacyFixture> {
  const tenantId = uuidv4();
  const userId = uuidv4();
  const boardA = uuidv4();
  const boardB = uuidv4();
  const clientId = uuidv4();
  const legacyOpenStatusId = uuidv4();
  const legacyClosedStatusId = uuidv4();

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

  await db('boards').insert([
    {
      tenant: tenantId,
      board_id: boardA,
      board_name: 'Support',
      ...(hasColumn(boardColumns, 'description') ? { description: 'Primary support board' } : {}),
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
      board_id: boardB,
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

  await db('clients').insert({
    tenant: tenantId,
    client_id: clientId,
    client_name: `Client ${tenantId.slice(0, 8)}`,
    ...(hasColumn(clientColumns, 'created_at') ? { created_at: db.fn.now() } : {}),
    ...(hasColumn(clientColumns, 'updated_at') ? { updated_at: db.fn.now() } : {}),
    ...(hasColumn(clientColumns, 'is_inactive') ? { is_inactive: false } : {}),
    ...(hasColumn(clientColumns, 'billing_cycle') ? { billing_cycle: 'monthly' } : {}),
    ...(hasColumn(clientColumns, 'is_tax_exempt') ? { is_tax_exempt: false } : {}),
  });

  const legacyStatuses = [
    {
      tenant: tenantId,
      status_id: legacyOpenStatusId,
      ...(hasColumn(statusColumns, 'board_id') ? { board_id: null } : {}),
      name: 'Open',
      ...(hasColumn(statusColumns, 'status_type') ? { status_type: 'ticket' } : {}),
      ...(hasColumn(statusColumns, 'item_type') ? { item_type: 'ticket' } : {}),
      is_closed: false,
      is_default: true,
      order_number: 10,
      created_by: userId,
      ...(hasColumn(statusColumns, 'standard_status_id') ? { standard_status_id: null } : {}),
      ...(hasColumn(statusColumns, 'is_custom') ? { is_custom: true } : {}),
      ...(hasColumn(statusColumns, 'color') ? { color: '#22C55E' } : {}),
      ...(hasColumn(statusColumns, 'icon') ? { icon: 'Circle' } : {}),
      ...(hasColumn(statusColumns, 'created_at')
        ? { created_at: new Date('2026-03-10T12:00:00.000Z') }
        : {}),
      ...(hasColumn(statusColumns, 'updated_at')
        ? { updated_at: new Date('2026-03-10T12:00:00.000Z') }
        : {}),
    },
    {
      tenant: tenantId,
      status_id: legacyClosedStatusId,
      ...(hasColumn(statusColumns, 'board_id') ? { board_id: null } : {}),
      name: 'Closed',
      ...(hasColumn(statusColumns, 'status_type') ? { status_type: 'ticket' } : {}),
      ...(hasColumn(statusColumns, 'item_type') ? { item_type: 'ticket' } : {}),
      is_closed: true,
      is_default: false,
      order_number: 20,
      created_by: userId,
      ...(hasColumn(statusColumns, 'standard_status_id') ? { standard_status_id: null } : {}),
      ...(hasColumn(statusColumns, 'is_custom') ? { is_custom: true } : {}),
      ...(hasColumn(statusColumns, 'color') ? { color: '#64748B' } : {}),
      ...(hasColumn(statusColumns, 'icon') ? { icon: 'CheckCircle2' } : {}),
      ...(hasColumn(statusColumns, 'created_at')
        ? { created_at: new Date('2026-03-10T12:05:00.000Z') }
        : {}),
      ...(hasColumn(statusColumns, 'updated_at')
        ? { updated_at: new Date('2026-03-10T12:05:00.000Z') }
        : {}),
    },
  ];

  await db('statuses').insert(legacyStatuses);

  const tickets = [
    {
      tenant: tenantId,
      ticket_id: uuidv4(),
      ticket_number: `T-${tenantId.slice(0, 6)}-001`,
      title: 'Support ticket',
      board_id: boardA,
      client_id: clientId,
      status_id: legacyOpenStatusId,
      ...(hasColumn(ticketColumns, 'entered_at') ? { entered_at: db.fn.now() } : {}),
      ...(hasColumn(ticketColumns, 'updated_at') ? { updated_at: db.fn.now() } : {}),
    },
    {
      tenant: tenantId,
      ticket_id: uuidv4(),
      ticket_number: `T-${tenantId.slice(0, 6)}-002`,
      title: 'Billing ticket',
      board_id: boardB,
      client_id: clientId,
      status_id: legacyOpenStatusId,
      ...(hasColumn(ticketColumns, 'entered_at') ? { entered_at: db.fn.now() } : {}),
      ...(hasColumn(ticketColumns, 'updated_at') ? { updated_at: db.fn.now() } : {}),
    },
  ];

  await db('tickets').insert(tickets);

  return {
    tenantId,
    boardIds: [boardA, boardB],
    legacyStatuses: legacyStatuses.map((status) => ({
      status_id: status.status_id,
      ...projectComparableStatus(status),
    })),
    tickets: tickets.map((ticket) => ({
      ticket_id: ticket.ticket_id,
      board_id: ticket.board_id,
      original_status_id: ticket.status_id,
    })),
  };
}

async function runMigrationForFixture(): Promise<LegacyFixture> {
  const fixture = await createLegacyFixture();
  await migration.up(db);
  return fixture;
}

describe('Board-specific ticket statuses migration – DB integration', () => {
  beforeAll(async () => {
    process.env.APP_ENV = process.env.APP_ENV || 'test';
    process.env.DB_PORT = process.env.DB_PORT || '5432';
    db = await createTestDbConnection({ runSeeds: false });
    tenantColumns = await db('tenants').columnInfo();
    userColumns = await db('users').columnInfo();
    boardColumns = await db('boards').columnInfo();
    clientColumns = await db('clients').columnInfo();
    ticketColumns = await db('tickets').columnInfo();
    statusColumns = await db('statuses').columnInfo();
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

  it('T003: clones every legacy tenant ticket status to every board and preserves metadata', async () => {
    const fixture = await runMigrationForFixture();

    const clonedStatuses = await db('statuses')
      .where({ tenant: fixture.tenantId, status_type: 'ticket' })
      .whereNotNull('board_id')
      .orderBy('board_id', 'asc')
      .orderBy('order_number', 'asc');

    expect(clonedStatuses).toHaveLength(fixture.legacyStatuses.length * fixture.boardIds.length);

    for (const boardId of fixture.boardIds) {
      const boardClones = clonedStatuses.filter((status) => status.board_id === boardId);
      expect(boardClones).toHaveLength(fixture.legacyStatuses.length);

      const projectedBoardClones = boardClones.map((status) => projectComparableStatus(status));

      expect(projectedBoardClones).toEqual(fixture.legacyStatuses);
    }
  }, HOOK_TIMEOUT);

  it('T004: cloned board-owned statuses receive fresh ids while preserving board-local ordering and default semantics', async () => {
    const fixture = await runMigrationForFixture();

    const legacyStatusIds = new Set(fixture.legacyStatuses.map((status) => status.status_id));
    const clonedStatuses = await db('statuses')
      .where({ tenant: fixture.tenantId, status_type: 'ticket' })
      .whereNotNull('board_id')
      .select('status_id', 'board_id', 'name', 'order_number', 'is_default', 'is_closed')
      .orderBy('board_id', 'asc')
      .orderBy('order_number', 'asc');

    expect(clonedStatuses.every((status) => !legacyStatusIds.has(status.status_id))).toBe(true);

    for (const boardId of fixture.boardIds) {
      const boardClones = clonedStatuses.filter((status) => status.board_id === boardId);
      expect(boardClones.map((status) => status.name)).toEqual(['Open', 'Closed']);
      expect(boardClones.map((status) => status.order_number)).toEqual([10, 20]);
      expect(boardClones.map((status) => status.is_default)).toEqual([true, false]);
      expect(boardClones.map((status) => status.is_closed)).toEqual([false, true]);
    }
  }, HOOK_TIMEOUT);

  it('T005: remap logic resolves the old global status id to a different board-owned replacement per board', async () => {
    const fixture = await runMigrationForFixture();

    const [boardA, boardB] = fixture.boardIds;
    const legacyOpenStatusId = fixture.legacyStatuses.find((status) => status.name === 'Open')?.status_id;
    expect(legacyOpenStatusId).toBeTruthy();

    const boardAOpen = await db('statuses')
      .where({
        tenant: fixture.tenantId,
        board_id: boardA,
        name: 'Open',
      })
      .first();
    const boardBOpen = await db('statuses')
      .where({
        tenant: fixture.tenantId,
        board_id: boardB,
        name: 'Open',
      })
      .first();

    expect(boardAOpen?.status_id).toBeTruthy();
    expect(boardBOpen?.status_id).toBeTruthy();
    expect(boardAOpen?.status_id).not.toBe(legacyOpenStatusId);
    expect(boardBOpen?.status_id).not.toBe(legacyOpenStatusId);
    expect(boardAOpen?.status_id).not.toBe(boardBOpen?.status_id);
  }, HOOK_TIMEOUT);

  it('T006: ticket rows are rewritten to the cloned board-owned status for their current board', async () => {
    const fixture = await runMigrationForFixture();

    const migratedTickets = await db('tickets')
      .where({ tenant: fixture.tenantId })
      .select('ticket_id', 'board_id', 'status_id')
      .orderBy('ticket_number', 'asc');

    expect(migratedTickets).toHaveLength(2);

    for (const ticket of migratedTickets) {
      const originalTicket = fixture.tickets.find((candidate) => candidate.ticket_id === ticket.ticket_id);
      expect(originalTicket).toBeTruthy();
      expect(ticket.status_id).not.toBe(originalTicket?.original_status_id);

      const clonedStatus = await db('statuses')
        .where({
          tenant: fixture.tenantId,
          board_id: ticket.board_id,
          status_id: ticket.status_id,
        })
        .first();

      expect(clonedStatus?.name).toBe('Open');
      expect(clonedStatus?.board_id).toBe(ticket.board_id);
    }
  }, HOOK_TIMEOUT);
});
