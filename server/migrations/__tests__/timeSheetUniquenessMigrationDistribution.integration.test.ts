import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { knex as knexFactory, type Knex } from 'knex';
import { wireLocalTestDbEnv } from '../../test-utils/dbConfig';

// The time sheet uniqueness migration classifies duplicate sheets by what references them
// (time_entries, time_sheet_comments, time_entry_change_requests). On Citus those tables need not
// share time_sheets' distribution: a fresh combined CE+EE install distributes
// time_entry_change_requests in its own migration while time_sheets stays local, and production
// distributes them all. Citus refuses joins and modifications that mix local and distributed
// tables, so the migration must hold for every mix. This runs in the Citus runtime lane (where
// each mix is applied) as well as on plain Postgres (where every mix is all-local).
const require = createRequire(import.meta.url);
const migration = require('../20261101120000_enforce_time_sheet_user_period_uniqueness.cjs');
const INDEX = 'time_sheets_tenant_user_period_unique';
const DB_NAME = 'test_db_time_sheet_uniqueness_distribution';
const isCitus = process.env.TEST_DB_BACKEND === 'citus';
const SHEET_TABLES = ['time_sheets', 'time_entries', 'time_sheet_comments', 'time_entry_change_requests'] as const;
type SheetTable = (typeof SHEET_TABLES)[number];

let root: Knex;
let db: Knex;

function connection(database: string) {
  return {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER_ADMIN || 'postgres',
    password: process.env.DB_PASSWORD_ADMIN || 'postpass123',
    database,
  };
}

async function createSchema(distributed: SheetTable[]) {
  await db.raw('DROP TABLE IF EXISTS time_entry_change_requests, time_sheet_comments, time_entries, time_sheets');
  await db.raw(`CREATE TABLE time_sheets (
    tenant uuid NOT NULL, id uuid NOT NULL, user_id uuid NOT NULL, period_id uuid NOT NULL,
    approval_status text NOT NULL DEFAULT 'DRAFT', submitted_at timestamptz, approved_at timestamptz, approved_by uuid,
    PRIMARY KEY (tenant, id))`);
  await db.raw(`CREATE TABLE time_entries (tenant uuid NOT NULL, entry_id uuid NOT NULL, time_sheet_id uuid, PRIMARY KEY (tenant, entry_id))`);
  await db.raw(`CREATE TABLE time_sheet_comments (tenant uuid NOT NULL, comment_id uuid NOT NULL, time_sheet_id uuid NOT NULL, PRIMARY KEY (tenant, comment_id))`);
  await db.raw(`CREATE TABLE time_entry_change_requests (tenant uuid NOT NULL, id uuid NOT NULL, time_sheet_id uuid NOT NULL, PRIMARY KEY (tenant, id))`);
  if (isCitus) {
    for (const table of distributed) {
      await db.raw("SELECT create_distributed_table(?, 'tenant', colocate_with => 'tenants')", [table]);
    }
  }
}

async function distributionOf(table: SheetTable): Promise<'distributed' | 'local'> {
  if (!isCitus) return 'local';
  const { rows } = await db.raw("SELECT partmethod FROM pg_dist_partition WHERE logicalrelid = ?::regclass", [table]);
  return rows[0]?.partmethod === 'h' ? 'distributed' : 'local';
}

const ID = {
  keep: '00000000-0000-4000-8000-00000000000a',
  pristine: '00000000-0000-4000-8000-00000000000b',
  requested: '00000000-0000-4000-8000-00000000000c',
  withEntry: '00000000-0000-4000-8000-00000000000d',
  pristine2: '00000000-0000-4000-8000-00000000000e',
};

beforeAll(async () => {
  wireLocalTestDbEnv();
  root = knexFactory({ client: 'pg', connection: connection('postgres'), pool: { min: 0, max: 1 } });
  await root.raw('DROP DATABASE IF EXISTS ?? WITH (FORCE)', [DB_NAME]);
  await root.raw('CREATE DATABASE ??', [DB_NAME]);
  db = knexFactory({ client: 'pg', connection: connection(DB_NAME), pool: { min: 1, max: 4 } });
  await db.raw('CREATE TABLE tenants (tenant uuid PRIMARY KEY)');
  if (isCitus) {
    await db.raw('CREATE EXTENSION IF NOT EXISTS citus');
    await db.raw("SELECT create_distributed_table('tenants', 'tenant')");
  }
}, 120_000);

afterAll(async () => {
  await db?.destroy().catch(() => undefined);
  await root?.raw('DROP DATABASE IF EXISTS ?? WITH (FORCE)', [DB_NAME]).catch(() => undefined);
  await root?.destroy().catch(() => undefined);
});

describe('time sheet uniqueness migration across Citus distribution mixes', () => {
  let tenant: string;
  beforeEach(() => { tenant = randomUUID(); });

  it.each<[string, SheetTable[]]>([
    ['fresh install: only time_entry_change_requests distributed', ['time_entry_change_requests']],
    ['production: every sheet table distributed', [...SHEET_TABLES]],
    ['time_sheets distributed, references local', ['time_sheets']],
    ['all local', []],
  ])('%s', async (_label, distributed) => {
    await createSchema(distributed);
    for (const table of SHEET_TABLES) {
      expect(await distributionOf(table)).toBe(isCitus && distributed.includes(table) ? 'distributed' : 'local');
    }

    const userId = randomUUID();
    const periodId = randomUUID();
    const otherPeriod = randomUUID();
    const sheet = (id: string, period = periodId, extra: Record<string, unknown> = {}) =>
      db('time_sheets').insert({ tenant, id, user_id: userId, period_id: period, approval_status: 'DRAFT', ...extra });

    // Group 1: one submitted sheet plus a pristine draft -> keep the submitted sheet.
    await sheet(ID.keep, periodId, { approval_status: 'SUBMITTED', submitted_at: new Date() });
    await sheet(ID.pristine);
    // Group 2: a draft referenced only by a change request, plus a pristine draft -> keep the referenced one.
    await sheet(ID.requested, otherPeriod);
    await sheet(ID.pristine2, otherPeriod);
    await db('time_entry_change_requests').insert({ tenant, id: randomUUID(), time_sheet_id: ID.requested });

    await migration.up(db);

    const remaining = (await db('time_sheets').where({ tenant }).orderBy('id').pluck('id')) as string[];
    expect(remaining).toEqual([ID.keep, ID.requested]);
    const { rows } = await db.raw('SELECT indisvalid FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid WHERE c.relname = ?', [INDEX]);
    expect(rows[0]?.indisvalid).toBe(true);
    await expect(sheet(randomUUID())).rejects.toMatchObject({ code: '23505' });

    // Two sheets with history in one group is refused before any write, under every mix.
    await migration.down(db);
    await sheet(ID.withEntry);
    await db('time_entries').insert({ tenant, entry_id: randomUUID(), time_sheet_id: ID.withEntry });
    await expect(migration.up(db)).rejects.toThrow(new RegExp(`${ID.keep}.*${ID.withEntry}.*has history`, 's'));
    expect(await db('time_sheets').where({ tenant }).count('* as n').first()).toMatchObject({ n: '3' });
  }, 120_000);
});
