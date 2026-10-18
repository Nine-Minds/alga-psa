import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  invoice: null as Record<string, unknown> | null,
  exportInProgress: false,
  accountingMapping: false,
  first: vi.fn(),
}));

vi.mock('@alga-psa/db', () => ({
  tenantDb: () => ({
    table: () => {
      const query: any = {};
      query.where = vi.fn(() => query);
      query.clone = vi.fn(() => query);
      query.forUpdate = vi.fn(() => query);
      query.first = mocks.first;
      return query;
    },
  }),
}));

vi.mock('../src/services/accountingSync/invoiceExportGuards', () => ({
  findInvoiceExportInProgress: vi.fn(async () => mocks.exportInProgress),
  findInvoiceAccountingMapping: vi.fn(async () => mocks.accountingMapping),
}));

import { inspectInvoiceEditable } from '../src/services/invoiceAdjustmentEditability';

describe('invoice adjustment editability', () => {
  beforeEach(() => {
    mocks.invoice = {
      invoice_id: 'invoice-1',
      status: 'draft',
      finalized_at: null,
      is_manual: false,
      currency_code: 'USD',
    };
    mocks.exportInProgress = false;
    mocks.accountingMapping = false;
    mocks.first.mockImplementation(async () => mocks.invoice);
  });

  it('allows an unfinalized draft without an export lock', async () => {
    const result = await inspectInvoiceEditable({} as any, 'tenant-1', 'invoice-1');
    expect(result.capability).toMatchObject({ editable: true, code: null, currencyCode: 'USD' });
  });

  it.each([
    ['paid', { status: 'paid' }, 'paid'],
    ['cancelled', { status: 'cancelled' }, 'cancelled'],
    ['finalized', { finalized_at: '2026-09-15T00:00:00Z' }, 'finalized'],
    ['non-draft finalized status', { status: 'sent' }, 'finalized'],
  ])('blocks %s invoices', async (_label, overrides, code) => {
    mocks.invoice = { ...mocks.invoice, ...overrides };
    const result = await inspectInvoiceEditable({} as any, 'tenant-1', 'invoice-1');
    expect(result.capability).toMatchObject({ editable: false, code });
  });

  it('blocks an invoice while accounting export is in progress', async () => {
    mocks.exportInProgress = true;
    const result = await inspectInvoiceEditable({} as any, 'tenant-1', 'invoice-1');
    expect(result.capability).toMatchObject({ editable: false, code: 'exporting' });
  });

  it('blocks an invoice with a delivered accounting mapping', async () => {
    mocks.accountingMapping = true;
    const result = await inspectInvoiceEditable({} as any, 'tenant-1', 'invoice-1');
    expect(result.capability).toMatchObject({ editable: false, code: 'exported' });
  });
});
