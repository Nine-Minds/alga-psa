import 'server/test-utils/testMocks';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import type { Knex } from 'knex';
import { TestContext } from 'server/test-utils/testContext';
import { createUser } from 'server/test-utils/testDataFactory';

const require = createRequire(import.meta.url);
const migration = require(path.resolve(__dirname, '../20260929100000_make_team_manager_nullable.cjs')) as {
  up: (knex: Knex) => Promise<void>;
  down: (knex: Knex) => Promise<void>;
};

const helpers = TestContext.createHelpers();
let ctx: TestContext;

const isNullable = async () =>
  (await ctx.db.raw(
    "select is_nullable from information_schema.columns where table_name='teams' and column_name='manager_id'"
  )).rows[0].is_nullable === 'YES';

describe('teams.manager_id nullable migration (alga-2026-0002379)', () => {
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

  it('up leaves the lead optional and is safe to run twice', async () => {
    expect(await isNullable()).toBe(true);
    await migration.up(ctx.db);
    expect(await isNullable()).toBe(true);
  });

  it('down gives a lead-less team its earliest member as lead, then restores NOT NULL', async () => {
    const member = await createUser(ctx.db, ctx.tenantId, {});
    const teamId = uuidv4();
    await ctx.db('teams').insert({ tenant: ctx.tenantId, team_id: teamId, team_name: 'No lead', manager_id: null });
    await ctx.db('team_members').insert({ tenant: ctx.tenantId, team_id: teamId, user_id: member, role: 'member' });

    await migration.down(ctx.db);

    expect(await isNullable()).toBe(false);
    expect((await ctx.db('teams').where({ tenant: ctx.tenantId, team_id: teamId }).first()).manager_id).toBe(member);
  });

  it('down refuses (and changes nothing) when a lead-less team has no members to promote', async () => {
    const teamId = uuidv4();
    await ctx.db('teams').insert({ tenant: ctx.tenantId, team_id: teamId, team_name: 'Empty', manager_id: null });

    await expect(migration.down(ctx.db)).rejects.toThrow(/no lead and no members/);
    expect(await isNullable()).toBe(true);
  });
});
