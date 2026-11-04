import { beforeEach, describe, expect, it, vi } from 'vitest';

const WRITE_OPS = new Set(['insert', 'update', 'del']);

const state = vi.hoisted(() => ({
  statements: [] as Array<{ conn: string; table: string; op: string }>,
  user: { user_id: 'user-1', user_type: 'client', tenant: 'tenant-1' } as any,
  items: {} as Record<string, any>,
  allow: true,
  authCalls: [] as any[],
}));

const REFUSAL = 'Permission denied: Cannot access ticket';

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: any) => async (...args: any[]) => action(state.user, { tenant: 'tenant-1' }, ...args),
  hasPermission: async () => true,
}));

vi.mock('@alga-psa/shared/lib/ticketActivity', () => ({
  TICKET_ACTIVITY_ACTOR: {},
  TICKET_ACTIVITY_ENTITY: {},
  TICKET_ACTIVITY_EVENT: {},
  TICKET_ACTIVITY_SOURCE: {},
  writeTicketActivity: vi.fn(async () => {
    state.statements.push({ conn: 'trx', table: 'ticket_activity', op: 'insert' });
  }),
}));

vi.mock('../../lib/ticketRecordAuthorization', () => ({
  authorizeTicketRecordAccessConcealed: vi.fn(async (input: any) => {
    state.authCalls.push({ conn: input.trx.label, ticketId: input.ticketId, action: input.action, tenant: input.tenant });
    if (!state.allow) throw new Error('Permission denied: Cannot access ticket');
    return { ticket_id: input.ticketId };
  }),
}));

vi.mock('@alga-psa/db', () => {
  const makeConn = (label: string) => ({ label, fn: { now: () => 'now' } });
  return {
    createTenantKnex: async () => ({ knex: { ...makeConn('base'), raw: () => '' } }),
    withTransaction: async (_db: any, work: any) => work(makeConn('trx')),
    tenantDb: (conn: any, tenant: string) => ({
      table: (table: string) => {
        let where: any = {};
        const rec = (op: string) => state.statements.push({ conn: conn.label, table, op });
        const b: any = {
          where: (w: any) => { where = w; return b; },
          max: () => b,
          forUpdate: () => b,
          first: async () => {
            rec('first');
            const id = where.checklist_item_id;
            return id ? state.items[id] : { max: 1 };
          },
          insert: (row: any) => { rec('insert'); return { returning: async () => [row] }; },
          update: (u: any) => { rec('update'); const p: any = Promise.resolve(1); p.returning = async () => [{ ...u }]; return p; },
          del: async () => { rec('del'); return 1; },
          orderBy: () => b,
          select: async () => { rec('select'); return [{ checklist_item_id: 'item-1' }]; },
        };
        return b;
      },
      tenantJoin: (base: any) => base,
    }),
  };
});

const mod = () => import('./ticketChecklistActions');

// Args per exported mutation. Anything exported that is not listed here and
// not a known read fails the "every export is covered" check below.
const MUTATION_ARGS: Record<string, any[]> = {
  addChecklistItem: ['ticket-1', { item_name: 'x' }],
  updateChecklistItem: ['item-1', { item_name: 'y' }],
  deleteChecklistItem: ['item-1'],
  reorderChecklistItems: ['ticket-1', ['item-1']],
  setChecklistItemCompleted: ['item-1', true],
};
const ITEM_MUTATIONS = ['updateChecklistItem', 'deleteChecklistItem', 'setChecklistItemCompleted'];
const writes = () => state.statements.filter((s) => WRITE_OPS.has(s.op));

describe('checklist record-level authorization', () => {
  beforeEach(() => {
    state.statements = [];
    state.authCalls = [];
    state.allow = true;
    state.user = { user_id: 'user-1', user_type: 'client', tenant: 'tenant-1' };
    state.items = { 'item-1': { checklist_item_id: 'item-1', ticket_id: 'ticket-owner', tenant: 'tenant-1', completed: false } };
  });

  it('covers every exported action', async () => {
    const m: any = await mod();
    const names = Object.keys(m).filter((k) => typeof m[k] === 'function');
    expect(names.sort()).toEqual([...Object.keys(MUTATION_ARGS), 'getTicketChecklistItems'].sort());
  });

  it('client without access: read returns [] and queries no checklist rows', async () => {
    state.allow = false;
    const { getTicketChecklistItems } = await mod();
    expect(await getTicketChecklistItems('ticket-1')).toEqual([]);
    expect(state.statements.filter((s) => s.table === 'ticket_checklist_items')).toEqual([]);
  });

  describe.each(Object.keys(MUTATION_ARGS))('%s', (name) => {
    it('client without access is refused concealed with no write', async () => {
      state.allow = false;
      const m: any = await mod();
      const result = await m[name](...MUTATION_ARGS[name]);
      expect(result).toMatchObject({ permissionError: REFUSAL });
      expect(writes()).toEqual([]);
    });

    it('client with access succeeds', async () => {
      const m: any = await mod();
      const result = await m[name](...MUTATION_ARGS[name]);
      expect(result === undefined || !('permissionError' in result || 'actionError' in result)).toBe(true);
      expect(writes().length).toBeGreaterThan(0);
    });

    it('internal user with access is unaffected', async () => {
      state.user = { ...state.user, user_type: 'internal' };
      const m: any = await mod();
      const result = await m[name](...MUTATION_ARGS[name]);
      expect(result === undefined || !('permissionError' in result || 'actionError' in result)).toBe(true);
    });
  });

  describe.each(ITEM_MUTATIONS)('%s with a missing item', (name) => {
    it('client gets the same refusal as a hidden item, no write', async () => {
      state.items = {};
      const m: any = await mod();
      const missing = await m[name](...MUTATION_ARGS[name]);
      state.items = { 'item-1': { checklist_item_id: 'item-1', ticket_id: 'ticket-owner', tenant: 'tenant-1' } };
      state.allow = false;
      const hidden = await m[name](...MUTATION_ARGS[name]);
      expect(missing).toEqual(hidden);
      expect(missing).toMatchObject({ permissionError: REFUSAL });
      expect(writes()).toEqual([]);
    });

    it('internal user keeps the not-found report', async () => {
      state.items = {};
      state.user = { ...state.user, user_type: 'internal' };
      const m: any = await mod();
      expect(await m[name](...MUTATION_ARGS[name])).toMatchObject({ actionError: 'Checklist item not found' });
    });
  });

  it('item mutations authorize the OWNING ticket with action update on the trx', async () => {
    const m: any = await mod();
    for (const name of ITEM_MUTATIONS) {
      state.authCalls = [];
      await m[name](...MUTATION_ARGS[name]);
      expect(state.authCalls).toEqual([{ conn: 'trx', ticketId: 'ticket-owner', action: 'update', tenant: 'tenant-1' }]);
    }
  });

  it('ticket-id mutations and reads authorize the given ticket with the right action', async () => {
    const m: any = await mod();
    for (const name of ['addChecklistItem', 'reorderChecklistItems']) {
      state.authCalls = [];
      await m[name](...MUTATION_ARGS[name]);
      expect(state.authCalls).toEqual([{ conn: 'trx', ticketId: 'ticket-1', action: 'update', tenant: 'tenant-1' }]);
    }
    state.authCalls = [];
    expect(await m.getTicketChecklistItems('ticket-1')).toHaveLength(1);
    expect(state.authCalls).toEqual([{ conn: 'trx', ticketId: 'ticket-1', action: 'read', tenant: 'tenant-1' }]);
  });
});
