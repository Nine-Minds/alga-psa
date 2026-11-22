import createKnex, { type Knex } from 'knex';

interface LockPool {
  connection: Knex;
  users: number;
}

const lockPools = new WeakMap<Knex, LockPool>();

/**
 * Serialize work that opens its own database transactions. Lock connections
 * must come from an independent, bounded pool: both waiting lock requests and
 * owners would otherwise consume the connections their work needs to finish.
 *
 * Share the lock pool while calls overlap, then close it when the last call
 * finishes. No idle pool or credentials are retained between batches.
 * The transaction pins the lock to one PostgreSQL backend, including behind
 * a transaction-pooling proxy, and releases it on failure or disconnection.
 */
export async function withAdvisoryLock<T>(db: Knex, key: string, work: () => Promise<T>): Promise<T> {
  let pool = lockPools.get(db);
  if (!pool) {
    pool = {
      connection: createKnex({
        ...db.client.config,
        pool: { ...db.client.config.pool, min: 0 },
      }),
      users: 0,
    };
    lockPools.set(db, pool);
  }
  pool.users += 1;

  try {
    return await pool.connection.transaction(async (trx) => {
      await trx.raw("select set_config('lock_timeout', '120s', true)");
      await trx.raw('select pg_advisory_xact_lock(hashtext(?))', [key]);
      return work();
    });
  } finally {
    pool.users -= 1;
    if (pool.users === 0) {
      lockPools.delete(db);
      await pool.connection.destroy();
    }
  }
}
