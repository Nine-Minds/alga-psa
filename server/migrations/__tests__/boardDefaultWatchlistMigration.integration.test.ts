import 'server/test-utils/testMocks';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import type { Knex } from 'knex';
import { TestContext } from 'server/test-utils/testContext';

const require = createRequire(import.meta.url);
const migration = require(path.resolve(__dirname, '../20260929110000_add_board_default_watchlist.cjs')) as {
  up: (knex: Knex) => Promise<void>;
  down: (knex: Knex) => Promise<void>;
};

const helpers = TestContext.createHelpers();
let ctx: TestContext;

const column = async (name: string) =>
  (await ctx.db.raw(
    "select data_type, is_nullable, column_default from information_schema.columns where table_name='boards' and column_name=?",
    [name]
  )).rows[0] as { data_type: string; is_nullable: string; column_default: string | null } | undefined;

describe('boards default watchlist migration (alga-2026-0002379)', () => {
  beforeAll(async () => {
    ctx = await helpers.beforeAll({});
  }, 300_000);
  afterAll(async () => {
    await migration.up(ctx.db);
    await helpers.afterAll();
  });
  beforeEach(async () => {
    ctx = await helpers.beforeEach();
    await migration.up(ctx.db);
  }, 300_000);

  it('up adds an off-by-default switch and a nullable jsonb document, and is safe to re-run', async () => {
    await migration.up(ctx.db);
    expect(await column('default_watchlist_enabled')).toMatchObject({ data_type: 'boolean', is_nullable: 'NO', column_default: 'false' });
    expect(await column('default_watchlist')).toMatchObject({ data_type: 'jsonb', is_nullable: 'YES' });
  });

  it('existing boards come out disabled with no recipients', async () => {
    const boardId = uuidv4();
    await ctx.db('boards').insert({ tenant: ctx.tenantId, board_id: boardId, board_name: 'Legacy', is_default: false, display_order: 1 });
    const row = await ctx.db('boards').where({ tenant: ctx.tenantId, board_id: boardId }).first();
    expect(row.default_watchlist_enabled).toBe(false);
    expect(row.default_watchlist).toBeNull();
  });

  it('down removes both columns and up restores them', async () => {
    await migration.down(ctx.db);
    expect(await column('default_watchlist_enabled')).toBeUndefined();
    expect(await column('default_watchlist')).toBeUndefined();
    await migration.down(ctx.db); // idempotent
    await migration.up(ctx.db);
    expect(await column('default_watchlist')).toBeDefined();
  });
});
