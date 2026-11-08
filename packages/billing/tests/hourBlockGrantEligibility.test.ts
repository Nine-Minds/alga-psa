import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  rows: {} as Record<string, unknown>,
  writes: [] as Array<{ table: string; row: Record<string, unknown> }>,
}));

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => (...args: any[]) => fn({ user_id: 'u1' }, { tenant: 't1' }, ...args),
  getSession: vi.fn(),
}));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: vi.fn(async () => true) }));
vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishWorkflowEvent: vi.fn(async () => undefined),
  publishEvent: vi.fn(async () => undefined),
}));
vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createTenantKnex: vi.fn(async () => ({ knex: {} })),
  withTransaction: vi.fn(async (_knex: any, cb: (trx: any) => Promise<unknown>) => cb({})),
  tenantDb: vi.fn(() => ({
    table: (name: string) => {
      const qb = {
        where: () => qb,
        whereIn: () => qb,
        forUpdate: () => qb,
        first: async () => state.rows[name],
        insert: async (row: Record<string, unknown>) => {
          state.writes.push({ table: name, row });
          state.rows[name] = row;
        },
      };
      return qb;
    },
  })),
}));

import { grantHourBlock } from '../src/actions/hourBlockActions';

const grantInput = { clientId: 'c1', serviceId: 's1', hours: 5, hourlyRate: 10000, reason: 'comp' };

beforeEach(() => {
  state.rows = { clients: { client_id: 'c1' } };
  state.writes = [];
});

describe('grantHourBlock service eligibility', () => {
  it.each(['fixed', 'usage', 'per_unit'])('rejects a %s service and writes nothing', async (billingMethod) => {
    state.rows.service_catalog = { service_id: 's1', billing_method: billingMethod };

    await expect(grantHourBlock(grantInput)).rejects.toThrow(
      'Hour blocks can only be granted for hourly services',
    );
    expect(state.writes).toEqual([]);
  });

  it('rejects a missing service and writes nothing', async () => {
    const result = await grantHourBlock(grantInput);

    expect(result).toMatchObject({ actionError: expect.stringContaining('Service not found') });
    expect(state.writes).toEqual([]);
  });

  it('mints the block for an hourly service', async () => {
    state.rows.service_catalog = { service_id: 's1', billing_method: 'hourly' };

    const result = await grantHourBlock(grantInput);

    expect(result).toMatchObject({
      block_id: expect.any(String),
      tenant: 't1',
      client_id: 'c1',
      service_id: 's1',
      total_minutes: 300,
      remaining_minutes: 300,
      hourly_rate: 10000,
      purchase_amount: 50000,
      status: 'active',
      source_type: 'grant',
    });
    expect(state.writes).toEqual([
      { table: 'hour_blocks', row: result },
      {
        table: 'hour_block_audit',
        row: expect.objectContaining({
          block_id: expect.any(String),
          tenant: 't1',
          type: 'grant',
          reason: 'comp',
          created_by: 'u1',
        }),
      },
    ]);
  });
});
