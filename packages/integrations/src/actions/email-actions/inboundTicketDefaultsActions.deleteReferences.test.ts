import { beforeEach, describe, expect, it, vi } from 'vitest';

let knexImpl: any;

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => fn,
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: knexImpl })),
}));

type DeletePlan = {
  hasClientsDestinationColumn?: boolean;
  hasContactsDestinationColumn?: boolean;
  deleteResult?: number;
};

function createDeleteHarness(plan: DeletePlan) {
  const calls: Array<{
    table: string;
    op: 'update' | 'delete';
    where: Record<string, unknown>;
  }> = [];

  const trxFn = (table: string) => {
    let whereClause: Record<string, unknown> = {};
    const builder: any = {
      where: vi.fn((value: Record<string, unknown>) => {
        whereClause = value ?? {};
        return builder;
      }),
      update: vi.fn(async () => {
        calls.push({ table, op: 'update', where: whereClause });
        return 1;
      }),
      delete: vi.fn(async () => {
        calls.push({ table, op: 'delete', where: whereClause });
        return plan.deleteResult ?? 1;
      }),
    };
    return builder;
  };

  const trx: any = Object.assign(trxFn, {
    fn: { now: () => 'now()' },
    schema: {
      hasColumn: vi.fn(async (table: string, column: string) => {
        if (column !== 'inbound_ticket_defaults_id') return false;
        if (table === 'clients') return plan.hasClientsDestinationColumn ?? true;
        if (table === 'contacts') return plan.hasContactsDestinationColumn ?? true;
        return false;
      }),
    },
  });

  const knex = {
    transaction: vi.fn(async (callback: (trx: any) => Promise<any>) => callback(trx)),
  };

  return { knex, calls };
}

describe('deleteInboundTicketDefaults reference clearing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('clears provider/client/contact references before deleting defaults row', async () => {
    const { knex, calls } = createDeleteHarness({
      hasClientsDestinationColumn: true,
      hasContactsDestinationColumn: true,
      deleteResult: 1,
    });
    knexImpl = knex;

    const { deleteInboundTicketDefaults } = await import('./inboundTicketDefaultsActions');
    await deleteInboundTicketDefaults(
      { user_id: 'user-1' } as any,
      { tenant: 'tenant-1' } as any,
      'defaults-1'
    );

    expect(calls).toEqual(
      expect.arrayContaining([
        {
          table: 'email_providers',
          op: 'update',
          where: { tenant: 'tenant-1', inbound_ticket_defaults_id: 'defaults-1' },
        },
        {
          table: 'clients',
          op: 'update',
          where: { tenant: 'tenant-1', inbound_ticket_defaults_id: 'defaults-1' },
        },
        {
          table: 'contacts',
          op: 'update',
          where: { tenant: 'tenant-1', inbound_ticket_defaults_id: 'defaults-1' },
        },
        {
          table: 'inbound_ticket_defaults',
          op: 'delete',
          where: { id: 'defaults-1', tenant: 'tenant-1' },
        },
      ])
    );
  });

  it('throws when defaults row is not found after reference clearing', async () => {
    const { knex } = createDeleteHarness({
      hasClientsDestinationColumn: true,
      hasContactsDestinationColumn: true,
      deleteResult: 0,
    });
    knexImpl = knex;

    const { deleteInboundTicketDefaults } = await import('./inboundTicketDefaultsActions');
    await expect(
      deleteInboundTicketDefaults(
        { user_id: 'user-1' } as any,
        { tenant: 'tenant-1' } as any,
        'missing-defaults'
      )
    ).rejects.toThrow('Defaults configuration not found');
  });
});
