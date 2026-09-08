import type { Knex } from 'knex';

/** An internal, short-lived capability for a single database MVCC cutoff.
 * It carries no customer authority; every collector still authenticates. */
export interface CoManagedPortableSnapshot { readonly capturedAt: string }
const snapshots = new WeakMap<CoManagedPortableSnapshot, { db: Knex; id: string; active: boolean }>();

/** The exporting transaction only retains an MVCC snapshot, never customer
 * rows or credentials. Collector transactions own their normal admission locks.
 * Await every collector inside work; the capability expires on return. */
export async function withCoManagedPortableSnapshot<T>(db: Knex,
  work: (snapshot: CoManagedPortableSnapshot) => Promise<T>): Promise<T> {
  if (db.isTransaction) throw new Error('Portable capture requires a root database connection');
  return db.transaction(async trx => {
    const result = await trx.raw('SELECT pg_export_snapshot() AS snapshot_id, transaction_timestamp() AS captured_at');
    const row = result.rows[0];
    if (!row || typeof row.snapshot_id !== 'string' || !/^[0-9A-F]+-[0-9A-F]+-[0-9]+$/i.test(row.snapshot_id)) throw new Error('Invalid database snapshot');
    const token = Object.freeze({ capturedAt: new Date(row.captured_at).toISOString() });
    const state = { db, id: row.snapshot_id, active: true };
    snapshots.set(token, state);
    try { return await work(token); }
    finally { state.active = false; snapshots.delete(token); }
  }, { isolationLevel: 'repeatable read' });
}

/** Import before any query, as required by PostgreSQL. Only capabilities
 * created here for this exact database and still-live capture are accepted. */
export function portableSnapshotTransaction<T>(db: Knex, snapshot: CoManagedPortableSnapshot | undefined,
  work: (trx: Knex.Transaction) => Promise<T>): Promise<T> {
  if (db.isTransaction) throw new Error('Portable capture requires a root database connection');
  const state = snapshot && snapshots.get(snapshot);
  if (snapshot && (!state || !state.active || state.db !== db)) throw new Error('Portable snapshot is unavailable');
  return db.transaction(async trx => {
    if (state) {
      if (!state.active) throw new Error('Portable snapshot is unavailable');
      // PostgreSQL utility statements require a literal, not a bind parameter.
      await trx.raw(trx.raw('SET TRANSACTION SNAPSHOT ?', [state.id]).toQuery());
    }
    const result = await work(trx);
    if (state && !state.active) throw new Error('Portable snapshot is unavailable');
    return result;
  }, { isolationLevel: 'repeatable read' });
}
