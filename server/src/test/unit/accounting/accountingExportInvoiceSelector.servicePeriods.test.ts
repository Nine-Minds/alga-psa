import { describe, expect, it, vi } from 'vitest';

import { AccountingExportInvoiceSelector, AccountingExportService } from '@alga-psa/billing/services';

function buildThenableQuery(result: any[]) {
  const builder: any = {};
  builder.join = vi.fn(() => builder);
  builder.leftJoin = vi.fn(() => builder);
  builder.select = vi.fn(() => builder);
  builder.where = vi.fn(() => builder);
  builder.whereIn = vi.fn(() => builder);
  builder.orderBy = vi.fn(() => builder);
  builder.andWhere = vi.fn((...args: any[]) => {
    const maybeCallback = args[0];
    if (typeof maybeCallback === 'function') {
      const callbackBuilder: any = {
        whereIn: vi.fn(() => callbackBuilder),
        orWhere: vi.fn(() => callbackBuilder),
        andWhere: vi.fn(() => callbackBuilder),
      };
      maybeCallback(callbackBuilder);
    }
    return builder;
  });
  builder.whereNotExists = vi.fn(() => builder);
  builder.andWhereRaw = vi.fn(() => builder);
  builder.then = (onFulfilled: any, onRejected: any) => Promise.resolve(result).then(onFulfilled, onRejected);
  builder.catch = (onRejected: any) => Promise.resolve(result).catch(onRejected);
  builder.finally = (handler: any) => Promise.resolve(result).finally(handler);
  return builder;
}

describe('AccountingExportInvoiceSelector service-period behavior', () => {
  it('prefers canonical invoice charge detail periods and treats invoices without recurring detail as periodless financial documents', async () => {
    const previewRows = [
      {
        invoice_id: 'invoice-1',
        invoice_number: 'INV-001',
        invoice_date: '2025-02-05T00:00:00.000Z',
        invoice_status: 'sent',
        tax_source: 'internal',
        client_id: 'client-1',
        client_name: 'Acme Corp',
        currency_code: 'USD',
        invoice_is_manual: false,
        billing_period_start: '2025-02-01T00:00:00.000Z',
        billing_period_end: '2025-02-28T00:00:00.000Z',
        total_amount: 15000,
        item_id: 'charge-canonical',
        total_price: 15000,
        charge_is_manual: false,
        detail_service_period_start: '2025-01-01T00:00:00.000Z',
        detail_service_period_end: '2025-02-01T00:00:00.000Z',
      },
      {
        invoice_id: 'invoice-1',
        invoice_number: 'INV-001',
        invoice_date: '2025-02-05T00:00:00.000Z',
        invoice_status: 'sent',
        tax_source: 'internal',
        client_id: 'client-1',
        client_name: 'Acme Corp',
        currency_code: 'USD',
        invoice_is_manual: false,
        billing_period_start: '2025-02-01T00:00:00.000Z',
        billing_period_end: '2025-02-28T00:00:00.000Z',
        total_amount: 15000,
        item_id: 'charge-canonical',
        total_price: 15000,
        charge_is_manual: false,
        detail_service_period_start: '2025-02-01T00:00:00.000Z',
        detail_service_period_end: '2025-03-01T00:00:00.000Z',
      },
      {
        invoice_id: 'invoice-2',
        invoice_number: 'INV-002',
        invoice_date: '2025-02-10T00:00:00.000Z',
        invoice_status: 'sent',
        tax_source: 'internal',
        client_id: 'client-2',
        client_name: 'Northwind',
        currency_code: 'USD',
        invoice_is_manual: true,
        billing_period_start: '2025-02-10T00:00:00.000Z',
        billing_period_end: '2025-02-10T00:00:00.000Z',
        total_amount: 4000,
        item_id: 'charge-legacy',
        total_price: 4000,
        charge_is_manual: true,
        detail_service_period_start: null,
        detail_service_period_end: null,
      },
    ];
    const transactionRows = [
      { invoice_id: 'invoice-1', transaction_id: 'txn-1' },
      { invoice_id: 'invoice-2', transaction_id: 'txn-2' },
    ];

    const knex: any = vi.fn((table: string) => {
      if (table === 'invoices as inv') {
        return buildThenableQuery(previewRows);
      }
      if (table === 'transactions') {
        return buildThenableQuery(transactionRows);
      }
      throw new Error(`Unexpected table ${table}`);
    });

    const selector = new AccountingExportInvoiceSelector(knex, 'tenant-1');
    const preview = await selector.previewInvoiceLines({});

    expect(preview).toHaveLength(2);

    const canonicalLine = preview.find((line) => line.chargeId === 'charge-canonical');
    expect(canonicalLine).toMatchObject({
      invoiceId: 'invoice-1',
      servicePeriodStart: '2025-01-01T00:00:00.000Z',
      servicePeriodEnd: '2025-03-01T00:00:00.000Z',
      servicePeriodSource: 'canonical_detail_periods',
      isMultiPeriod: true,
      transactionIds: ['txn-1'],
    });
    expect(canonicalLine?.recurringDetailPeriods).toEqual([
      {
        service_period_start: '2025-01-01T00:00:00.000Z',
        service_period_end: '2025-02-01T00:00:00.000Z',
        billing_timing: null,
      },
      {
        service_period_start: '2025-02-01T00:00:00.000Z',
        service_period_end: '2025-03-01T00:00:00.000Z',
        billing_timing: null,
      },
    ]);

    const legacyLine = preview.find((line) => line.chargeId === 'charge-legacy');
    expect(legacyLine).toMatchObject({
      invoiceId: 'invoice-2',
      servicePeriodStart: null,
      servicePeriodEnd: null,
      servicePeriodSource: 'financial_document_fallback',
      isManualInvoice: true,
      isManualCharge: true,
      transactionIds: ['txn-2'],
    });
  });

  it('persists canonical recurring detail periods into export line payloads when creating a batch', async () => {
    const previewRows = [
      {
        invoice_id: 'invoice-1',
        invoice_number: 'INV-001',
        invoice_date: '2025-02-05T00:00:00.000Z',
        invoice_status: 'sent',
        tax_source: 'internal',
        client_id: 'client-1',
        client_name: 'Acme Corp',
        currency_code: 'USD',
        invoice_is_manual: false,
        billing_period_start: '2025-02-01T00:00:00.000Z',
        billing_period_end: '2025-02-28T00:00:00.000Z',
        total_amount: 15000,
        item_id: 'charge-canonical',
        total_price: 15000,
        charge_is_manual: false,
        detail_service_period_start: '2025-01-01T00:00:00.000Z',
        detail_service_period_end: '2025-02-01T00:00:00.000Z',
        detail_billing_timing: 'arrears',
      },
      {
        invoice_id: 'invoice-1',
        invoice_number: 'INV-001',
        invoice_date: '2025-02-05T00:00:00.000Z',
        invoice_status: 'sent',
        tax_source: 'internal',
        client_id: 'client-1',
        client_name: 'Acme Corp',
        currency_code: 'USD',
        invoice_is_manual: false,
        billing_period_start: '2025-02-01T00:00:00.000Z',
        billing_period_end: '2025-02-28T00:00:00.000Z',
        total_amount: 15000,
        item_id: 'charge-canonical',
        total_price: 15000,
        charge_is_manual: false,
        detail_service_period_start: '2025-02-01T00:00:00.000Z',
        detail_service_period_end: '2025-03-01T00:00:00.000Z',
        detail_billing_timing: 'arrears',
      },
    ];

    const knex: any = vi.fn((table: string) => {
      if (table === 'invoices as inv') {
        return buildThenableQuery(previewRows);
      }
      if (table === 'transactions') {
        return buildThenableQuery([{ invoice_id: 'invoice-1', transaction_id: 'txn-1' }]);
      }
      throw new Error(`Unexpected table ${table}`);
    });

    const createBatch = vi.fn().mockResolvedValue({ batch_id: 'batch-1' });
    const appendLines = vi.fn().mockResolvedValue([]);
    const serviceCreateSpy = vi
      .spyOn(AccountingExportService, 'createForTenant')
      .mockResolvedValue({
        createBatch,
        appendLines,
      } as unknown as AccountingExportService);

    try {
      const selector = new AccountingExportInvoiceSelector(knex, 'tenant-1');
      await selector.createBatchFromFilters({
        adapterType: 'quickbooks_online',
        targetRealm: 'realm-1',
        filters: {},
      });

      expect(serviceCreateSpy).toHaveBeenCalledWith('tenant-1');

      expect(createBatch).toHaveBeenCalledWith(
        expect.objectContaining({
          adapter_type: 'quickbooks_online',
          target_realm: 'realm-1',
          export_type: 'invoice',
        })
      );
      expect(appendLines).toHaveBeenCalledWith('batch-1', {
        lines: [
          expect.objectContaining({
            invoice_id: 'invoice-1',
            invoice_charge_id: 'charge-canonical',
            service_period_start: '2025-01-01T00:00:00.000Z',
            service_period_end: '2025-03-01T00:00:00.000Z',
            payload: expect.objectContaining({
              service_period_source: 'canonical_detail_periods',
              recurring_detail_periods: [
                {
                  service_period_start: '2025-01-01T00:00:00.000Z',
                  service_period_end: '2025-02-01T00:00:00.000Z',
                  billing_timing: 'arrears',
                },
                {
                  service_period_start: '2025-02-01T00:00:00.000Z',
                  service_period_end: '2025-03-01T00:00:00.000Z',
                  billing_timing: 'arrears',
                },
              ],
              transaction_ids: ['txn-1'],
            }),
          }),
        ],
      });
    } finally {
      serviceCreateSpy.mockRestore();
    }
  });
});
