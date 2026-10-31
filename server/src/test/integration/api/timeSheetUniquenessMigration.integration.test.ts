import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { knex as knexFactory, type Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';

import { tenantDb } from '@alga-psa/db';
import { createTestDbConnection } from '../../../../test-utils/dbConfig';

/**
 * Executes migrations/20261028120000_enforce_time_sheet_user_period_uniqueness.cjs against a real
 * migrated database (plain PostgreSQL). The harness's own migrate run has already built the
 * index, so each case drops it, seeds duplicates the schema would otherwise forbid, and runs `up`.
 * The migration needs DDL/DELETE rights, so it runs on an admin connection to the same database.
 */

const require = createRequire(import.meta.url);
const migration = require('../../../../migrations/20261028120000_enforce_time_sheet_user_period_uniqueness.cjs');
const INDEX = 'time_sheets_tenant_user_period_unique';

let appDb: Knex;
let admin: Knex;
const tenants = new Set<string>();

function adminPassword(): string {
  try {
    return fs.readFileSync(path.resolve(process.cwd(), '..', 'secrets', 'postgres_password'), 'utf8').trim();
  } catch {
    return process.env.DB_PASSWORD_ADMIN || 'postpass123';
  }
}

const t = (tenant: string, table: string) => tenantDb(admin, tenant).table(table);
const sheets = (tenant: string) => t(tenant, 'time_sheets').orderBy('id').select('*');

async function dropIndex() {
  await admin.raw(`DROP INDEX IF EXISTS ${INDEX}`);
}

async function indexExists(): Promise<boolean> {
  const { rows } = await admin.raw('SELECT 1 FROM pg_indexes WHERE indexname = ?', [INDEX]);
  return rows.length > 0;
}

async function seedTenant() {
  const tenant = uuidv4();
  tenants.add(tenant);
  await tenantDb(admin, '__fixture__').unscoped('tenants', 'test fixture').insert({
    tenant, client_name: `Mig ${tenant.slice(0, 8)}`, email: `m-${tenant.slice(0, 8)}@example.com`,
  });
  const userId = uuidv4();
  await t(tenant, 'users').insert({
    tenant, user_id: userId, username: `m-${userId.slice(0, 8)}`, hashed_password: 'x', user_type: 'internal',
    email: `m-${userId.slice(0, 8)}@example.com`, first_name: 'Mig', last_name: 'User',
  });
  const periodId = uuidv4();
  await t(tenant, 'time_periods').insert({ period_id: periodId, tenant, start_date: '2026-03-02', end_date: '2026-03-09' });
  return { tenant, userId, periodId };
}

// Ids are spelled out so "lowest id" is predictable: a < b < c.
const ID = { a: '00000000-0000-4000-8000-00000000000a', b: '00000000-0000-4000-8000-00000000000b', c: '00000000-0000-4000-8000-00000000000c' };

async function sheet(f: { tenant: string; userId: string; periodId: string }, id: string, extra: Record<string, unknown> = {}) {
  await t(f.tenant, 'time_sheets').insert({
    tenant: f.tenant, id, user_id: f.userId, period_id: f.periodId, approval_status: 'DRAFT', ...extra,
  });
}

async function entryOn(f: { tenant: string; userId: string }, sheetId: string) {
  await t(f.tenant, 'time_entries').insert({
    tenant: f.tenant, entry_id: uuidv4(), user_id: f.userId, time_sheet_id: sheetId, work_item_type: 'ad_hoc',
    start_time: '2026-03-02T09:00:00Z', end_time: '2026-03-02T10:00:00Z', work_date: '2026-03-02',
    work_timezone: 'UTC', billable_duration: 60, approval_status: 'DRAFT',
  });
}

async function commentOn(f: { tenant: string; userId: string }, sheetId: string) {
  await t(f.tenant, 'time_sheet_comments').insert({
    tenant: f.tenant, time_sheet_id: sheetId, user_id: f.userId, comment: 'history', is_approver: false,
  });
}

async function changeRequestOn(f: { tenant: string; userId: string }, sheetId: string) {
  // No FK to time_sheets: only an explicit check can see this reference.
  await t(f.tenant, 'time_entry_change_requests').insert({
    tenant: f.tenant, time_sheet_id: sheetId, time_entry_id: uuidv4(), created_by: f.userId, comment: 'please fix',
  });
}

describe('time sheet uniqueness migration (executed against Postgres)', () => {
  beforeAll(async () => {
    appDb = await createTestDbConnection();
    const c = appDb.client.config.connection as Record<string, unknown>;
    admin = knexFactory({
      client: 'pg',
      connection: { host: c.host as string, port: c.port as number, database: c.database as string, user: 'postgres', password: adminPassword() },
      pool: { min: 1, max: 4 },
    });
  }, 180_000);

  afterEach(async () => {
    for (const tenant of tenants) {
      await t(tenant, 'time_entry_change_requests').del();
      await t(tenant, 'time_entries').del();
      await t(tenant, 'time_sheet_comments').del();
      await t(tenant, 'time_sheets').del();
      await t(tenant, 'time_periods').del();
      await t(tenant, 'users').del();
      await tenantDb(admin, '__fixture__').unscoped('tenants', 'test fixture').where({ tenant }).del();
    }
    tenants.clear();
    await migration.up(admin); // leave the schema as the migrated database expects it
  });

  afterAll(async () => {
    await admin?.destroy();
    await appDb?.destroy();
  });

  it('clean data: builds the index and enforces it', async () => {
    const f = await seedTenant();
    await dropIndex();
    await sheet(f, ID.a);
    await migration.up(admin);

    expect(await indexExists()).toBe(true);
    expect(await sheets(f.tenant)).toHaveLength(1);
    await expect(sheet(f, ID.b)).rejects.toMatchObject({ code: '23505' });
  });

  it('a group of only pristine drafts keeps the lowest id', async () => {
    const f = await seedTenant();
    await dropIndex();
    for (const id of [ID.c, ID.a, ID.b]) await sheet(f, id);
    await migration.up(admin);
    expect((await sheets(f.tenant)).map((r) => r.id)).toEqual([ID.a]);
  });

  it.each([
    ['a submitted sheet', async (f: any) => sheet(f, ID.c, { approval_status: 'SUBMITTED', submitted_at: new Date() }), ID.c],
    ['a draft with an entry', async (f: any) => { await sheet(f, ID.c); await entryOn(f, ID.c); }, ID.c],
    ['a draft with a comment', async (f: any) => { await sheet(f, ID.c); await commentOn(f, ID.c); }, ID.c],
    ['a draft whose only reference is a change request', async (f: any) => { await sheet(f, ID.c); await changeRequestOn(f, ID.c); }, ID.c],
    ['an approved sheet', async (f: any) => sheet(f, ID.c, { approval_status: 'APPROVED', approved_at: new Date(), approved_by: f.userId }), ID.c],
  ])('keeps the only meaningful sheet (%s) even when pristine extras have lower ids', async (_label, makeMeaningful, keptId) => {
    const f = await seedTenant();
    await dropIndex();
    await sheet(f, ID.a);
    await sheet(f, ID.b);
    await makeMeaningful(f);
    await migration.up(admin);

    const rows = await sheets(f.tenant);
    expect(rows.map((r) => r.id)).toEqual([keptId]);
    // The history it owns is untouched.
    const [{ count }] = await admin('time_entries').where({ tenant: f.tenant }).count('* as count');
    const [{ count: comments }] = await admin('time_sheet_comments').where({ tenant: f.tenant }).count('* as count');
    const [{ count: requests }] = await admin('time_entry_change_requests').where({ tenant: f.tenant }).count('* as count');
    expect(Number(count) + Number(comments) + Number(requests)).toBeLessThanOrEqual(1);
  });

  it('multiple meaningful sheets: refuses with diagnostics before any write', async () => {
    const ambiguous = await seedTenant();
    const cleanable = await seedTenant();
    await dropIndex();
    await sheet(ambiguous, ID.a, { approval_status: 'SUBMITTED', submitted_at: new Date() });
    await sheet(ambiguous, ID.b);
    await entryOn(ambiguous, ID.b);
    await sheet(ambiguous, ID.c); // pristine extra in the ambiguous group
    await sheet(cleanable, ID.a);
    await sheet(cleanable, ID.b); // would be deleted if cleanup ran

    await expect(migration.up(admin)).rejects.toThrow(
      new RegExp(`tenant=${ambiguous.tenant}.*${ID.a}.*${ID.b}.*has history`, 's'));

    expect(await sheets(ambiguous.tenant)).toHaveLength(3);
    expect(await sheets(cleanable.tenant)).toHaveLength(2); // no writes happened anywhere
    expect(await indexExists()).toBe(false);

    // After explicit repair the same migration resumes.
    await t(ambiguous.tenant, 'time_entries').del();
    await t(ambiguous.tenant, 'time_sheets').where({ id: ID.b }).update({ approval_status: 'DRAFT' });
    await migration.up(admin);
    expect(await indexExists()).toBe(true);
    expect((await sheets(ambiguous.tenant)).map((r) => r.id)).toEqual([ID.a]);
    expect((await sheets(cleanable.tenant)).map((r) => r.id)).toEqual([ID.a]);
  });

  it('is safe to rerun after partial completion and when the index already exists', async () => {
    const f = await seedTenant();
    await dropIndex();
    for (const id of [ID.a, ID.b, ID.c]) await sheet(f, id);
    // A previous run deleted one extra and then died before creating the index.
    await t(f.tenant, 'time_sheets').where({ id: ID.c }).del();

    await migration.up(admin);
    await migration.up(admin); // second run is a no-op
    expect((await sheets(f.tenant)).map((r) => r.id)).toEqual([ID.a]);
    expect(await indexExists()).toBe(true);
  });

  it('verifies an existing index by definition, not just by name', async () => {
    const f = await seedTenant();
    await dropIndex();
    await sheet(f, ID.a);
    await admin.raw(`CREATE UNIQUE INDEX ${INDEX} ON time_sheets (tenant, user_id, period_id) WHERE approval_status = 'DRAFT'`);

    await expect(migration.up(admin)).rejects.toThrow(/different definition/);

    await dropIndex();
    await admin.raw(`CREATE INDEX ${INDEX} ON time_sheets (tenant, user_id, period_id)`); // non-unique
    await expect(migration.up(admin)).rejects.toThrow(/different definition/);
    await dropIndex(); // afterEach rebuilds the correct one
  });

  it('cleans up in several batches and still keeps exactly one sheet per group', async () => {
    const f = await seedTenant();
    const g = await seedTenant();
    await dropIndex();
    const extra = Array.from({ length: 5 }, (_, i) => `00000000-0000-4000-8000-0000000001${i}0`);
    for (const id of [ID.a, ...extra]) await sheet(f, id);
    for (const id of [ID.b, ID.c]) await sheet(g, id);
    await migration.up(admin, { batchSize: 2 }); // 5 deletions for f => 3 batches
    expect((await sheets(f.tenant)).map((r) => r.id)).toEqual([ID.a]);
    expect((await sheets(g.tenant)).map((r) => r.id)).toEqual([ID.b]);
    expect(await indexExists()).toBe(true);
  });

  it('drops and rebuilds an INVALID index left by a failed CONCURRENTLY build', async () => {
    const f = await seedTenant();
    await dropIndex();
    await sheet(f, ID.a);
    await sheet(f, ID.b);
    await expect(
      admin.raw(`CREATE UNIQUE INDEX CONCURRENTLY ${INDEX} ON time_sheets (tenant, user_id, period_id)`),
    ).rejects.toMatchObject({ code: '23505' });
    const { rows: before } = await admin.raw('SELECT indisvalid FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid WHERE c.relname = ?', [INDEX]);
    expect(before[0].indisvalid).toBe(false);

    await migration.up(admin);
    const { rows: after } = await admin.raw('SELECT indisvalid FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid WHERE c.relname = ?', [INDEX]);
    expect(after[0].indisvalid).toBe(true);
    expect((await sheets(f.tenant)).map((r) => r.id)).toEqual([ID.a]);
  });

  it('down drops only the index and keeps data', async () => {
    const f = await seedTenant();
    await sheet(f, ID.a);
    await migration.down(admin);
    expect(await indexExists()).toBe(false);
    expect(await sheets(f.tenant)).toHaveLength(1);
  });
});
