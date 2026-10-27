import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import knex, { type Knex } from 'knex';
import { getSecret } from '../../src/lib/utils/getSecret';

// withLockRetry applies a 2s lock_timeout with SET LOCAL, which survives
// RELEASE SAVEPOINT. It must put the transaction's own value back, otherwise
// every later backfill UPDATE in the migration runs under 2s and a single
// blocked row raises 55P03 outside any retry.

const require = createRequire(import.meta.url);
const { withLockRetry } = require('../20261026090000_require_user_active_state.cjs') as {
  withLockRetry: (knex: Knex, statement: string | ((knex: Knex) => Promise<unknown>)) => Promise<unknown>;
};

let db: Knex;
const scratch = `lock_timeout_scratch_${randomUUID().replaceAll('-', '')}`;

const lockTimeout = async (conn: Knex): Promise<string> =>
  (await conn.raw('SHOW lock_timeout')).rows[0].lock_timeout;

beforeAll(async () => {
  // withLockRetry needs a real connection and a lockable table, not the app
  // schema, so this runs as the app user against one scratch table (dropped
  // below) rather than a freshly migrated database.
  db = knex({ client: 'pg', connection: {
    host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER_SERVER || 'app_user',
    password: await getSecret('db_password_server', 'DB_PASSWORD_SERVER', ''),
    database: process.env.DB_NAME_SERVER || process.env.DB_NAME || 'postgres',
  }, pool: { min: 0, max: 4 } });
  await db.raw(`CREATE TABLE ${scratch} (id int)`);
}, 60_000);

afterAll(async () => {
  await db?.raw(`DROP TABLE IF EXISTS ${scratch}`).catch(() => undefined);
  await db?.destroy().catch(() => undefined);
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

  it('gives up with 55P03 after the last attempt', async () => {
    const blocker = await db.transaction();
    await blocker.raw(`LOCK TABLE ${scratch} IN ACCESS EXCLUSIVE MODE`);
    const trx = await db.transaction();
    try {
      await expect(withLockRetry(trx, `ALTER TABLE ${scratch} ADD COLUMN IF NOT EXISTS c int`))
        .rejects.toMatchObject({ code: '55P03' });
    } finally {
      await trx.rollback();
      await blocker.rollback();
    }
  }, 30_000);
});
