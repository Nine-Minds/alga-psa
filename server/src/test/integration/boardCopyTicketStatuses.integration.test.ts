import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { copyBoardTicketStatuses } from '../../../../packages/tickets/src/actions/board-actions/boardActions';

vi.mock('@alga-psa/sla', () => ({
  configureItilSlaForBoard: vi.fn(),
}));

const HOOK_TIMEOUT = 180_000;

type ColumnInfoMap = Record<string, unknown>;

let db: Knex;
const tenantsToCleanup = new Set<string>();
let tenantColumns: ColumnInfoMap;
let userColumns: ColumnInfoMap;
let boardColumns: ColumnInfoMap;
let statusColumns: ColumnInfoMap;

function hasColumn(columns: ColumnInfoMap, columnName: string): boolean {
  return Object.prototype.hasOwnProperty.call(columns, columnName);
}

async function cleanupTenant(tenantId: string): Promise<void> {
  await db('statuses').where({ tenant: tenantId }).del();
  await db('boards').where({ tenant: tenantId }).del();
  await db('users').where({ tenant: tenantId }).del();
  await db('tenants').where({ tenant: tenantId }).del();
}

async function createFixture() {
  const tenantId = uuidv4();
  const userId = uuidv4();
  const sourceBoardId = uuidv4();
  const targetBoardId = uuidv4();
  const sourceStatusIds = [uuidv4(), uuidv4()];

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
      board_id: sourceBoardId,
      board_name: 'Source Board',
      ...(hasColumn(boardColumns, 'description') ? { description: 'Source' } : {}),
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
      board_id: targetBoardId,
      board_name: 'Target Board',
      ...(hasColumn(boardColumns, 'description') ? { description: 'Target' } : {}),
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

  await db('statuses').insert([
    {
      tenant: tenantId,
      status_id: sourceStatusIds[0],
      ...(hasColumn(statusColumns, 'board_id') ? { board_id: sourceBoardId } : {}),
      name: 'Queued',
      ...(hasColumn(statusColumns, 'status_type') ? { status_type: 'ticket' } : {}),
      ...(hasColumn(statusColumns, 'item_type') ? { item_type: 'ticket' } : {}),
      is_closed: false,
      is_default: true,
      order_number: 10,
      created_by: userId,
      ...(hasColumn(statusColumns, 'is_custom') ? { is_custom: true } : {}),
      ...(hasColumn(statusColumns, 'standard_status_id') ? { standard_status_id: null } : {}),
      ...(hasColumn(statusColumns, 'color') ? { color: '#2563EB' } : {}),
      ...(hasColumn(statusColumns, 'icon') ? { icon: 'PlayCircle' } : {}),
      ...(hasColumn(statusColumns, 'created_at') ? { created_at: db.fn.now() } : {}),
      ...(hasColumn(statusColumns, 'updated_at') ? { updated_at: db.fn.now() } : {}),
    },
    {
      tenant: tenantId,
      status_id: sourceStatusIds[1],
      ...(hasColumn(statusColumns, 'board_id') ? { board_id: sourceBoardId } : {}),
      name: 'Done',
      ...(hasColumn(statusColumns, 'status_type') ? { status_type: 'ticket' } : {}),
      ...(hasColumn(statusColumns, 'item_type') ? { item_type: 'ticket' } : {}),
      is_closed: true,
      is_default: false,
      order_number: 20,
      created_by: userId,
      ...(hasColumn(statusColumns, 'is_custom') ? { is_custom: true } : {}),
      ...(hasColumn(statusColumns, 'standard_status_id') ? { standard_status_id: null } : {}),
      ...(hasColumn(statusColumns, 'color') ? { color: '#16A34A' } : {}),
      ...(hasColumn(statusColumns, 'icon') ? { icon: 'CheckCircle2' } : {}),
      ...(hasColumn(statusColumns, 'created_at') ? { created_at: db.fn.now() } : {}),
      ...(hasColumn(statusColumns, 'updated_at') ? { updated_at: db.fn.now() } : {}),
    },
  ]);

  return { tenantId, userId, sourceBoardId, targetBoardId, sourceStatusIds };
}

describe('board ticket status copy integration', () => {
  beforeAll(async () => {
    process.env.APP_ENV = process.env.APP_ENV || 'test';
    process.env.DB_PORT = process.env.DB_PORT || '5432';
    db = await createTestDbConnection({ runSeeds: false });
    tenantColumns = await db('tenants').columnInfo();
    userColumns = await db('users').columnInfo();
    boardColumns = await db('boards').columnInfo();
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

  it('copies ticket statuses from a source board into a new board with fresh ids and preserved metadata', async () => {
    const fixture = await createFixture();

    const insertedCount = await db.transaction(async (trx) => (
      copyBoardTicketStatuses(
        trx,
        fixture.tenantId,
        fixture.sourceBoardId,
        fixture.targetBoardId,
        fixture.userId
      )
    ));

    expect(insertedCount).toBe(2);

    const copiedStatuses = await db('statuses')
      .where({
        tenant: fixture.tenantId,
        board_id: fixture.targetBoardId,
        status_type: 'ticket'
      })
      .orderBy('order_number', 'asc')
      .select(
        'status_id',
        'name',
        'is_closed',
        'is_default',
        'order_number',
        'created_by',
        ...(hasColumn(statusColumns, 'color') ? ['color'] : []),
        ...(hasColumn(statusColumns, 'icon') ? ['icon'] : [])
      );

    expect(copiedStatuses).toHaveLength(2);
    expect(copiedStatuses.map((status) => status.status_id)).not.toEqual(fixture.sourceStatusIds);
    expect(copiedStatuses.map((status) => status.name)).toEqual(['Queued', 'Done']);
    expect(copiedStatuses.map((status) => status.order_number)).toEqual([10, 20]);
    expect(copiedStatuses.map((status) => status.is_default)).toEqual([true, false]);
    expect(copiedStatuses.map((status) => status.is_closed)).toEqual([false, true]);
    expect(copiedStatuses.every((status) => status.created_by === fixture.userId)).toBe(true);

    if (hasColumn(statusColumns, 'color')) {
      expect(copiedStatuses.map((status) => status.color)).toEqual(['#2563EB', '#16A34A']);
    }
    if (hasColumn(statusColumns, 'icon')) {
      expect(copiedStatuses.map((status) => status.icon)).toEqual(['PlayCircle', 'CheckCircle2']);
    }
  }, HOOK_TIMEOUT);
});
