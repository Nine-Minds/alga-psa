import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Knex } from 'knex';
import { createTestDbConnection, wireLocalTestDbEnv } from '../../test-utils/dbConfig';

// withLockRetry applies a 2s lock_timeout with SET LOCAL, which survives
// RELEASE SAVEPOINT. It must put the transaction's own value back, otherwise
// every later backfill UPDATE in the migration runs under 2s and a single
// blocked row raises 55P03 outside any retry.

const require = createRequire(import.meta.url);
const { withLockRetry } = require('../20261026090000_require_user_active_state.cjs') as {
  withLockRetry: (knex: Knex, statement: string | ((knex: Knex) => Promise<unknown>)) => Promise<unknown>;
};

// A scratch database recreated on every run, holding one lockable table owned
// by the app role (ALTER TABLE needs ownership). Nothing touches the shared
// test database, so a stale run cannot leave a table behind there.
const DB_NAME = 'test_db_lock_retry_scope';
const scratch = 'lock_retry_scratch';
let db: Knex;
let scratchMigrationsDir: string;
let scratchSeedsDir: string;

const lockTimeout = async (conn: Knex): Promise<string> =>
  (await conn.raw('SHOW lock_timeout')).rows[0].lock_timeout;

beforeAll(async () => {
  wireLocalTestDbEnv();
  scratchMigrationsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lock-retry-migrations-'));
  scratchSeedsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lock-retry-seeds-'));
  const appUser = process.env.DB_USER_SERVER || 'app_user';
  fs.writeFileSync(path.join(scratchMigrationsDir, '20261026000000_lock_retry_fixture.cjs'), `exports.up = async (knex) => {
    await knex.raw('CREATE TABLE ${scratch} (id int)');
    await knex.raw('ALTER TABLE ${scratch} OWNER TO ${appUser}');
  };
  exports.down = async (knex) => { await knex.raw('DROP TABLE IF EXISTS ${scratch}'); };
`);
  db = await createTestDbConnection({ databaseName: DB_NAME, migrationsDir: scratchMigrationsDir, seedsDir: scratchSeedsDir, runSeeds: false });
}, 300_000);

afterAll(async () => {
  await db?.destroy().catch(() => undefined);
  if (scratchMigrationsDir) fs.rmSync(scratchMigrationsDir, { recursive: true, force: true });
  if (scratchSeedsDir) fs.rmSync(scratchSeedsDir, { recursive: true, force: true });
});

describe('withLockRetry scopes its lock_timeout', () => {
  it('restores the prior value after a statement that succeeds first time', async () => {
    const trx = await db.transaction();
    try {
      await trx.raw(`SET LOCAL lock_timeout = '45s'`);
      const before = await lockTimeout(trx);
      await withLockRetry(trx, `ALTER TABLE ${scratch} ADD COLUMN IF NOT EXISTS a int`);
      expect(await lockTimeout(trx)).toBe(before);
      expect(before).toBe('45s');
    } finally {
      await trx.rollback();
    }
  });

  it('restores the default (0) too, and passes a function result through', async () => {
    const trx = await db.transaction();
    try {
      const before = await lockTimeout(trx);
      const result = await withLockRetry(trx, async (conn) => (await conn.raw('SELECT 7 AS n')).rows[0].n);
      expect(result).toBe(7);
      expect(await lockTimeout(trx)).toBe(before);
    } finally {
      await trx.rollback();
    }
  });

  it('restores the prior value after a timed-out attempt that is then retried successfully', async () => {
    const blocker = await db.transaction();
    await blocker.raw(`LOCK TABLE ${scratch} IN ACCESS EXCLUSIVE MODE`);
    // Releases after the first 2s attempt has timed out and the second is waiting.
    const release = new Promise<void>((resolve) => setTimeout(() => blocker.rollback().then(() => resolve()), 3000));

    const trx = await db.transaction();
    try {
      const before = await lockTimeout(trx);
      await withLockRetry(trx, `ALTER TABLE ${scratch} ADD COLUMN IF NOT EXISTS b int`);
      expect(await lockTimeout(trx)).toBe(before);
      // The statement after the retry is not under the 2s timeout either.
      await trx.raw(`SELECT 1`);
    } finally {
      await trx.rollback();
      await release;
    }
  }, 30_000);

  it('gives up with 55P03 after the last attempt, leaving the transaction usable and its timeout restored', async () => {
    const blocker = await db.transaction();
    await blocker.raw(`LOCK TABLE ${scratch} IN ACCESS EXCLUSIVE MODE`);
    const trx = await db.transaction();
    try {
      await trx.raw(`SET LOCAL lock_timeout = '45s'`);
      await expect(withLockRetry(trx, `ALTER TABLE ${scratch} ADD COLUMN IF NOT EXISTS c int`))
        .rejects.toMatchObject({ code: '55P03' });
      // The last savepoint was rolled back before the throw: the transaction is
      // not aborted (25P02) and is no longer under the 2s retry timeout.
      expect((await trx.raw('SELECT 1 AS ok')).rows[0].ok).toBe(1);
      expect(await lockTimeout(trx)).toBe('45s');
    } finally {
      await trx.rollback();
      await blocker.rollback();
    }
  }, 30_000);
});
