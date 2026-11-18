import { describe, expect, it, vi } from 'vitest';

vi.mock('@alga-psa/core/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

function createOwnedTrx() {
  return { commit: vi.fn(async () => {}), rollback: vi.fn(async () => {}) } as any;
}

function createKnex(trx: any) {
  return {
    transaction: vi.fn(async (cb: any) => {
      try {
        const result = await cb(trx);
        await trx.commit();
        return result;
      } catch (error) {
        await trx.rollback(error);
        throw error;
      }
    }),
  } as any;
}

describe('afterCommit connection hooks and savepoint settle', () => {
  it('passes the owning root connection only to opted-in hooks after a nested transaction commits', async () => {
    const { withTransaction, registerAfterCommit, registerAfterCommitWithConnection } = await import('@alga-psa/db');
    const trx = createOwnedTrx();
    const knex = createKnex(trx);
    const ordinary = vi.fn();
    const durable = vi.fn(async (root: unknown) => {
      expect(root).toBe(knex);
      expect(root).not.toBe(trx);
      expect(trx.commit).toHaveBeenCalledOnce();
    });
    await withTransaction(knex, async (parent) => {
      await withTransaction(parent, async (child) => {
        registerAfterCommit(child, ordinary);
        registerAfterCommitWithConnection(child, durable);
      });
      expect(durable).not.toHaveBeenCalled();
    });
    expect(ordinary).toHaveBeenCalledTimes(1);
    expect(durable).toHaveBeenCalledExactlyOnceWith(knex);
  });

  it('skips connection hooks after rollback and on a manual flush without a root', async () => {
    const { withTransaction, registerAfterCommitWithConnection } = await import('@alga-psa/db');
    const { flushAfterCommitHooks } = await import('./afterCommit');
    const trx = createOwnedTrx();
    const knex = createKnex(trx);
    const hook = vi.fn();
    await expect(withTransaction(knex, async (tx) => {
      registerAfterCommitWithConnection(tx, hook);
      throw new Error('Rollback');
    })).rejects.toThrow('Rollback');
    expect(hook).not.toHaveBeenCalled();
    const manual = createOwnedTrx();
    registerAfterCommitWithConnection(manual, hook);
    await flushAfterCommitHooks(manual);
    expect(hook).not.toHaveBeenCalled();
  });

  it('settles released savepoint hooks onto the parent and drops rolled-back ones', async () => {
    const { registerAfterCommit } = await import('@alga-psa/db');
    const { settleSavepointHooks, flushAfterCommitHooks } = await import('./afterCommit');
    const parent = {} as any, kept = {} as any, dropped = {} as any;
    const keptHook = vi.fn(), droppedHook = vi.fn();
    registerAfterCommit(kept, keptHook);
    registerAfterCommit(dropped, droppedHook);
    settleSavepointHooks(kept, parent);
    settleSavepointHooks(dropped);
    await flushAfterCommitHooks(parent);
    await flushAfterCommitHooks(dropped);
    expect(keptHook).toHaveBeenCalledTimes(1);
    expect(droppedHook).not.toHaveBeenCalled();
  });
});
