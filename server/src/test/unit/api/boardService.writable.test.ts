/**
 * BoardService must not let a direct caller mass-assign tenant/board_id, and must hand the board
 * itself to the one lifecycle the settings actions use, so an API board is built the same way
 * (ee/plans/2026-11-21-itil-remediation, F104). Releasing the previous default board moved into
 * that lifecycle with the rest of the create; it is covered by
 * `src/test/integration/itilBoardLifecycle.integration.test.ts`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const lifecycle = vi.hoisted(() => ({
  createBoardCore: vi.fn(async () => ({ board_id: 'b1' })),
  updateBoardCore: vi.fn(async () => ({ board_id: 'b1' })),
  deleteBoardCore: vi.fn(async () => ({ success: true })),
}));

vi.mock('server/src/lib/eventBus/publishers', () => ({ publishEvent: vi.fn(async () => {}) }));
vi.mock('@alga-psa/tickets/services/boardLifecycle', () => ({
  ...lifecycle,
  isBoardLifecycleError: (error: unknown) =>
    error instanceof Error && (error as { code?: unknown }).code === 'BOARD_LIFECYCLE_REFUSED',
}));

const { BoardService } = await import('@/lib/api/services/BoardService');

function harness() {
  const svc: any = new BoardService();
  svc.mutationTransaction = async (_c: unknown, work: any) => work({ trx: true }, 't1');
  svc.getKnex = async () => ({ knex: { root: true }, tenant: 't1' });
  return { svc };
}
const ctx: any = { tenant: 't1', userId: 'u1' };

describe('BoardService writable projection', () => {
  beforeEach(() => {
    lifecycle.createBoardCore.mockClear();
    lifecycle.updateBoardCore.mockClear();
    lifecycle.deleteBoardCore.mockClear();
  });

  it.each([['tenant', { tenant: 'other' }], ['board_id', { board_id: 'x' }], ['made-up', { nope: 1 }]])(
    'rejects %s on create and update before any write',
    async (_l, extra) => {
      const { svc } = harness();
      await expect(svc.create({ board_name: 'X', ...extra }, ctx)).rejects.toThrow('Invalid board input');
      await expect(svc.update('b1', { board_name: 'X', ...extra }, ctx)).rejects.toThrow('Invalid board input');
      expect(lifecycle.createBoardCore).not.toHaveBeenCalled();
      expect(lifecycle.updateBoardCore).not.toHaveBeenCalled();
    }
  );

  it('hands a create to the board lifecycle with the projection and the caller', async () => {
    const { svc } = harness();
    await svc.create({ board_name: 'X', is_default: true }, ctx);
    expect(lifecycle.createBoardCore).toHaveBeenCalledWith(
      { trx: true },
      't1',
      { userId: 'u1' },
      { board_name: 'X', is_default: true }
    );
  });

  it('hands an update and a delete to the board lifecycle', async () => {
    const { svc } = harness();
    await svc.update('b1', { is_default: true }, ctx);
    expect(lifecycle.updateBoardCore).toHaveBeenCalledWith({ trx: true }, 't1', { userId: 'u1' }, 'b1', {
      is_default: true,
    });

    await svc.delete('b1', ctx);
    expect(lifecycle.deleteBoardCore).toHaveBeenCalledWith(
      { db: { root: true }, trx: { trx: true } },
      't1',
      { userId: 'u1' },
      'b1',
      { force: true, cleanupItil: false }
    );
  });

  it('answers a refused board shape with a validation error, not a server fault', async () => {
    const { svc } = harness();
    const refusal = Object.assign(new Error('mixed kinds'), { code: 'BOARD_LIFECYCLE_REFUSED' });
    lifecycle.createBoardCore.mockRejectedValueOnce(refusal);
    await expect(svc.create({ board_name: 'X' }, ctx)).rejects.toMatchObject({ statusCode: 400 });
  });
});
