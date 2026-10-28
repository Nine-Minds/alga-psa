import { beforeEach, describe, expect, it, vi } from 'vitest';

let knexImpl: any;

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => (...args: any[]) =>
    fn({ user_id: 'user-1' }, { tenant: 'tenant-1' }, ...args),
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: vi.fn(async () => ({ knex: knexImpl })),
  // The harness builder's `.where` overwrites its recorded clause, and the
  // assertions expect tenant to be merged into the production `.where({...})`,
  // so fold the tenant in when the scoped builder's `.where` is first called.
  tenantDb: (conn: any, tenant: string) => ({
    table: (table: string) => {
      const builder = conn(table);
      const originalWhere = builder.where.bind(builder);
      builder.where = (value: Record<string, unknown>) => originalWhere({ tenant, ...value });
      return builder;
    },
    unscoped: (table: string) => conn(table),
  }),
}));

type DeletePlan = {
  hasClientsDestinationColumn?: boolean;
  hasContactsDestinationColumn?: boolean;
  deleteResult?: number;
  referencingProviders?: Array<{ provider_name: string | null; mailbox: string | null }>;
};

function createDeleteHarness(plan: DeletePlan) {
  const calls: Array<{
    table: string;
    op: 'select' | 'update' | 'delete';
    where: Record<string, unknown>;
  }> = [];

  const trxFn = (table: string) => {
    let whereClause: Record<string, unknown> = {};
    const builder: any = {
      where: vi.fn((value: Record<string, unknown>) => {
        whereClause = value ?? {};
        return builder;
      }),
      select: vi.fn(async () => {
        calls.push({ table, op: 'select', where: whereClause });
        return table === 'email_providers' ? plan.referencingProviders ?? [] : [];
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

  it('clears client/contact references before deleting an unreferenced defaults row', async () => {
    const { knex, calls } = createDeleteHarness({
      hasClientsDestinationColumn: true,
      hasContactsDestinationColumn: true,
      deleteResult: 1,
    });
    knexImpl = knex;

    const { deleteInboundTicketDefaults } = await import('./inboundTicketDefaultsActions');
    await expect(deleteInboundTicketDefaults('defaults-1')).resolves.toEqual({ success: true });

    expect(calls).toEqual(
      expect.arrayContaining([
        {
          table: 'email_providers',
          op: 'select',
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

  it('refuses to delete defaults that an email provider still routes through', async () => {
    const { knex, calls } = createDeleteHarness({
      referencingProviders: [
        { provider_name: 'Support Mailbox', mailbox: 'support@example.com' },
        { provider_name: null, mailbox: 'help@example.com' },
      ],
    });
    knexImpl = knex;

    const { deleteInboundTicketDefaults } = await import('./inboundTicketDefaultsActions');
    await expect(deleteInboundTicketDefaults('defaults-1')).resolves.toEqual({
      actionError:
        'This configuration is still used by the following email providers: Support Mailbox, help@example.com. Select different inbound ticket defaults on those providers before deleting it.',
      messageKey: 'msp/email-providers:errors.inboundDefaults.referencedByProviders',
      messageParams: { providers: 'Support Mailbox, help@example.com' },
    });

    // Nothing is cleared or deleted when the delete is refused.
    expect(calls.filter((call) => call.op !== 'select')).toEqual([]);
    expect(calls.some((call) => call.table === 'email_providers' && call.op === 'update')).toBe(false);
  });

  it('returns an action error when defaults row is not found after reference clearing', async () => {
    const { knex } = createDeleteHarness({
      hasClientsDestinationColumn: true,
      hasContactsDestinationColumn: true,
      deleteResult: 0,
    });
    knexImpl = knex;

    const { deleteInboundTicketDefaults } = await import('./inboundTicketDefaultsActions');
    await expect(deleteInboundTicketDefaults('missing-defaults')).resolves.toEqual({
      actionError: 'Defaults configuration not found',
      messageKey: 'msp/email-providers:errors.inboundDefaults.notFound',
    });
  });
});
