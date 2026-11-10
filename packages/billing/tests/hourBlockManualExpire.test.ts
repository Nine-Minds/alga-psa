import { beforeEach, describe, expect, it, vi } from 'vitest';

// manuallyExpireHourBlock: settles a missing or future expiration_date to
// today (an elapsed one is kept), flips the block to expired, and records both
// dates in the audit metadata. Mocked DB; no network.

const state = vi.hoisted(() => ({
  block: null as any,
  updates: [] as Array<{ table: string; values: any }>,
  inserts: [] as Array<{ table: string; values: any }>,
  returnNoRow: false,
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => (...args: any[]) => fn({ user_id: 'u1' }, { tenant: 't1' }, ...args),
  getSession: vi.fn(),
}));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: vi.fn(async () => true) }));
vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createTenantKnex: vi.fn(async () => ({ knex: {} })),
  withTransaction: vi.fn(async (_knex: any, cb: (trx: any) => Promise<unknown>) => cb({})),
  tenantDb: vi.fn(() => ({
    table: (table: string) => {
      let pending: any = null;
      const qb: any = {
        where: () => qb,
        forUpdate: () => qb,
        first: async () => state.block,
        update: (values: any) => {
          pending = values;
          state.updates.push({ table, values });
          return qb;
        },
        returning: async () => (state.returnNoRow ? [] : [{ ...state.block, ...pending }]),
        insert: async (values: any) => {
          state.inserts.push({ table, values });
        },
      };
      return qb;
    },
  })),
}));

import { manuallyExpireHourBlock } from '../src/actions/hourBlockActions';

const expire = manuallyExpireHourBlock as unknown as (blockId: string, reason: string) => Promise<any>;

function isoDaysFromToday(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const today = () => new Date().toISOString().slice(0, 10);

function activeBlock(expiration_date: string | null) {
  return { block_id: 'b1', status: 'active', remaining_minutes: 210, expiration_date };
}

function auditRow() {
  return state.inserts.find((i) => i.table === 'hour_block_audit')?.values;
}

beforeEach(() => {
  state.block = null;
  state.updates = [];
  state.inserts = [];
  state.returnNoRow = false;
});

describe('manuallyExpireHourBlock', () => {
  it('settles a future expiration date to today and records the original in the audit', async () => {
    const future = isoDaysFromToday(30);
    state.block = activeBlock(future);

    const result = await expire('b1', 'client cancelled');

    expect(result.status).toBe('expired');
    expect(result.expiration_date).toBe(today());
    expect(state.updates).toHaveLength(1);
    expect(state.updates[0].values).toMatchObject({ status: 'expired', expiration_date: today() });

    const audit = auditRow();
    expect(audit).toMatchObject({ type: 'manual_expiration', block_id: 'b1', reason: 'client cancelled' });
    expect(audit.metadata).toEqual({
      remaining_minutes_at_expiration: 210,
      previous_expiration_date: future,
      new_expiration_date: today(),
      expiration_date_settled_for_reporting: true,
    });
  });

  it('keeps an already-elapsed expiration date', async () => {
    const past = isoDaysFromToday(-10);
    state.block = activeBlock(past);

    const result = await expire('b1', 'cleanup');

    expect(result.expiration_date).toBe(past);
    expect(auditRow().metadata).toMatchObject({
      previous_expiration_date: past,
      new_expiration_date: past,
      expiration_date_settled_for_reporting: false,
    });
  });

  it('stamps today when the block has no expiration date', async () => {
    state.block = activeBlock(null);

    const result = await expire('b1', 'cleanup');

    expect(result.expiration_date).toBe(today());
    expect(auditRow().metadata).toMatchObject({
      previous_expiration_date: null,
      new_expiration_date: today(),
      expiration_date_settled_for_reporting: true,
    });
  });

  it('refuses a voided block and writes nothing', async () => {
    state.block = { ...activeBlock(null), status: 'voided' };

    await expect(expire('b1', 'cleanup')).resolves.toMatchObject({
      messageKey: 'msp/hour-blocks:errors.block.expireVoided',
    });
    expect(state.updates).toHaveLength(0);
    expect(state.inserts).toHaveLength(0);
  });

  it('refuses a pending block and writes nothing', async () => {
    state.block = { ...activeBlock(null), status: 'pending' };

    await expect(expire('b1', 'cleanup')).rejects.toThrow(/pending hour block/);
    expect(state.updates).toHaveLength(0);
    expect(state.inserts).toHaveLength(0);
  });

  it('fails instead of auditing when the update returns no row', async () => {
    state.block = activeBlock(null);
    state.returnNoRow = true;

    await expect(expire('b1', 'cleanup')).rejects.toThrow(/could not be expired/);
    expect(state.inserts).toHaveLength(0);
  });

  it('requires a reason', async () => {
    state.block = activeBlock(null);

    await expect(expire('b1', '   ')).resolves.toMatchObject({
      messageKey: 'msp/hour-blocks:errors.block.reasonRequired',
    });
    expect(state.updates).toHaveLength(0);
  });
});
