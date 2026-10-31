import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * TicketService.update(..., { authorize }) must run the hook inside the transaction, on the
 * locked row, before any write. When the hook throws, no UPDATE is issued, so assigned_to and
 * ticket_resources are untouched (the transaction callback rejects and rolls back).
 * No Postgres is needed: the transaction is faked and every write is recorded.
 */

const state = vi.hoisted(() => ({
  ops: [] as string[],
  row: { ticket_id: 't1', tenant: 'tenant-1', assigned_to: 'old-user', status_id: 's1' } as Record<string, any>,
  committed: true,
}));

vi.mock('@alga-psa/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/db')>();
  const builder = (table: string) => {
    const b: any = {
      where: () => b,
      whereIn: () => b,
      forUpdate: () => { state.ops.push(`lock:${table}`); return b; },
      first: async () => { state.ops.push(`read:${table}`); return table === 'tickets' ? { ...state.row } : null; },
      update: (patch: any) => { state.ops.push(`write:${table}`); Object.assign(state.row, patch); return b; },
      delete: async () => { state.ops.push(`delete:${table}`); },
      del: async () => { state.ops.push(`delete:${table}`); },
      insert: async () => { state.ops.push(`insert:${table}`); },
      returning: async () => [state.row],
    };
    return b;
  };
  return {
    ...actual,
    withTransaction: vi.fn(async (_knex: unknown, cb: (trx: unknown) => Promise<unknown>) => {
      const snapshot = { ...state.row };
      try {
        return await cb({});
      } catch (e) {
        state.row = snapshot; // rollback
        throw e;
      }
    }),
    tenantDb: vi.fn(() => ({ table: (t: string) => builder(t), scoped: (t: string) => builder(t) })),
  };
});

import { TicketService } from '../../../lib/api/services/TicketService';

describe('TicketService.update authorize hook', () => {
  beforeEach(() => {
    state.ops = [];
    state.row = { ticket_id: 't1', tenant: 'tenant-1', assigned_to: 'old-user', status_id: 's1' };
  });

  it('runs on the locked row before any write, and a throw leaves assigned_to unchanged with no writes', async () => {
    const service = new TicketService() as any;
    service.getKnex = async () => ({ knex: {} });
    const authorize = vi.fn(async (ticket: Record<string, any>) => {
      state.ops.push('authorize');
      expect(ticket.assigned_to).toBe('old-user');
      throw new Error('denied');
    });

    await expect(
      service.update('t1', { assigned_to: 'new-user' }, { tenant: 'tenant-1', userId: 'u1' }, { authorize })
    ).rejects.toThrow('denied');

    expect(authorize).toHaveBeenCalledTimes(1);
    expect(state.ops).toContain('lock:tickets');
    expect(state.ops.indexOf('lock:tickets')).toBeLessThan(state.ops.indexOf('authorize'));
    expect(state.ops.filter((o) => o.startsWith('write:') || o.startsWith('delete:') || o.startsWith('insert:'))).toEqual([]);
    expect(state.row.assigned_to).toBe('old-user');
  });
});
