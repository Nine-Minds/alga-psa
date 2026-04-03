import { beforeEach, describe, expect, it, vi } from 'vitest';

let currentUser: any;

const createTenantKnexMock = vi.fn();
const withTransactionMock = vi.fn();

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: any) => async (...args: any[]) =>
    action(currentUser, { tenant: currentUser.tenant }, ...args),
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: (...args: any[]) => createTenantKnexMock(...args),
  withTransaction: (...args: any[]) => withTransactionMock(...args),
}));

vi.mock('next/headers.js', () => ({
  headers: vi.fn(),
}));

function buildChain(result: any) {
  const builder: any = {};
  builder.select = vi.fn(() => builder);
  builder.leftJoin = vi.fn(() => builder);
  builder.join = vi.fn(() => builder);
  builder.where = vi.fn(() => builder);
  builder.groupBy = vi.fn(() => builder);
  builder.orderBy = vi.fn(() => builder);
  builder.limit = vi.fn().mockResolvedValue(result);
  builder.first = vi.fn().mockResolvedValue(result);
  return builder;
}

function buildTrx(invoiceRows: any[]) {
  return Object.assign(
    ((table: string) => {
      if (table === 'contacts') {
        return {
          where: vi.fn(() => ({
            select: vi.fn(() => ({
              first: vi.fn().mockResolvedValue({ client_id: 'client-1' }),
            })),
          })),
        };
      }

      if (table === 'tickets') {
        return buildChain([]);
      }

      if (table === 'invoices as inv') {
        return buildChain(invoiceRows);
      }

      if (table === 'asset_maintenance_history') {
        return buildChain([]);
      }

      throw new Error(`Unexpected table: ${table}`);
    }) as any,
    {
      raw: vi.fn((sql: string) => sql),
    }
  );
}

describe('client dashboard recent invoice activity recurring periods', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentUser = {
      user_id: 'client-user-1',
      user_type: 'client',
      contact_id: 'contact-1',
      tenant: 'tenant-1',
    };
    createTenantKnexMock.mockResolvedValue({ knex: vi.fn() });
  });

  it('T123: recent invoice activity prefers canonical recurring service periods when detail rows exist', async () => {
    withTransactionMock.mockImplementation(async (_db: any, callback: (trx: any) => Promise<any>) =>
      callback(
        buildTrx([
          {
            invoice_number: 'INV-1001',
            total: 12500,
            timestamp: '2026-02-02T10:00:00.000Z',
            service_period_start: '2026-01-01',
            service_period_end: '2026-02-01',
          },
        ])
      )
    );

    const { getRecentActivity } = await import('./dashboard');
    const activities = await getRecentActivity();

    expect(activities).toEqual([
      {
        type: 'invoice',
        title: 'Invoice INV-1001 generated',
        timestamp: '2026-02-02T10:00:00.000Z',
        description: 'Service period: 2026-01-01 to 2026-02-01 • Total amount: $125.00',
      },
    ]);
  });

  it('falls back to amount-only descriptions for historical invoices without canonical detail periods', async () => {
    withTransactionMock.mockImplementation(async (_db: any, callback: (trx: any) => Promise<any>) =>
      callback(
        buildTrx([
          {
            invoice_number: 'INV-1002',
            total: 5000,
            timestamp: '2026-02-03T10:00:00.000Z',
            service_period_start: null,
            service_period_end: null,
          },
        ])
      )
    );

    const { getRecentActivity } = await import('./dashboard');
    const activities = await getRecentActivity();

    expect(activities[0]?.description).toBe('Total amount: $50.00');
  });
});
