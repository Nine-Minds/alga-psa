import { beforeEach, describe, expect, it, vi } from 'vitest';

// Server-side guards for contract-issued (Prepaid Block line) hour blocks:
// voidHourBlock refuses them (void goes through the invoice) and grantHourBlock
// refuses to mint a block owned by a contract line. Mocked DB; no network.

const state = vi.hoisted(() => ({ block: null as any, writes: 0 }));

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
    table: () => {
      const qb: any = {
        where: () => qb,
        forUpdate: () => qb,
        first: async () => state.block,
        update: async () => { state.writes += 1; },
        insert: async () => { state.writes += 1; },
      };
      return qb;
    },
  })),
}));

import { voidHourBlock, grantHourBlock } from '../src/actions/hourBlockActions';

beforeEach(() => {
  state.block = null;
  state.writes = 0;
});

describe('contract hour block guards', () => {
  it('voidHourBlock refuses a contract-issued block and writes nothing', async () => {
    state.block = { block_id: 'b1', status: 'active', source_type: 'contract', contract_line_id: 'L1' };
    await expect((voidHourBlock as any)('b1', 'because')).rejects.toThrow(
      /void or delete the invoice that issued the block/,
    );
    expect(state.writes).toBe(0);
  });

  it('voidHourBlock also refuses on contract_line_id alone', async () => {
    state.block = { block_id: 'b1', status: 'pending', source_type: 'purchase', contract_line_id: 'L1' };
    await expect((voidHourBlock as any)('b1', 'because')).rejects.toThrow(
      /Contract prepaid blocks cannot be voided/,
    );
  });

  it('grantHourBlock refuses an input that targets a contract line', async () => {
    await expect(
      (grantHourBlock as any)({
        clientId: 'c1', serviceId: 's1', hours: 5, reason: 'comp', contractLineId: 'L1',
      }),
    ).rejects.toThrow(/cannot be granted/);
    expect(state.writes).toBe(0);
  });
});
