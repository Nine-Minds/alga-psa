import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { QuickBooksOnlineAdapter } from '../../../../../packages/billing/src/adapters/accounting/quickBooksOnlineAdapter';
import type { AccountingExportAdapterContext } from '@alga-psa/types';
import { AccountingMappingResolver } from '../../../../../packages/billing/src/services/accountingMappingResolver';
import * as dbModule from 'server/src/lib/db';

const TENANT_ID = 'tenant-qbo-spec';
const INVOICE_ID = 'invoice-qbo-spec';
const CLIENT_ID = 'client-qbo-spec';

type MinimalLine = {
  line_id: string;
  batch_id: string;
  invoice_id: string;
  invoice_charge_id: string;
  client_id: string;
  amount_cents: number;
  currency_code: string;
  status: string;
  payload: Record<string, unknown> | null;
  mapping_resolution: Record<string, unknown> | null;
  service_period_start: string | null;
  service_period_end: string | null;
  created_at: string;
  updated_at: string;
};

function buildContext(lines: MinimalLine[]): AccountingExportAdapterContext {
  const now = new Date().toISOString();
  return {
    batch: {
      batch_id: 'batch-qbo-spec',
      tenant: TENANT_ID,
      adapter_type: 'quickbooks_online',
      export_type: 'invoice',
      target_realm: 'realm-qbo-demo',
      status: 'ready',
      queued_at: now,
      created_at: now,
      updated_at: now,
      notes: null
    } as any,
    lines: lines as any
  };
}

describe('QuickBooksOnlineAdapter service-period export policy', () => {
  const mockResolver = {
    resolveServiceMapping: vi.fn(),
    resolveTaxCodeMapping: vi.fn()
  };

  const baseLine: MinimalLine = {
    line_id: 'line-qbo-1',
    batch_id: 'batch-qbo-spec',
    invoice_id: INVOICE_ID,
    invoice_charge_id: 'charge-qbo-1',
    client_id: CLIENT_ID,
    amount_cents: 12_345,
    currency_code: 'USD',
    status: 'ready',
    payload: null,
    mapping_resolution: null,
    service_period_start: null,
    service_period_end: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  beforeEach(() => {
    mockResolver.resolveServiceMapping.mockReset();
    mockResolver.resolveTaxCodeMapping.mockReset();
    vi.spyOn(dbModule, 'createTenantKnex').mockResolvedValue({ knex: {} as any, tenant: TENANT_ID });
    vi.spyOn(AccountingMappingResolver, 'create').mockResolvedValue(
      mockResolver as unknown as AccountingMappingResolver
    );
    mockResolver.resolveServiceMapping.mockResolvedValue({
      external_entity_id: 'ITEM-QBO-1',
      metadata: {}
    });
    mockResolver.resolveTaxCodeMapping.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses the canonical service-period start as the exported QuickBooks service date for recurring ranges', async () => {
    const adapter = new QuickBooksOnlineAdapter();
    const context = buildContext([
      {
        ...baseLine,
        service_period_start: '2025-01-01T00:00:00.000Z',
        service_period_end: '2025-03-01T00:00:00.000Z',
        payload: {
          service_period_source: 'canonical_detail_periods'
        }
      }
    ]);

    vi.spyOn(adapter as any, 'loadInvoices').mockResolvedValue(
      new Map([
        [
          INVOICE_ID,
          {
            invoice_id: INVOICE_ID,
            invoice_number: 'INV-QBO-1001',
            invoice_date: '2025-02-05',
            due_date: '2025-02-20',
            total_amount: 12_345,
            client_id: CLIENT_ID,
            currency_code: 'USD'
          }
        ]
      ])
    );
    vi.spyOn(adapter as any, 'loadCharges').mockResolvedValue(
      new Map([
        [
          'charge-qbo-1',
          {
            item_id: 'charge-qbo-1',
            invoice_id: INVOICE_ID,
            service_id: 'svc-qbo-1',
            description: 'Managed services',
            quantity: 1,
            unit_price: 12_345,
            net_amount: 12_345,
            total_price: 12_345,
            tax_amount: 0,
            tax_region: null
          }
        ]
      ])
    );
    vi.spyOn(adapter as any, 'loadClients').mockResolvedValue({
      clients: new Map([
        [
          CLIENT_ID,
          {
            client_id: CLIENT_ID,
            client_name: 'Acme Corp',
            billing_email: 'billing@example.com',
            payment_terms: null
          }
        ]
      ]),
      mappings: new Map([
        [
          CLIENT_ID,
          {
            id: 'mapping-qbo-1',
            integration_type: 'quickbooks_online',
            alga_entity_type: 'client',
            alga_entity_id: CLIENT_ID,
            external_entity_id: 'qb-customer-1',
            metadata: { source: 'mapping_table' }
          }
        ]
      ])
    });

    const result = await adapter.transform(context);
    const document = result.documents[0];
    const invoice = (document.payload as any).invoice;
    expect(invoice.Line[0]?.SalesItemLineDetail?.ServiceDate).toBe('2025-01-01');
  });

  it('omits the QuickBooks service date when an export line intentionally falls back to financial-document semantics', async () => {
    const adapter = new QuickBooksOnlineAdapter();
    const context = buildContext([
      {
        ...baseLine,
        payload: {
          service_period_source: 'financial_document_fallback'
        }
      }
    ]);

    vi.spyOn(adapter as any, 'loadInvoices').mockResolvedValue(
      new Map([
        [
          INVOICE_ID,
          {
            invoice_id: INVOICE_ID,
            invoice_number: 'INV-QBO-1002',
            invoice_date: '2025-02-05',
            due_date: '2025-02-20',
            total_amount: 12_345,
            client_id: CLIENT_ID,
            currency_code: 'USD'
          }
        ]
      ])
    );
    vi.spyOn(adapter as any, 'loadCharges').mockResolvedValue(
      new Map([
        [
          'charge-qbo-1',
          {
            item_id: 'charge-qbo-1',
            invoice_id: INVOICE_ID,
            service_id: 'svc-qbo-1',
            description: 'Manual adjustment',
            quantity: 1,
            unit_price: 12_345,
            net_amount: 12_345,
            total_price: 12_345,
            tax_amount: 0,
            tax_region: null
          }
        ]
      ])
    );
    vi.spyOn(adapter as any, 'loadClients').mockResolvedValue({
      clients: new Map([
        [
          CLIENT_ID,
          {
            client_id: CLIENT_ID,
            client_name: 'Acme Corp',
            billing_email: 'billing@example.com',
            payment_terms: null
          }
        ]
      ]),
      mappings: new Map([
        [
          CLIENT_ID,
          {
            id: 'mapping-qbo-1',
            integration_type: 'quickbooks_online',
            alga_entity_type: 'client',
            alga_entity_id: CLIENT_ID,
            external_entity_id: 'qb-customer-1',
            metadata: { source: 'mapping_table' }
          }
        ]
      ])
    });

    const result = await adapter.transform(context);
    const document = result.documents[0];
    const invoice = (document.payload as any).invoice;
    expect(invoice.Line[0]?.SalesItemLineDetail?.ServiceDate).toBeUndefined();
  });

  it('T274: QuickBooks adapter preserves mixed-cadence recurring service dates line-by-line inside one exported invoice', async () => {
    const adapter = new QuickBooksOnlineAdapter();
    const context = buildContext([
      {
        ...baseLine,
        line_id: 'line-qbo-client',
        invoice_charge_id: 'charge-qbo-client',
        service_period_start: '2025-02-01T00:00:00.000Z',
        service_period_end: '2025-03-01T00:00:00.000Z',
        payload: {
          service_period_source: 'canonical_detail_periods',
          cadence_owner: 'client',
        }
      },
      {
        ...baseLine,
        line_id: 'line-qbo-contract',
        invoice_charge_id: 'charge-qbo-contract',
        amount_cents: 8_765,
        service_period_start: '2025-02-08T00:00:00.000Z',
        service_period_end: '2025-03-08T00:00:00.000Z',
        payload: {
          service_period_source: 'canonical_detail_periods',
          cadence_owner: 'contract',
        }
      }
    ]);

    vi.spyOn(adapter as any, 'loadInvoices').mockResolvedValue(
      new Map([
        [
          INVOICE_ID,
          {
            invoice_id: INVOICE_ID,
            invoice_number: 'INV-QBO-274',
            invoice_date: '2025-02-10',
            due_date: '2025-02-25',
            total_amount: 21_110,
            client_id: CLIENT_ID,
            currency_code: 'USD'
          }
        ]
      ])
    );
    vi.spyOn(adapter as any, 'loadCharges').mockResolvedValue(
      new Map([
        [
          'charge-qbo-client',
          {
            item_id: 'charge-qbo-client',
            invoice_id: INVOICE_ID,
            service_id: 'svc-qbo-client',
            description: 'Client cadence managed services',
            quantity: 1,
            unit_price: 12_345,
            net_amount: 12_345,
            total_price: 12_345,
            tax_amount: 0,
            tax_region: null
          }
        ],
        [
          'charge-qbo-contract',
          {
            item_id: 'charge-qbo-contract',
            invoice_id: INVOICE_ID,
            service_id: 'svc-qbo-contract',
            description: 'Contract cadence backup',
            quantity: 1,
            unit_price: 8_765,
            net_amount: 8_765,
            total_price: 8_765,
            tax_amount: 0,
            tax_region: null
          }
        ]
      ])
    );
    vi.spyOn(adapter as any, 'loadClients').mockResolvedValue({
      clients: new Map([
        [
          CLIENT_ID,
          {
            client_id: CLIENT_ID,
            client_name: 'Acme Corp',
            billing_email: 'billing@example.com',
            payment_terms: null
          }
        ]
      ]),
      mappings: new Map([
        [
          CLIENT_ID,
          {
            id: 'mapping-qbo-1',
            integration_type: 'quickbooks_online',
            alga_entity_type: 'client',
            alga_entity_id: CLIENT_ID,
            external_entity_id: 'qb-customer-1',
            metadata: { source: 'mapping_table' }
          }
        ]
      ])
    });

    const result = await adapter.transform(context);
    const invoice = (result.documents[0]?.payload as any).invoice;
    expect(invoice.Line).toHaveLength(2);
    expect(invoice.Line[0]?.SalesItemLineDetail?.ServiceDate).toBe('2025-02-01');
    expect(invoice.Line[1]?.SalesItemLineDetail?.ServiceDate).toBe('2025-02-08');
  });

  // Regression: the adapter used to send tax-inclusive total_price as Amount alongside pre-tax
  // UnitPrice, which produced Qty × UnitPrice ≠ Amount. In internal-tax mode, tax now also
  // flows to QBO via TxnTaxDetail.TotalTax so QBO's books mirror Alga's authoritative totals.
  it('sends pre-tax Amount and authoritative TxnTaxDetail.TotalTax in internal-tax mode', async () => {
    const adapter = new QuickBooksOnlineAdapter();
    const context: AccountingExportAdapterContext = {
      ...buildContext([baseLine]),
      taxDelegationMode: 'none',
      excludeTaxFromExport: false
    } as AccountingExportAdapterContext;

    vi.spyOn(adapter as any, 'loadInvoices').mockResolvedValue(
      new Map([
        [
          INVOICE_ID,
          {
            invoice_id: INVOICE_ID,
            invoice_number: 'INV-QBO-TAX',
            invoice_date: '2026-04-16',
            due_date: '2026-04-30',
            client_id: CLIENT_ID,
            currency_code: 'USD'
          }
        ]
      ])
    );

    mockResolver.resolveTaxCodeMapping.mockResolvedValue({
      external_entity_id: 'TAX-NY',
      metadata: {}
    });

    vi.spyOn(adapter as any, 'loadCharges').mockResolvedValue(
      new Map([
        [
          'charge-qbo-1',
          {
            item_id: 'charge-qbo-1',
            invoice_id: INVOICE_ID,
            service_id: 'svc-qbo-1',
            description: 'Remote Support - Hourly',
            quantity: 2,
            unit_price: 10_000,
            net_amount: 20_000,
            total_price: 21_775,
            tax_amount: 1_775,
            tax_region: 'US-NY'
          }
        ]
      ])
    );

    vi.spyOn(adapter as any, 'loadClients').mockResolvedValue({
      clients: new Map([
        [
          CLIENT_ID,
          {
            client_id: CLIENT_ID,
            client_name: 'Acme',
            billing_email: 'a@a',
            payment_terms: null
          }
        ]
      ]),
      mappings: new Map([
        [
          CLIENT_ID,
          {
            id: 'mapping-qbo-1',
            integration_type: 'quickbooks_online',
            alga_entity_type: 'client',
            alga_entity_id: CLIENT_ID,
            external_entity_id: 'external-customer-acme',
            metadata: { source: 'mapping_table' }
          }
        ]
      ])
    });

    const result = await adapter.transform(context);
    const invoice = (result.documents[0]?.payload as any).invoice;
    const line = invoice.Line[0];

    expect(line.Amount).toBe(200.00); // pre-tax net in dollars (20_000 cents)
    expect(line.SalesItemLineDetail.Qty).toBe(2);
    expect(line.SalesItemLineDetail.UnitPrice).toBe(100.00);
    expect(line.SalesItemLineDetail.Qty * line.SalesItemLineDetail.UnitPrice).toBe(line.Amount);
    expect(invoice.TxnTaxDetail?.TotalTax).toBe(17.75);
  });

  it('omits TxnTaxDetail in delegate-tax mode and still sends pre-tax Amount', async () => {
    const adapter = new QuickBooksOnlineAdapter();
    const context: AccountingExportAdapterContext = {
      ...buildContext([baseLine]),
      taxDelegationMode: 'delegate',
      excludeTaxFromExport: true
    } as AccountingExportAdapterContext;

    vi.spyOn(adapter as any, 'loadInvoices').mockResolvedValue(
      new Map([
        [
          INVOICE_ID,
          {
            invoice_id: INVOICE_ID,
            invoice_number: 'INV-QBO-DEL',
            invoice_date: '2026-04-16',
            due_date: '2026-04-30',
            client_id: CLIENT_ID,
            currency_code: 'USD'
          }
        ]
      ])
    );

    vi.spyOn(adapter as any, 'loadCharges').mockResolvedValue(
      new Map([
        [
          'charge-qbo-1',
          {
            item_id: 'charge-qbo-1',
            invoice_id: INVOICE_ID,
            service_id: 'svc-qbo-1',
            description: 'Remote Support - Hourly',
            quantity: 2,
            unit_price: 10_000,
            net_amount: 20_000,
            total_price: 21_775,
            tax_amount: 1_775,
            tax_region: 'US-NY'
          }
        ]
      ])
    );

    vi.spyOn(adapter as any, 'loadClients').mockResolvedValue({
      clients: new Map([
        [
          CLIENT_ID,
          {
            client_id: CLIENT_ID,
            client_name: 'Acme',
            billing_email: 'a@a',
            payment_terms: null
          }
        ]
      ]),
      mappings: new Map([
        [
          CLIENT_ID,
          {
            id: 'mapping-qbo-1',
            integration_type: 'quickbooks_online',
            alga_entity_type: 'client',
            alga_entity_id: CLIENT_ID,
            external_entity_id: 'external-customer-acme',
            metadata: { source: 'mapping_table' }
          }
        ]
      ])
    });

    const result = await adapter.transform(context);
    const invoice = (result.documents[0]?.payload as any).invoice;
    const line = invoice.Line[0];

    expect(line.Amount).toBe(200.00); // still pre-tax
    expect(invoice.TxnTaxDetail).toBeUndefined(); // QBO owns tax in delegate mode
  });

  it('throws QBO_CHARGE_MISSING_NET_AMOUNT when a charge has no net_amount', async () => {
    const adapter = new QuickBooksOnlineAdapter();
    const context = buildContext([baseLine]);

    vi.spyOn(adapter as any, 'loadInvoices').mockResolvedValue(
      new Map([
        [
          INVOICE_ID,
          {
            invoice_id: INVOICE_ID,
            invoice_number: 'INV-QBO-NONET',
            invoice_date: '2026-04-16',
            due_date: '2026-04-30',
            client_id: CLIENT_ID,
            currency_code: 'USD'
          }
        ]
      ])
    );

    vi.spyOn(adapter as any, 'loadCharges').mockResolvedValue(
      new Map([
        [
          'charge-qbo-1',
          {
            item_id: 'charge-qbo-1',
            invoice_id: INVOICE_ID,
            service_id: 'svc-qbo-1',
            description: 'Legacy charge',
            quantity: 1,
            unit_price: 10_000,
            // net_amount intentionally absent — simulates a pre-migration row
            total_price: 10_000,
            tax_amount: 0,
            tax_region: null
          }
        ]
      ])
    );

    vi.spyOn(adapter as any, 'loadClients').mockResolvedValue({
      clients: new Map([
        [
          CLIENT_ID,
          {
            client_id: CLIENT_ID,
            client_name: 'Acme',
            billing_email: 'a@a',
            payment_terms: null
          }
        ]
      ]),
      mappings: new Map([
        [
          CLIENT_ID,
          {
            id: 'mapping-qbo-1',
            integration_type: 'quickbooks_online',
            alga_entity_type: 'client',
            alga_entity_id: CLIENT_ID,
            external_entity_id: 'external-customer-acme',
            metadata: { source: 'mapping_table' }
          }
        ]
      ])
    });

    await expect(adapter.transform(context)).rejects.toMatchObject({
      code: 'QBO_CHARGE_MISSING_NET_AMOUNT'
    });
  });
});
