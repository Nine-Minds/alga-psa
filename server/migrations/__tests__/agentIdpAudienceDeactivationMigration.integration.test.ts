import 'server/test-utils/testMocks';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import type { Knex } from 'knex';
import { TestContext } from 'server/test-utils/testContext';

type Migration = { up: (knex: Knex) => Promise<void>; down: (knex: Knex) => Promise<void> };

const require = createRequire(import.meta.url);
const eeMigration = (name: string) =>
  require(path.resolve(__dirname, '../../../ee/server/migrations', name)) as Migration;

// The CE test database does not carry the EE MCP tables; build them from the
// EE migrations (idempotent when TEST_MIGRATIONS_DIR already applied them).
const schemaMigrations = [
  eeMigration('20260607120000_create_mcp_agents.cjs'),
  eeMigration('20260607140000_add_subject_claim_to_agent_idp.cjs'),
  eeMigration('20260607150000_add_kind_to_agent_idp.cjs'),
];
const migration = eeMigration('20261030090000_deactivate_agent_idp_providers_without_audience.cjs');

const helpers = TestContext.createHelpers();
let ctx: TestContext;

const STALE = new Date('2020-01-01T00:00:00Z');

async function insertProvider(audience: string | null, active = true): Promise<string> {
  const id = uuidv4();
  await ctx.db('agent_idp_providers').insert({
    id,
    tenant: ctx.tenantId,
    issuer: `https://idp.example/${id}`,
    jwks_uri: `https://idp.example/${id}/jwks`,
    audience,
    active,
    updated_at: STALE,
  });
  return id;
}

const providerRow = (id: string) =>
  ctx.db('agent_idp_providers').where({ tenant: ctx.tenantId, id }).first();

describe('deactivate agent IdP providers without an audience migration', () => {
  beforeAll(async () => {
    ctx = await helpers.beforeAll({});
  }, 300_000);
  afterAll(async () => {
    await helpers.afterAll();
  });
  beforeEach(async () => {
    ctx = await helpers.beforeEach();
    for (const m of schemaMigrations) await m.up(ctx.db);
    await ctx.db('agent_idp_providers').where({ tenant: ctx.tenantId }).del();
  }, 300_000);

  it('deactivates active providers whose audience is NULL or blank and leaves configured ones trusted', async () => {
    const nullAud = await insertProvider(null);
    const blankAud = await insertProvider('   ');
    const configured = await insertProvider('api://alga-mcp');
    const alreadyInactive = await insertProvider(null, false);

    await migration.up(ctx.db);

    expect((await providerRow(nullAud)).active).toBe(false);
    expect((await providerRow(blankAud)).active).toBe(false);
    expect(new Date((await providerRow(nullAud)).updated_at).getTime()).toBeGreaterThan(STALE.getTime());

    const kept = await providerRow(configured);
    expect(kept.active).toBe(true);
    expect(new Date(kept.updated_at).getTime()).toBe(STALE.getTime());

    const untouched = await providerRow(alreadyInactive);
    expect(untouched.active).toBe(false);
    expect(new Date(untouched.updated_at).getTime()).toBe(STALE.getTime());
  });

  it('deactivates every audience-less provider even when they span several batches, and is safe to re-run', async () => {
    const rows = Array.from({ length: 1_050 }, () => {
      const id = uuidv4();
      return {
        id,
        tenant: ctx.tenantId,
        issuer: `https://idp.example/${id}`,
        jwks_uri: `https://idp.example/${id}/jwks`,
        audience: null,
        active: true,
      };
    });
    await ctx.db.batchInsert('agent_idp_providers', rows, 250);
    const configured = await insertProvider('api://alga-mcp');

    await migration.up(ctx.db);
    await migration.up(ctx.db);

    const stillActive = await ctx.db('agent_idp_providers')
      .where({ tenant: ctx.tenantId, active: true })
      .pluck('id');
    expect(stillActive).toEqual([configured]);
  });
});
