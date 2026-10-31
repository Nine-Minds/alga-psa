import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Knex } from 'knex';
import { randomUUID } from 'node:crypto';
import { createTestDbConnection, wireLocalTestDbEnv } from '../../test-utils/dbConfig';

// The operation log is created, distributed and indexed in one migration transaction, and its
// immutability trigger function is created in that same transaction. On Citus, function DDL is
// refused once the transaction has run a parallel operation on a distributed table, so this runs
// in the Citus runtime lane as well as on plain Postgres.
const require = createRequire(import.meta.url);
const MIGRATIONS_DIR = path.resolve(__dirname, '..');
const NAME = '20261029090000_create_co_managed_meeting_creation_operations.cjs';
const MIGRATION = require(path.join(MIGRATIONS_DIR, NAME));
const TABLE = 'co_managed_meeting_creation_operations';
const DB_NAME = 'test_db_cm_meeting_creation_ops';
const isCitus = process.env.TEST_DB_BACKEND === 'citus';
let db: Knex;
let scratchMigrationsDir: string;
let scratchSeedsDir: string;

beforeAll(async () => {
  wireLocalTestDbEnv();
  scratchMigrationsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-meeting-ops-migrations-'));
  scratchSeedsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-meeting-ops-seeds-'));
  // Non-transactional fixture: knex then runs each migration in its own transaction, as it does
  // for the real migration chain, rather than wrapping the whole batch in one.
  fs.writeFileSync(path.join(scratchMigrationsDir, '20261029080000_cm_meeting_ops_fixture.cjs'), `exports.config = { transaction: false };
  exports.up = async (knex) => {
    await knex.raw('CREATE TABLE IF NOT EXISTS tenants (tenant uuid PRIMARY KEY)');
    if (process.env.TEST_DB_BACKEND === 'citus') await knex.raw("SELECT create_distributed_table('tenants', 'tenant')");
  };
  exports.down = async knex => { await knex.schema.dropTableIfExists('tenants'); };
`);
  fs.writeFileSync(path.join(scratchMigrationsDir, NAME), `module.exports = require(${JSON.stringify(path.join(MIGRATIONS_DIR, NAME))});\n`);
  db = await createTestDbConnection({ databaseName: DB_NAME, migrationsDir: scratchMigrationsDir, seedsDir: scratchSeedsDir, runSeeds: false });
}, 300_000);

afterAll(async () => {
  await db?.destroy().catch(() => undefined);
  if (scratchMigrationsDir) fs.rmSync(scratchMigrationsDir, { recursive: true, force: true });
  if (scratchSeedsDir) fs.rmSync(scratchSeedsDir, { recursive: true, force: true });
});

const operation = (tenant: string) => ({
  tenant, operation_id: randomUUID(), appointment_request_id: randomUUID(), requested_by: randomUUID(),
  credential_kind: 'session', credential_id: randomUUID(), purpose: 'approve', approval_input: {},
  request_fingerprint: 'a'.repeat(64), creation_target: {}, provider_request: {},
});

describe('co-managed meeting creation operations migration', () => {
  it('creates the operation log, distributed with tenants on Citus', async () => {
    expect(await db.schema.hasTable(TABLE)).toBe(true);
    if (isCitus) {
      const { rows } = await db.raw('SELECT partmethod FROM pg_dist_partition WHERE logicalrelid = ?::regclass', [TABLE]);
      expect(rows[0]?.partmethod).toBe('h');
    }
  });

  it('rolls back and re-applies inside single transactions', async () => {
    await db(TABLE).del();
    await db.transaction(trx => MIGRATION.down(trx));
    expect(await db.schema.hasTable(TABLE)).toBe(false);
    await db.transaction(trx => MIGRATION.up(trx));
    await db.transaction(trx => MIGRATION.up(trx));
    expect(await db.schema.hasTable(TABLE)).toBe(true);
  });

  it('refuses to roll back while an operation is retained', async () => {
    const tenant = randomUUID();
    await db('tenants').insert({ tenant });
    await db(TABLE).insert(operation(tenant));
    await expect(db.transaction(trx => MIGRATION.down(trx))).rejects.toThrow(/Cannot discard retained meeting creation operations/);
    expect(await db.schema.hasTable(TABLE)).toBe(true);
  });

  it('freezes the identity and disclosure payload where the table accepts triggers', async () => {
    const tenant = randomUUID();
    await db('tenants').insert({ tenant });
    const row = operation(tenant);
    await db(TABLE).insert(row);
    const where = { tenant, operation_id: row.operation_id };
    await db(TABLE).where(where).update({ status: 'uncertain', attempt_count: 1 });
    const identityChange = db(TABLE).where(where).update({ purpose: 'generate' });
    // Citus rejects triggers on distributed tables; there the application path is the guard.
    if (isCitus) await expect(identityChange).resolves.toBe(1);
    else await expect(identityChange).rejects.toThrow(/immutable/);
  });
});
