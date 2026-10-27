import { beforeEach, describe, expect, it, vi } from 'vitest';

type Statement = { conn: 'trx' | 'base'; table: string; op: string; where?: unknown };

const state = vi.hoisted(() => ({
  statements: [] as Array<{ conn: 'trx' | 'base'; table: string; op: string; where?: unknown }>,
  outcomes: [] as string[],
  existingItem: { tenant: 'tenant-1', checklist_item_id: 'item-1', ticket_id: 'ticket-1' } as any,
  deletedRows: 1,
  deleteError: null as Error | null,
}));

const makeConn = (label: 'trx' | 'base') => ({ label });

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: any) => async (...args: any[]) =>
    action({ user_id: 'user-1', user_type: 'internal', tenant: 'tenant-1' }, { tenant: 'tenant-1' }, ...args),
  hasPermission: async () => true,
}));

vi.mock('@alga-psa/shared/lib/ticketActivity', () => ({
  TICKET_ACTIVITY_ACTOR: {},
  TICKET_ACTIVITY_ENTITY: {},
  TICKET_ACTIVITY_EVENT: {},
  TICKET_ACTIVITY_SOURCE: {},
  writeTicketActivity: vi.fn(),
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async () => ({ knex: makeConn('base') }),
  // Runs the callback against a recording trx and records commit/rollback.
  withTransaction: async (_db: any, work: (trx: any) => Promise<any>) => {
    const trx = makeConn('trx');
    try {
      const result = await work(trx);
      state.outcomes.push('commit');
      return result;
    } catch (error) {
      state.outcomes.push('rollback');
      throw error;
    }
  },
  tenantDb: (conn: { label: 'trx' | 'base' }, tenant: string) => ({
    table: (table: string) => {
      const record = (op: string, where?: unknown) => {
        if (conn.label === 'base') {
          throw new Error(`base connection queried: ${op} on ${table}`);
        }
        state.statements.push({ conn: conn.label, table, op, where: { tenant, ...(where as object) } });
      };
      let where: unknown;
      const builder: any = {
        where: (w: unknown) => {
          where = w;
          return builder;
        },
        forUpdate: () => {
          record('forUpdate', where);
          return builder;
        },
        // Honours the effective predicate (the tenantDb scope plus the caller's
        // where): the row comes back only if every key matches it.
        first: async () => {
          const predicate: Record<string, unknown> = { tenant, ...(where as object) };
          const row = state.existingItem;
          return row && Object.entries(predicate).every(([k, v]) => row[k] === v) ? row : undefined;
        },
        del: async () => {
          record('del', where);
          if (state.deleteError) throw state.deleteError;
          return state.deletedRows;
        },
      };
      return builder;
    },
  }),
}));

describe('deleteChecklistItem transaction boundary', () => {
  beforeEach(() => {
    state.statements = [];
    state.outcomes = [];
    state.existingItem = { tenant: 'tenant-1', checklist_item_id: 'item-1', ticket_id: 'ticket-1' };
    state.deletedRows = 1;
    state.deleteError = null;
  });

  it('A5(i): guard read and delete both run on the trx, scoped by ticket and item', async () => {
    const { deleteChecklistItem } = await import('./ticketChecklistActions');
    const result = await deleteChecklistItem('item-1');

    expect(result).toBeUndefined();
    expect(state.statements.map((s: Statement) => [s.conn, s.op])).toEqual([
      ['trx', 'forUpdate'],
      ['trx', 'del'],
    ]);
    expect(state.statements[0].where).toEqual({ tenant: 'tenant-1', checklist_item_id: 'item-1' });
    expect(state.statements[1].where).toMatchObject({ tenant: 'tenant-1', ticket_id: 'ticket-1', checklist_item_id: 'item-1' });
    expect(state.outcomes).toEqual(['commit']);
  });

  it('A5(ii): a zero-row delete returns the not-found error', async () => {
    state.deletedRows = 0;
    const { deleteChecklistItem } = await import('./ticketChecklistActions');
    const result: any = await deleteChecklistItem('item-1');

    expect(result).toMatchObject({ actionError: 'Checklist item not found' });
    expect(state.outcomes).toEqual(['rollback']);
  });

  it('A5(ii): a missing item returns the not-found error without deleting', async () => {
    state.existingItem = undefined;
    const { deleteChecklistItem } = await import('./ticketChecklistActions');
    const result: any = await deleteChecklistItem('item-1');

    expect(result).toMatchObject({ actionError: 'Checklist item not found' });
    expect(state.statements.map((s: Statement) => s.op)).toEqual(['forUpdate']);
  });

  it('A5(ii): the guard read is tenant-scoped, so another tenant\'s item is not found and not deleted', async () => {
    state.existingItem = { tenant: 'tenant-2', checklist_item_id: 'item-1', ticket_id: 'ticket-1' };
    const { deleteChecklistItem } = await import('./ticketChecklistActions');
    const result: any = await deleteChecklistItem('item-1');

    expect(result).toMatchObject({ actionError: 'Checklist item not found' });
    expect(state.statements.map((s: Statement) => s.op)).toEqual(['forUpdate']);
  });

  it('A5(iii): when the delete throws, the transaction rolls back and the error propagates', async () => {
    state.deleteError = new Error('boom');
    const { deleteChecklistItem } = await import('./ticketChecklistActions');

    await expect(deleteChecklistItem('item-1')).rejects.toThrow('boom');
    expect(state.outcomes).toEqual(['rollback']);
  });
});
