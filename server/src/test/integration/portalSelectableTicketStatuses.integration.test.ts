import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import path from 'node:path';
import { createRequire } from 'node:module';
import { v4 as uuidv4 } from 'uuid';

import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import Status from '@alga-psa/tickets/models/status';
import { saveBoardTicketStatusesForBoard } from '@alga-psa/tickets/actions/board-actions/boardTicketStatusActions';

const require = createRequire(import.meta.url);
const HOOK_TIMEOUT = 240_000;
const portalSelectableMigration = require(
  path.resolve(process.cwd(), 'migrations', '20260912120000_add_portal_selectable_to_statuses.cjs')
);

const TEST_DB_NAME = process.env.TEST_DB_NAME || 'portal_selectable_test_db';

type ColumnInfoMap = Record<string, unknown>;

type Fixture = {
  tenantId: string;
  userId: string;
  boardId: string;
  openStatusId: string;
};

let db: Knex;
const tenantsToCleanup = new Set<string>();
let tenantColumns: ColumnInfoMap;
let userColumns: ColumnInfoMap;
let boardColumns: ColumnInfoMap;
let statusColumns: ColumnInfoMap;

function hasColumn(columns: ColumnInfoMap, columnName: string): boolean {
  return Object.prototype.hasOwnProperty.call(columns, columnName);
}

function tenantTable(tenantId: string, table: string) {
  return tenantDb(db, tenantId).table(table);
}

function schemaColumnInfo(table: string) {
  return tenantDb(db, '__test_schema__')
    .unscoped(table, 'columnInfo reads schema metadata, not tenant rows')
    .columnInfo();
}

class IntentionalRollback extends Error {}

async function createFixture(conn: Knex = db): Promise<Fixture> {
  const tenantId = uuidv4();
  const userId = uuidv4();
  const boardId = uuidv4();
  const openStatusId = uuidv4();
  tenantsToCleanup.add(tenantId);

  await conn('tenants').insert({
    tenant: tenantId,
    ...(hasColumn(tenantColumns, 'company_name')
      ? { company_name: `Portal Selectable ${tenantId.slice(0, 8)}` }
      : { client_name: `Portal Selectable ${tenantId.slice(0, 8)}` }),
    email: `tenant-${tenantId.slice(0, 8)}@example.com`,
    ...(hasColumn(tenantColumns, 'created_at') ? { created_at: db.fn.now() } : {}),
    ...(hasColumn(tenantColumns, 'updated_at') ? { updated_at: db.fn.now() } : {}),
  });

  await conn('users').insert({
    tenant: tenantId,
    user_id: userId,
    username: `user-${tenantId.slice(0, 8)}`,
    hashed_password: 'not-used',
    ...(hasColumn(userColumns, 'email') ? { email: `user-${tenantId.slice(0, 8)}@example.com` } : {}),
    ...(hasColumn(userColumns, 'created_at') ? { created_at: db.fn.now() } : {}),
    ...(hasColumn(userColumns, 'updated_at') ? { updated_at: db.fn.now() } : {}),
  });

  await conn('boards').insert({
    tenant: tenantId,
    board_id: boardId,
    board_name: 'Portal Status Board',
    ...(hasColumn(boardColumns, 'display_order') ? { display_order: 10 } : {}),
    ...(hasColumn(boardColumns, 'is_default') ? { is_default: true } : {}),
    ...(hasColumn(boardColumns, 'is_inactive') ? { is_inactive: false } : {}),
    ...(hasColumn(boardColumns, 'category_type') ? { category_type: 'custom' } : {}),
    ...(hasColumn(boardColumns, 'priority_type') ? { priority_type: 'custom' } : {}),
    ...(hasColumn(boardColumns, 'created_at') ? { created_at: db.fn.now() } : {}),
    ...(hasColumn(boardColumns, 'updated_at') ? { updated_at: db.fn.now() } : {}),
  });

  await conn('statuses').insert({
    tenant: tenantId,
    status_id: openStatusId,
    ...(hasColumn(statusColumns, 'board_id') ? { board_id: boardId } : {}),
    name: 'Open',
    ...(hasColumn(statusColumns, 'status_type') ? { status_type: 'ticket' } : {}),
    ...(hasColumn(statusColumns, 'item_type') ? { item_type: 'ticket' } : {}),
    is_closed: false,
    is_default: true,
    order_number: 10,
    created_by: userId,
    ...(hasColumn(statusColumns, 'is_custom') ? { is_custom: true } : {}),
    ...(hasColumn(statusColumns, 'created_at') ? { created_at: db.fn.now() } : {}),
    ...(hasColumn(statusColumns, 'updated_at') ? { updated_at: db.fn.now() } : {}),
  });

  return { tenantId, userId, boardId, openStatusId };
}

async function cleanupTenant(tenantId: string): Promise<void> {
  await tenantTable(tenantId, 'statuses').del();
  await tenantTable(tenantId, 'boards').del();
  await tenantTable(tenantId, 'users').del();
  await tenantDb(db, tenantId)
    .unscoped('tenants', 'test fixture creates and removes tenant rows')
    .where({ tenant: tenantId })
    .del();
}

describe('portal_selectable ticket statuses – DB integration', () => {
  beforeAll(async () => {
    process.env.APP_ENV = process.env.APP_ENV || 'test';
    process.env.DB_PORT = process.env.DB_PORT || '5472';
    db = await createTestDbConnection({ databaseName: TEST_DB_NAME, runSeeds: false });
    tenantColumns = await schemaColumnInfo('tenants');
    userColumns = await schemaColumnInfo('users');
    boardColumns = await schemaColumnInfo('boards');
    statusColumns = await schemaColumnInfo('statuses');
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

  it('T008: migration adds portal_selectable NOT NULL default true and backfills pre-existing rows', async () => {
    expect(await db.schema.hasColumn('statuses', 'portal_selectable')).toBe(true);

    const metadata = await db.raw(
      "select is_nullable, column_default from information_schema.columns where table_name = 'statuses' and column_name = 'portal_selectable'"
    );
    expect(metadata.rows[0]?.is_nullable).toBe('NO');
    expect(String(metadata.rows[0]?.column_default)).toContain('true');

    let observed: unknown;
    await expect(
      db.transaction(async (trx) => {
        const fixture = await createFixture(trx);

        // Simulate the pre-migration schema: the column does not exist yet.
        await trx.schema.alterTable('statuses', (table) => {
          table.dropColumn('portal_selectable');
        });

        // A row that predates the migration must survive the ADD COLUMN and
        // come back as selectable via the uniform column default.
        await portalSelectableMigration.up(trx);

        const row = await trx('statuses')
          .where({ status_id: fixture.openStatusId })
          .first('portal_selectable');
        observed = row?.portal_selectable;

        throw new IntentionalRollback();
      })
    ).rejects.toBeInstanceOf(IntentionalRollback);

    expect(observed).toBe(true);
  }, HOOK_TIMEOUT);

  it('T009: saving a board status with portal_selectable false persists and reads back false', async () => {
    const fixture = await createFixture();

    await db.transaction(async (trx) => {
      await saveBoardTicketStatusesForBoard(trx, fixture.tenantId, fixture.boardId, fixture.userId, [
        { status_id: fixture.openStatusId, name: 'Open', is_closed: false, is_default: true, portal_selectable: true },
        { name: 'Waiting on Vendor', is_closed: false, is_default: false, portal_selectable: false },
      ]);

      const statuses = await Status.getTicketStatusesByBoard(trx, fixture.tenantId, fixture.boardId);
      const waiting = statuses.find((status) => status.name === 'Waiting on Vendor');

      expect(waiting?.portal_selectable).toBe(false);
      expect(statuses.find((status) => status.status_id === fixture.openStatusId)?.portal_selectable).toBe(true);
    });
  }, HOOK_TIMEOUT);

  it('T010: creating a board status without an explicit flag defaults to selectable', async () => {
    const fixture = await createFixture();

    await db.transaction(async (trx) => {
      await saveBoardTicketStatusesForBoard(trx, fixture.tenantId, fixture.boardId, fixture.userId, [
        { status_id: fixture.openStatusId, name: 'Open', is_closed: false, is_default: true },
        { name: 'New Status', is_closed: false, is_default: false },
      ]);

      const statuses = await Status.getTicketStatusesByBoard(trx, fixture.tenantId, fixture.boardId);
      const created = statuses.find((status) => status.name === 'New Status');

      expect(created?.portal_selectable).toBe(true);
    });
  }, HOOK_TIMEOUT);
});
