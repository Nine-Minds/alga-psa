/**
 * BoardService must not let a direct caller mass-assign tenant/board_id, and
 * claiming is_default must release the previous default.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('server/src/lib/eventBus/publishers', () => ({ publishEvent: vi.fn(async () => {}) }));

const { BoardService } = await import('@/lib/api/services/BoardService');

function harness() {
  const ops: Array<{ op: string; where?: unknown; whereNot?: unknown; payload?: unknown }> = [];
  const query = (): any => {
    const entry: any = { op: 'query' };
    const q: any = {
      where: (w: unknown) => { entry.where = w; return q; },
      whereNot: (w: unknown) => { entry.whereNot = w; return q; },
      update: (p: unknown) => { entry.op = 'update'; entry.payload = p; ops.push(entry); return q; },
      insert: (p: unknown) => { entry.op = 'insert'; entry.payload = p; ops.push(entry); return q; },
      returning: async () => [{ board_id: 'b1', ...(entry.payload as object) }],
      then: (res: any) => res(undefined),
    };
    return q;
  };
  const svc: any = new BoardService();
  svc.mutationTransaction = async (_c: unknown, work: any) => work({}, 't1');
  svc.buildTenantScopedQuery = () => query();
  svc.addCreateAuditFields = async (_t: unknown, d: object) => ({ ...d, tenant: 't1' });
  svc.addUpdateAuditFields = async (_t: unknown, d: object) => d;
  return { svc, ops };
}
const ctx: any = { tenant: 't1', userId: 'u1' };

describe('BoardService writable projection', () => {
  it.each([['tenant', { tenant: 'other' }], ['board_id', { board_id: 'x' }], ['made-up', { nope: 1 }]])(
    'rejects %s on create and update before any write',
    async (_l, extra) => {
      const { svc, ops } = harness();
      await expect(svc.create({ board_name: 'X', ...extra }, ctx)).rejects.toThrow('Invalid board input');
      await expect(svc.update('b1', { board_name: 'X', ...extra }, ctx)).rejects.toThrow('Invalid board input');
      expect(ops).toEqual([]);
    }
  );

  it('releases the existing default before inserting a new default board', async () => {
    const { svc, ops } = harness();
    await svc.create({ board_name: 'X', is_default: true }, ctx);
    expect(ops.map((o) => o.op)).toEqual(['update', 'insert']);
    expect(ops[0]).toMatchObject({ where: { is_default: true }, payload: { is_default: false } });
  });

  it('releases other defaults (not the board itself) when update claims default', async () => {
    const { svc, ops } = harness();
    await svc.update('b1', { is_default: true }, ctx);
    expect(ops[0]).toMatchObject({ where: { is_default: true }, whereNot: { board_id: 'b1' }, payload: { is_default: false } });
  });
});
