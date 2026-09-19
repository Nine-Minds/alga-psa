import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeTable, fakeTransaction, type FakeTenantDbOptions } from '@alga-psa/db/testing';

let currentUser: any;

const createTenantKnexMock = vi.fn();
const withTransactionMock = vi.fn();

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: any) => async (...args: any[]) =>
    action(currentUser, { tenant: currentUser.tenant }, ...args),
  withOptionalAuth: (action: any) => async (...args: any[]) =>
    action(currentUser, { tenant: currentUser.tenant }, ...args),
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: (...args: any[]) => createTenantKnexMock(...args),
  withTransaction: (...args: any[]) => withTransactionMock(...args),
  tenantDb: (conn: any, _tenant: string) => ({
    table: (table: string) => conn(table),
    unscoped: (table: string) => conn(table),
    tenantJoin: (query: any, _table?: string, _left?: string, _right?: string, options: any = {}) => {
      const join = options?.type === 'left' ? query.leftJoin : query.join;
      return typeof join === 'function' ? join.call(query) : query;
    },
  }),
}));

vi.mock('next/headers.js', () => ({
  headers: vi.fn(),
}));

function buildTrx(invoiceRows: any[]) {
  const tables: FakeTenantDbOptions = {
    tables: {
      contacts: [{ contact_name_id: 'contact-1', client_id: 'client-1', portal_visibility_group_id: null }],
      boards: [],
      tickets: [],
      // The feed only shows finalized invoices belonging to the requester's client.
      invoices: invoiceRows.map((row) => ({ finalized_at: row.timestamp, client_id: 'client-1', ...row })),
    },
  };

  return Object.assign(
    ((table: string) => fakeTable(tables, currentUser.tenant, table.split(' ')[0])) as any,
    fakeTransaction({ raw: vi.fn((sql: string) => sql) }),
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
        name: 'INV-1001',
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
