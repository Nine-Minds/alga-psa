import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import createKnex, { type Knex } from 'knex';
import { randomUUID } from 'node:crypto';
import { withAdvisoryLock } from '@alga-psa/db';
import { createTestDbConnection } from '../../../test-utils/dbConfig';

let db: Knex;
beforeAll(async () => { db = await createTestDbConnection(); }, 120_000);
afterAll(async () => { await db?.destroy(); });

describe('advisory locks around work that opens its own transactions', () => {
  it.each([1, 2, 5])('completes distinct operations at work-pool capacity %i', async (capacity) => {
    const workDb = createKnex({
      ...db.client.config,
      pool: { min: 0, max: capacity },
      acquireConnectionTimeout: 1_000,
    });
    let entered = 0;
    let release!: () => void;
    const allEntered = new Promise<void>((resolve) => { release = resolve; });
    const key = randomUUID();
    try {
      const operations = Array.from({ length: capacity }, (_, index) =>
        withAdvisoryLock(workDb, `${key}:${index}`, async () => {
          if (++entered === capacity) release();
          await allEntered;
          // Every lock owner must be able to borrow a work connection, even
          // when there are as many owners as the work pool has connections.
          return workDb.transaction(async (trx) => (await trx.raw('select 42 as value')).rows[0].value);
        }));
      expect(await Promise.all(operations)).toEqual(Array(capacity).fill(42));
      // Exercise reuse after the final overlapping call closes the lock pool.
      expect(await withAdvisoryLock(workDb, key, async () => 7)).toBe(7);
    } finally {
      release();
      await workDb.destroy();
    }
  }, 10_000);

  it('serializes the same key across independent callers and releases it after failure', async () => {
    const otherDb = createKnex({ ...db.client.config, pool: { min: 0, max: 1 }, acquireConnectionTimeout: 1_000 });
    const key = randomUUID();
    let active = 0;
    let maximumActive = 0;
    try {
      const work = (connection: Knex) => withAdvisoryLock(connection, key, async () => {
        maximumActive = Math.max(maximumActive, ++active);
        try { await connection.raw('select pg_sleep(0.02)'); }
        finally { active -= 1; }
      });
      await Promise.all([work(db), work(otherDb), work(db)]);
      expect(maximumActive).toBe(1);
      await expect(withAdvisoryLock(db, key, async () => { throw new Error('interrupted'); })).rejects.toThrow('interrupted');
      expect(await withAdvisoryLock(otherDb, key, async () => 'recovered')).toBe('recovered');
    } finally {
      await otherDb.destroy();
    }
  });
});
