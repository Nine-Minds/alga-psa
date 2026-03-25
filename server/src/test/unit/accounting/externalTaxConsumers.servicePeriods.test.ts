import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AccountingExportAdapterContext, AccountingExportDeliveryResult } from '@alga-psa/types';

const createTenantKnexMock = vi.hoisted(() => vi.fn());

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: createTenantKnexMock
}));

import { AccountingExportService } from '../../../../../packages/billing/src/services/accountingExportService';
import { ExternalTaxImportService } from '../../../../../packages/billing/src/services/externalTaxImportService';

function buildInvoiceFirstQuery(invoice: Record<string, unknown>) {
  const builder: any = {};
  builder.where = vi.fn(() => builder);
  builder.select = vi.fn(() => builder);
  builder.first = vi.fn().mockResolvedValue(invoice);
  return builder;
}

function buildChargeSelectQuery(charges: Array<Record<string, unknown>>) {
  const builder: any = {};
  builder.where = vi.fn(() => builder);
  builder.select = vi.fn().mockResolvedValue(charges);
  return builder;
}

describe('external tax consumers service-period policy', () => {
  beforeEach(() => {
    createTenantKnexMock.mockReset();
  });

  it('reconciles tax differences from invoice charges without querying recurring service-period detail rows', async () => {
    const invoiceBuilder = buildInvoiceFirstQuery({
      invoice_id: 'invoice-1',
      tax_source: 'external'
    });
    const chargeBuilder = buildChargeSelectQuery([
      {
        item_id: 'charge-1',
        description: 'Managed services',
        tax_amount: 1000,
        external_tax_amount: 1200
      },
      {
        item_id: 'charge-2',
        description: 'Support',
        tax_amount: 500,
        external_tax_amount: null
      }
    ]);

    const knex: any = vi.fn((table: string) => {
      if (table === 'invoices') {
        return invoiceBuilder;
      }
      if (table === 'invoice_charges') {
        return chargeBuilder;
      }
      if (table === 'invoice_charge_details') {
        throw new Error('reconcileTaxDifferences should not query recurring detail rows');
      }
      throw new Error(`Unexpected table ${table}`);
    });

    createTenantKnexMock.mockResolvedValue({
      knex,
      tenant: 'tenant-1'
    });

    const service = new ExternalTaxImportService();
    const result = await service.reconcileTaxDifferences('invoice-1');

    expect(result).toMatchObject({
      invoiceId: 'invoice-1',
      internalTax: 1500,
      externalTax: 1700,
      difference: 200,
      hasSignificantDifference: true
    });
    expect(result.lineComparisons).toEqual([
      {
        chargeId: 'charge-1',
        description: 'Managed services',
        internalTax: 1000,
        externalTax: 1200,
        difference: 200
      },
      {
        chargeId: 'charge-2',
        description: 'Support',
        internalTax: 500,
        externalTax: 500,
        difference: 0
      }
    ]);
    expect(invoiceBuilder.select).toHaveBeenCalledWith('invoice_id', 'tax_source');
    expect(chargeBuilder.select).toHaveBeenCalledWith(
      'item_id',
      'description',
      'tax_amount',
      'external_tax_amount'
    );
  });

  it('imports external tax once per invoice after delivery even when exported lines carry canonical recurring periods', async () => {
    const taxImporter = {
      importTaxForInvoice: vi.fn(async (invoiceId: string) => ({
        success: true,
        importedTax: invoiceId === 'invoice-1' ? 1500 : 500,
        chargesUpdated: 1
      }))
    };

    const service = new AccountingExportService({} as any, {} as any, taxImporter);
    const context: AccountingExportAdapterContext = {
      batch: {
        batch_id: 'batch-1',
        tenant: 'tenant-1',
        adapter_type: 'xero',
        export_type: 'invoice',
        status: 'ready',
        queued_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      } as any,
      lines: [
        {
          line_id: 'line-1',
          batch_id: 'batch-1',
          invoice_id: 'invoice-1',
          invoice_charge_id: 'charge-1',
          client_id: 'client-1',
          amount_cents: 10000,
          currency_code: 'USD',
          status: 'ready',
          service_period_start: '2025-01-01T00:00:00.000Z',
          service_period_end: '2025-02-01T00:00:00.000Z',
          payload: {
            service_period_source: 'canonical_detail_periods',
            recurring_detail_periods: [
              {
                service_period_start: '2025-01-01T00:00:00.000Z',
                service_period_end: '2025-02-01T00:00:00.000Z',
                billing_timing: 'advance'
              },
              {
                service_period_start: '2025-02-01T00:00:00.000Z',
                service_period_end: '2025-03-01T00:00:00.000Z',
                billing_timing: 'advance'
              }
            ]
          },
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        },
        {
          line_id: 'line-2',
          batch_id: 'batch-1',
          invoice_id: 'invoice-1',
          invoice_charge_id: 'charge-2',
          client_id: 'client-1',
          amount_cents: 5000,
          currency_code: 'USD',
          status: 'ready',
          service_period_start: '2025-03-01T00:00:00.000Z',
          service_period_end: '2025-04-01T00:00:00.000Z',
          payload: {
            service_period_source: 'canonical_detail_periods'
          },
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        },
        {
          line_id: 'line-3',
          batch_id: 'batch-1',
          invoice_id: 'invoice-2',
          invoice_charge_id: 'charge-3',
          client_id: 'client-1',
          amount_cents: 2500,
          currency_code: 'USD',
          status: 'ready',
          service_period_start: null,
          service_period_end: null,
          payload: {
            service_period_source: 'financial_document_fallback'
          },
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }
      ] as any
    };
    const deliveryResult: AccountingExportDeliveryResult = {
      deliveredLines: []
    };

    await (service as any).importExternalTaxAfterDelivery(
      deliveryResult,
      context,
      { type: 'xero' }
    );

    expect(taxImporter.importTaxForInvoice).toHaveBeenCalledTimes(2);
    expect(taxImporter.importTaxForInvoice).toHaveBeenNthCalledWith(1, 'invoice-1');
    expect(taxImporter.importTaxForInvoice).toHaveBeenNthCalledWith(2, 'invoice-2');
  });
});
