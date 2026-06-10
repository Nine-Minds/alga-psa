import { describe, expect, it, vi } from 'vitest';

vi.mock('@alga-psa/core/logger', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

function createOwnedTrx() {
  return {
    commit: vi.fn(async () => {}),
    rollback: vi.fn(async () => {}),
  } as any;
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

describe('registerAfterCommit', () => {
  it('runs hooks in registration order after commit, before withTransaction returns', async () => {
    const { withTransaction, registerAfterCommit } = await import('@alga-psa/db');
    const trx = createOwnedTrx();
    const knex = createKnex(trx);
    const order: string[] = [];

    const result = await withTransaction(knex, async (t) => {
      registerAfterCommit(t, () => {
        order.push('hook-1');
      });
      registerAfterCommit(t, async () => {
        order.push('hook-2');
      });
      order.push('callback-done');
      return 'ok';
    });

    expect(result).toBe('ok');
    expect(order).toEqual(['callback-done', 'hook-1', 'hook-2']);
    expect(trx.commit).toHaveBeenCalledTimes(1);
  });

  it('drops hooks when the transaction rolls back', async () => {
    const { withTransaction, registerAfterCommit } = await import('@alga-psa/db');
    const trx = createOwnedTrx();
    const knex = createKnex(trx);
    const hook = vi.fn();

    await expect(
      withTransaction(knex, async (t) => {
        registerAfterCommit(t, hook);
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');

    expect(hook).not.toHaveBeenCalled();
    expect(trx.rollback).toHaveBeenCalledTimes(1);
  });

  it('attaches nested-frame hooks to the owning frame and flushes once, at outer commit', async () => {
    const { withTransaction, registerAfterCommit } = await import('@alga-psa/db');
    const trx = createOwnedTrx();
    const knex = createKnex(trx);
    const order: string[] = [];

    await withTransaction(knex, async (outerTrx) => {
      await withTransaction(outerTrx, async (nestedTrx) => {
        expect(nestedTrx).toBe(outerTrx);
        registerAfterCommit(nestedTrx, () => {
          order.push('nested-hook');
        });
      });
      // The nested frame returned without owning the commit: its hook must
      // not have run yet.
      order.push('after-nested-frame');
    });

    expect(order).toEqual(['after-nested-frame', 'nested-hook']);
  });

  it('swallows hook failures, logs the label, and keeps running the remaining hooks', async () => {
    const { withTransaction, registerAfterCommit } = await import('@alga-psa/db');
    const logger = (await import('@alga-psa/core/logger')).default;
    const trx = createOwnedTrx();
    const knex = createKnex(trx);
    const secondHook = vi.fn();

    const result = await withTransaction(knex, async (t) => {
      registerAfterCommit(
        t,
        () => {
          throw new Error('hook failed');
        },
        'TICKET_CLOSED ticket=t-1'
      );
      registerAfterCommit(t, secondHook);
      return 'ok';
    });

    expect(result).toBe('ok');
    expect(secondHook).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      '[db/afterCommit] after-commit hook failed',
      expect.objectContaining({ label: 'TICKET_CLOSED ticket=t-1', error: 'hook failed' })
    );
  });

  it('flushes each hook exactly once', async () => {
    const { withTransaction, registerAfterCommit } = await import('@alga-psa/db');
    const { flushAfterCommitHooks } = await import('./afterCommit');
    const trx = createOwnedTrx();
    const knex = createKnex(trx);
    const hook = vi.fn();

    await withTransaction(knex, async (t) => {
      registerAfterCommit(t, hook);
    });
    await flushAfterCommitHooks(trx);

    expect(hook).toHaveBeenCalledTimes(1);
  });
});
