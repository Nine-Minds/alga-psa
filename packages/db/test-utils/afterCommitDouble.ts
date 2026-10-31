/**
 * Faithful test double for the @alga-psa/db after-commit contract
 * (see packages/db/src/lib/afterCommit.ts).
 *
 *  - registerAfterCommit(trx, hook, label?) QUEUES the hook per trx; never runs it.
 *  - withTransaction(knexOrTrx, cb) runs cb(trx). On resolve it flushes the
 *    trx's queue in registration order, swallowing hook errors. On throw it
 *    drops the queue and rethrows.
 *  - A nested withTransaction whose first arg is the already-open trx shares
 *    the outer queue and does not flush (only the owning frame flushes).
 *
 * Mechanism, not an option bag: a test file supplies its own fake knex/trx
 * (`makeTrx`) and composes these functions into its vi.mock('@alga-psa/db')
 * factory. vi.mock factories are hoisted, so load with `await import(...)`:
 *
 *   vi.mock('@alga-psa/db', async () => {
 *     const { createAfterCommitDouble } = await import('<rel>/packages/db/test-utils/afterCommitDouble');
 *     const ac = createAfterCommitDouble(() => fakeTrx);
 *     return { withTransaction: ac.withTransaction, registerAfterCommit: ac.registerAfterCommit, ... };
 *   });
 */

export type AfterCommitHook = () => void | Promise<void>;

export interface AfterCommitDouble {
  registerAfterCommit: (trx: object, hook: AfterCommitHook, label?: string) => void;
  withTransaction: <T>(knexOrTrx: unknown, cb: (trx: any) => Promise<T> | T) => Promise<T>;
  /** Hooks queued (not yet flushed/dropped) for a trx. */
  pending: (trx: object) => number;
  /** Labels ('' when unlabelled) of hooks that have run, in order. */
  readonly flushed: string[];
  /** Labels of hooks dropped by a rollback, in order. */
  readonly dropped: string[];
  reset: () => void;
}

export function createAfterCommitDouble(makeTrx: (knexOrTrx: unknown) => any): AfterCommitDouble {
  const queues = new WeakMap<object, { hook: AfterCommitHook; label?: string }[]>();
  const owned = new WeakSet<object>(); // trx objects with an open owning frame
  const flushed: string[] = [];
  const dropped: string[] = [];

  const registerAfterCommit = (trx: object, hook: AfterCommitHook, label?: string) => {
    const q = queues.get(trx);
    if (q) q.push({ hook, label });
    else queues.set(trx, [{ hook, label }]);
  };

  const withTransaction = async <T>(knexOrTrx: unknown, cb: (trx: any) => Promise<T> | T): Promise<T> => {
    const incoming = knexOrTrx as object | null;
    if (incoming && owned.has(incoming)) {
      return cb(incoming); // nested frame: shares the outer trx, never flushes
    }
    const trx = makeTrx(knexOrTrx);
    owned.add(trx);
    let result: T;
    try {
      result = await cb(trx);
    } catch (error) {
      for (const e of queues.get(trx) ?? []) dropped.push(e.label ?? '');
      queues.delete(trx);
      owned.delete(trx);
      throw error;
    }
    owned.delete(trx);
    const hooks = queues.get(trx) ?? [];
    queues.delete(trx);
    for (const { hook, label } of hooks) {
      try {
        await hook();
      } catch {
        /* real module logs and swallows */
      }
      flushed.push(label ?? '');
    }
    return result;
  };

  return {
    registerAfterCommit,
    withTransaction,
    pending: (trx) => queues.get(trx)?.length ?? 0,
    flushed,
    dropped,
    reset: () => { flushed.length = 0; dropped.length = 0; },
  };
}

/**
 * Surface check: a full-replacement vi.mock factory result must export every
 * name the code under test imports, else product code silently gets undefined.
 */
// LEVERAGE: pattern db-mock-surface — same "mock exports ⊇ imports" check would
// protect every full-replacement vi.mock('@alga-psa/db') repo-wide.
export function assertMockCovers(mockFactoryResult: Record<string, unknown>, importedNames: string[], label = '@alga-psa/db mock'): void {
  const missing = importedNames.filter((n) => !(n in mockFactoryResult));
  if (missing.length) {
    throw new Error(`${label} is missing export(s): ${missing.join(', ')}`);
  }
}
