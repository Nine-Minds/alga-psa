import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const knex = {} as any;
  const createTenantKnex = vi.fn(async () => ({ knex }));
  const getInvoiceItems = vi.fn();

  return {
    knex,
    createTenantKnex,
    getInvoiceItems,
  };
});

vi.mock('@alga-psa/auth', () => ({
  withAuth: (action: (...args: any[]) => Promise<unknown>) =>
    (...args: any[]) =>
      action(
        {
          user_id: 'user-1',
          tenant: 'tenant-1',
        },
        { tenant: 'tenant-1' },
        ...args,
      ),
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: mocks.createTenantKnex,
}));

vi.mock('../../../../../packages/billing/src/models/invoice', () => ({
  default: {
    getInvoiceItems: mocks.getInvoiceItems,
  },
}));

const { getInvoiceLineItems } = await import(
  '../../../../../packages/billing/src/actions/invoiceQueries'
);

describe('invoiceQueries recurring detail reads', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('T265: invoice query actions preserve canonical recurring detail periods through dashboard-level invoice reads', async () => {
    const projectedItems = [
      {
        item_id: 'recurring-1',
        invoice_id: 'invoice-1',
        tenant: 'tenant-1',
        description: 'Managed Router',
        service_period_start: '2025-01-01T00:00:00.000Z',
        service_period_end: '2025-03-01T00:00:00.000Z',
        billing_timing: null,
        recurring_detail_periods: [
          {
            service_period_start: '2025-01-01T00:00:00.000Z',
            service_period_end: '2025-02-01T00:00:00.000Z',
            billing_timing: 'arrears',
          },
          {
            service_period_start: '2025-02-01T00:00:00.000Z',
            service_period_end: '2025-03-01T00:00:00.000Z',
            billing_timing: 'advance',
          },
        ],
      },
    ];
    mocks.getInvoiceItems.mockResolvedValue(projectedItems);

    const result = await getInvoiceLineItems('invoice-1');

    expect(mocks.createTenantKnex).toHaveBeenCalledTimes(1);
    expect(mocks.getInvoiceItems).toHaveBeenCalledWith(mocks.knex, 'tenant-1', 'invoice-1');
    expect(result).toEqual(projectedItems);
  });
});
