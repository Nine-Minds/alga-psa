import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { createTestDbConnection } from '../../../test-utils/dbConfig';

const HOOK_TIMEOUT = 180_000;

type ColumnInfoMap = Record<string, unknown>;

let db: Knex;
let tenantColumns: ColumnInfoMap;
let boardColumns: ColumnInfoMap;
const tenantsToCleanup = new Set<string>();

function hasColumn(columns: ColumnInfoMap, columnName: string): boolean {
  return Object.prototype.hasOwnProperty.call(columns, columnName);
}

async function cleanupTenant(tenantId: string): Promise<void> {
  await db('boards').where({ tenant: tenantId }).del();
  await db('tenants').where({ tenant: tenantId }).del();
}

async function createTenant(): Promise<string> {
  const tenantId = uuidv4();
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

  return tenantId;
}

describe('board live ticket timer setting integration', () => {
  beforeAll(async () => {
    process.env.APP_ENV = process.env.APP_ENV || 'test';
    process.env.DB_PORT = process.env.DB_PORT || '5432';
    db = await createTestDbConnection({ runSeeds: false });
    tenantColumns = await db('tenants').columnInfo();
    boardColumns = await db('boards').columnInfo();
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

  it('T001: boards default live timer to enabled and persist explicit disabled updates', async () => {
    expect(hasColumn(boardColumns, 'enable_live_ticket_timer')).toBe(true);

    const tenantId = await createTenant();
    const boardId = uuidv4();

    await db('boards').insert({
      tenant: tenantId,
      board_id: boardId,
      board_name: 'Integration Board',
      ...(hasColumn(boardColumns, 'description') ? { description: 'Board description' } : {}),
      ...(hasColumn(boardColumns, 'display_order') ? { display_order: 10 } : {}),
      ...(hasColumn(boardColumns, 'is_default') ? { is_default: false } : {}),
      ...(hasColumn(boardColumns, 'is_inactive') ? { is_inactive: false } : {}),
      ...(hasColumn(boardColumns, 'category_type') ? { category_type: 'custom' } : {}),
      ...(hasColumn(boardColumns, 'priority_type') ? { priority_type: 'custom' } : {}),
      ...(hasColumn(boardColumns, 'created_at') ? { created_at: db.fn.now() } : {}),
      ...(hasColumn(boardColumns, 'updated_at') ? { updated_at: db.fn.now() } : {}),
    });

    const createdBoard = await db('boards')
      .where({ tenant: tenantId, board_id: boardId })
      .first<{ enable_live_ticket_timer: boolean }>('enable_live_ticket_timer');

    expect(createdBoard?.enable_live_ticket_timer).toBe(true);

    await db('boards')
      .where({ tenant: tenantId, board_id: boardId })
      .update({ enable_live_ticket_timer: false });

    const updatedBoard = await db('boards')
      .where({ tenant: tenantId, board_id: boardId })
      .first<{ enable_live_ticket_timer: boolean }>('enable_live_ticket_timer');

    expect(updatedBoard?.enable_live_ticket_timer).toBe(false);
  }, HOOK_TIMEOUT);
});
