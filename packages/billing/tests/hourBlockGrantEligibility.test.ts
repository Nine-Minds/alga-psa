import { beforeEach, describe, expect, it, vi } from 'vitest';

// grantHourBlock must enforce the same hourly-only service rule as the sell path,
// so a direct action call cannot mint a block against a fixed/usage service.

const state = vi.hoisted(() => ({
  rows: {} as Record<string, unknown>,
  writes: [] as string[],
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
      const qb: any = {
        where: () => qb,
        whereIn: () => qb,
        forUpdate: () => qb,
        first: async () => state.rows[name],
        update: async () => { state.writes.push(name); },
        insert: async () => { state.writes.push(name); },
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
  it.each(['fixed', 'usage'])('rejects a %s service and writes nothing', async (billingMethod) => {
    state.rows.service_catalog = { service_id: 's1', billing_method: billingMethod };

    await expect((grantHourBlock as any)(grantInput)).rejects.toThrow(
      'Hour blocks can only be granted for hourly services',
    );
    expect(state.writes).toEqual([]);
  });

  it('rejects a missing service and writes nothing', async () => {
    const result = await (grantHourBlock as any)(grantInput);

    expect(result).toMatchObject({ actionError: expect.stringContaining('Service not found') });
    expect(state.writes).toEqual([]);
  });

  it('mints the block for an hourly service', async () => {
    state.rows.service_catalog = { service_id: 's1', billing_method: 'hourly' };

    await (grantHourBlock as any)(grantInput).catch(() => undefined);

    expect(state.writes).toContain('hour_blocks');
  });
});
