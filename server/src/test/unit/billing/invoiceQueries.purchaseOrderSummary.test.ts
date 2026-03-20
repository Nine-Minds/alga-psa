import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const invoiceRow = {
    invoice_id: 'invoice-1',
    client_contract_id: 'assignment-1',
    po_number: 'PO-INVOICE-1',
  };

  const invoiceBuilder: any = {
    where: vi.fn(() => invoiceBuilder),
    select: vi.fn(() => invoiceBuilder),
    first: vi.fn(async () => invoiceRow),
  };

  const knex = vi.fn((tableName: string) => {
    if (tableName === 'invoices') {
      return invoiceBuilder;
    }
    throw new Error(`Unexpected table ${tableName}`);
  }) as any;

  return {
    invoiceRow,
    invoiceBuilder,
    knex,
    createTenantKnex: vi.fn(async () => ({ knex })),
    getClientContractPurchaseOrderContext: vi.fn(async () => ({
      po_number: 'PO-ASSIGNMENT-1',
      po_amount: 10000,
      po_required: false,
    })),
    getPurchaseOrderConsumedCents: vi.fn(async () => 3500),
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

vi.mock('../../../../../packages/billing/src/services/purchaseOrderService', () => ({
  getClientContractPurchaseOrderContext: mocks.getClientContractPurchaseOrderContext,
  getPurchaseOrderConsumedCents: mocks.getPurchaseOrderConsumedCents,
}));

const { getInvoicePurchaseOrderSummary } = await import(
  '../../../../../packages/billing/src/actions/invoiceQueries'
);

describe('invoiceQueries purchase order summary assignment scope', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('T043: PO summary remains tied to invoice.client_contract_id and does not drift to sibling assignments', async () => {
    const result = await getInvoicePurchaseOrderSummary('invoice-1');

    expect(mocks.invoiceBuilder.where).toHaveBeenCalledWith({
      tenant: 'tenant-1',
      invoice_id: 'invoice-1',
    });
    expect(mocks.getClientContractPurchaseOrderContext).toHaveBeenCalledWith({
      knex: mocks.knex,
      tenant: 'tenant-1',
      clientContractId: 'assignment-1',
    });
    expect(mocks.getPurchaseOrderConsumedCents).toHaveBeenCalledWith({
      knex: mocks.knex,
      tenant: 'tenant-1',
      clientContractId: 'assignment-1',
    });
    expect(result).toEqual({
      invoice_id: 'invoice-1',
      client_contract_id: 'assignment-1',
      po_number: 'PO-INVOICE-1',
      po_amount_cents: 10000,
      consumed_cents: 3500,
      remaining_cents: 6500,
    });
  });
});
