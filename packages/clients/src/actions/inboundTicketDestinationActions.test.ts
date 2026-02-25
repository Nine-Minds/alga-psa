import { beforeEach, describe, expect, it, vi } from 'vitest';

const hasPermissionAsyncMock = vi.fn();
const createTenantKnexMock = vi.fn(async () => ({ knex: {} as any }));
const withTransactionMock = vi.fn();
let trxImpl: any = null;

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => fn,
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: (...args: any[]) => createTenantKnexMock(...args),
  withTransaction: (...args: any[]) => withTransactionMock(...args),
}));

vi.mock('../lib/authHelpers', () => ({
  hasPermissionAsync: (...args: any[]) => hasPermissionAsyncMock(...args),
}));

type TrxPlan = {
  clientExists?: boolean;
  contactExists?: boolean;
  destinationInTenant?: boolean;
  returnedDefaultsId?: string | null;
};

function createTrx(plan: TrxPlan) {
  const calls: Array<{ table: string; op: string; where?: Record<string, unknown> }> = [];

  const trx = (table: string) => {
    let whereClause: Record<string, unknown> = {};
    let updatedDefaultsId: string | null = plan.returnedDefaultsId ?? null;
    const builder: any = {
      select: vi.fn(() => builder),
      where: vi.fn((value: Record<string, unknown>) => {
        whereClause = value ?? {};
        return builder;
      }),
      first: vi.fn(async () => {
        calls.push({ table, op: 'first', where: whereClause });

        if (table === 'clients' && Object.prototype.hasOwnProperty.call(whereClause, 'client_id')) {
          return plan.clientExists ? { client_id: whereClause.client_id } : null;
        }

        if (table === 'contacts' && Object.prototype.hasOwnProperty.call(whereClause, 'contact_name_id')) {
          return plan.contactExists ? { contact_name_id: whereClause.contact_name_id } : null;
        }

        if (table === 'inbound_ticket_defaults') {
          return plan.destinationInTenant ? { id: whereClause.id } : null;
        }

        return null;
      }),
      update: vi.fn((value: { inbound_ticket_defaults_id?: string | null }) => {
        updatedDefaultsId = value?.inbound_ticket_defaults_id ?? null;
        return builder;
      }),
      returning: vi.fn(async () => {
        calls.push({ table, op: 'returning', where: whereClause });
        return [{ inbound_ticket_defaults_id: updatedDefaultsId }];
      }),
    };

    return builder;
  };

  return { trx, calls };
}

describe('inboundTicketDestinationActions permissions and tenant scoping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    withTransactionMock.mockImplementation(async (_knex: any, callback: (trx: any) => Promise<any>) =>
      callback(trxImpl)
    );
  });

  it('T023: updateClientInboundTicketDestination enforces client update permission', async () => {
    hasPermissionAsyncMock.mockResolvedValue(false);

    const { updateClientInboundTicketDestination } = await import('./inboundTicketDestinationActions');
    await expect(
      updateClientInboundTicketDestination(
        { user_id: 'user-1' } as any,
        { tenant: 'tenant-1' } as any,
        'client-1',
        'defaults-1'
      )
    ).rejects.toThrow('Permission denied: Cannot update clients');

    expect(createTenantKnexMock).not.toHaveBeenCalled();
  });

  it('T023: updateClientInboundTicketDestination validates destination tenant scoping', async () => {
    hasPermissionAsyncMock.mockResolvedValue(true);
    const { trx, calls } = createTrx({
      clientExists: true,
      destinationInTenant: false,
    });
    trxImpl = trx;

    const { updateClientInboundTicketDestination } = await import('./inboundTicketDestinationActions');
    await expect(
      updateClientInboundTicketDestination(
        { user_id: 'user-1' } as any,
        { tenant: 'tenant-1' } as any,
        'client-1',
        'defaults-foreign'
      )
    ).rejects.toThrow('Inbound ticket destination was not found for this tenant');

    expect(calls.some((entry) => entry.table === 'inbound_ticket_defaults' && entry.op === 'first')).toBe(true);
    expect(calls.some((entry) => entry.table === 'clients' && entry.op === 'returning')).toBe(false);
  });

  it('T024: updateContactInboundTicketDestination enforces contact update permission', async () => {
    hasPermissionAsyncMock.mockResolvedValue(false);

    const { updateContactInboundTicketDestination } = await import('./inboundTicketDestinationActions');
    await expect(
      updateContactInboundTicketDestination(
        { user_id: 'user-1' } as any,
        { tenant: 'tenant-1' } as any,
        'contact-1',
        'defaults-1'
      )
    ).rejects.toThrow('Permission denied: Cannot update contacts');

    expect(createTenantKnexMock).not.toHaveBeenCalled();
  });

  it('T024: updateContactInboundTicketDestination validates destination tenant scoping', async () => {
    hasPermissionAsyncMock.mockResolvedValue(true);
    const { trx, calls } = createTrx({
      contactExists: true,
      destinationInTenant: false,
    });
    trxImpl = trx;

    const { updateContactInboundTicketDestination } = await import('./inboundTicketDestinationActions');
    await expect(
      updateContactInboundTicketDestination(
        { user_id: 'user-1' } as any,
        { tenant: 'tenant-1' } as any,
        'contact-1',
        'defaults-foreign'
      )
    ).rejects.toThrow('Inbound ticket destination was not found for this tenant');

    expect(calls.some((entry) => entry.table === 'inbound_ticket_defaults' && entry.op === 'first')).toBe(true);
    expect(calls.some((entry) => entry.table === 'contacts' && entry.op === 'returning')).toBe(false);
  });
});
