import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const qboClientCreateMock = vi.hoisted(() => vi.fn());
const getDefaultQboRealmIdMock = vi.hoisted(() => vi.fn());
const getAccountingSyncSettingsMock = vi.hoisted(() => vi.fn(async () => ({
  autoSyncEnabled: false,
  autoSyncStartDate: null,
  depositAccountRef: null,
  defaultClassRef: null,
  defaultDepartmentRef: null,
  defaultRealm: null
})));

vi.mock('@alga-psa/integrations/lib/qbo/qboClientService', () => ({
  QboClientService: { create: qboClientCreateMock },
  getDefaultQboRealmId: getDefaultQboRealmIdMock
}));

vi.mock('../../../../../packages/billing/src/services/accountingSync/accountingSyncSettings', () => ({
  getAccountingSyncSettings: getAccountingSyncSettingsMock
}));

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
  document_id: string;
  document_line_id: string;
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
    document_id: INVOICE_ID,
    document_line_id: 'charge-qbo-1',
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
        document_line_id: 'charge-qbo-client',
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
        document_line_id: 'charge-qbo-contract',
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

describe('QuickBooksOnlineAdapter credit-note (CreditMemo) transform', () => {
  const mockResolver = {
    resolveServiceMapping: vi.fn(),
    resolveTaxCodeMapping: vi.fn(),
    resolvePaymentTermMapping: vi.fn()
  };

  const creditNoteLine: MinimalLine = {
    line_id: 'line-cn-1',
    batch_id: 'batch-qbo-spec',
    document_id: 'inv-cn-1',
    document_line_id: 'charge-cn-1',
    client_id: CLIENT_ID,
    amount_cents: -5000,
    currency_code: 'USD',
    status: 'ready',
    payload: { service_period_source: 'financial_document_fallback' },
    mapping_resolution: null,
    service_period_start: null,
    service_period_end: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  beforeEach(() => {
    mockResolver.resolveServiceMapping.mockReset();
    mockResolver.resolveTaxCodeMapping.mockReset();
    mockResolver.resolvePaymentTermMapping?.mockReset?.();
    vi.spyOn(dbModule, 'createTenantKnex').mockResolvedValue({ knex: {} as any, tenant: TENANT_ID });
    vi.spyOn(AccountingMappingResolver, 'create').mockResolvedValue(
      mockResolver as unknown as AccountingMappingResolver
    );
    mockResolver.resolveServiceMapping.mockResolvedValue({ external_entity_id: 'ITEM-CN-1', metadata: {} });
    mockResolver.resolveTaxCodeMapping.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sign-flips negative net_amount to positive Amount and sets documentType=CreditMemo', async () => {
    const adapter = new QuickBooksOnlineAdapter();
    const context = buildContext([creditNoteLine]);

    vi.spyOn(adapter as any, 'loadInvoices').mockResolvedValue(
      new Map([
        [
          'inv-cn-1',
          {
            invoice_id: 'inv-cn-1',
            invoice_number: 'CM-0001',
            invoice_date: '2026-05-01',
            due_date: '2026-05-15',
            total_amount: -5000,
            client_id: CLIENT_ID,
            currency_code: 'USD',
            invoice_type: 'credit_note'
          }
        ]
      ])
    );

    vi.spyOn(adapter as any, 'loadCharges').mockResolvedValue(
      new Map([
        [
          'charge-cn-1',
          {
            item_id: 'charge-cn-1',
            invoice_id: 'inv-cn-1',
            service_id: 'svc-cn-1',
            description: 'SLA credit',
            quantity: 1,
            unit_price: -5000,
            net_amount: -5000,
            total_price: -5000,
            tax_amount: 0,
            tax_region: null
          }
        ]
      ])
    );

    vi.spyOn(adapter as any, 'loadClients').mockResolvedValue({
      clients: new Map([[CLIENT_ID, { client_id: CLIENT_ID, client_name: 'Acme Corp', billing_email: 'a@a', payment_terms: null }]]),
      mappings: new Map([[CLIENT_ID, { id: 'm1', integration_type: 'quickbooks_online', alga_entity_type: 'client', alga_entity_id: CLIENT_ID, external_entity_id: 'qb-cust-1', metadata: {} }]])
    });

    const result = await adapter.transform(context);
    const payload = result.documents[0]?.payload as any;

    // Amount must be positive (sign-flipped)
    expect(payload.invoice.Line[0].Amount).toBe(50); // 5000 cents → $50.00
    // UnitPrice must also be positive
    expect(payload.invoice.Line[0].SalesItemLineDetail.UnitPrice).toBe(50);
    // documentType discriminates for deliver()
    expect(payload.documentType).toBe('CreditMemo');
  });

  it('sign-flips with tax: both net_amount and tax_amount become positive', async () => {
    const adapter = new QuickBooksOnlineAdapter();
    const lineWithTax: MinimalLine = { ...creditNoteLine, line_id: 'line-cn-tax' };
    const context: AccountingExportAdapterContext = {
      ...buildContext([lineWithTax]),
      taxDelegationMode: 'none',
      excludeTaxFromExport: false
    } as AccountingExportAdapterContext;

    vi.spyOn(adapter as any, 'loadInvoices').mockResolvedValue(
      new Map([
        [
          'inv-cn-1',
          {
            invoice_id: 'inv-cn-1',
            invoice_number: 'CM-0002',
            invoice_date: '2026-05-01',
            due_date: '2026-05-15',
            total_amount: -5500,
            client_id: CLIENT_ID,
            currency_code: 'USD',
            invoice_type: 'credit_note'
          }
        ]
      ])
    );

    vi.spyOn(adapter as any, 'loadCharges').mockResolvedValue(
      new Map([
        [
          'charge-cn-1',
          {
            item_id: 'charge-cn-1',
            invoice_id: 'inv-cn-1',
            service_id: 'svc-cn-1',
            description: 'SLA credit with tax',
            quantity: 1,
            unit_price: -5000,
            net_amount: -5000,
            total_price: -5500,
            tax_amount: -500, // negative in Alga
            tax_region: null
          }
        ]
      ])
    );

    vi.spyOn(adapter as any, 'loadClients').mockResolvedValue({
      clients: new Map([[CLIENT_ID, { client_id: CLIENT_ID, client_name: 'Acme', billing_email: 'a@a', payment_terms: null }]]),
      mappings: new Map([[CLIENT_ID, { id: 'm1', integration_type: 'quickbooks_online', alga_entity_type: 'client', alga_entity_id: CLIENT_ID, external_entity_id: 'qb-cust-1', metadata: {} }]])
    });

    const result = await adapter.transform(context);
    const payload = result.documents[0]?.payload as any;

    expect(payload.invoice.Line[0].Amount).toBe(50); // positive
    // Tax total also positive
    expect(payload.invoice.TxnTaxDetail?.TotalTax).toBe(5); // 500 cents → $5
    expect(payload.documentType).toBe('CreditMemo');
  });
});

describe('QuickBooksOnlineAdapter deliver CreditMemo branch', () => {
  beforeEach(() => {
    qboClientCreateMock.mockReset();
    getDefaultQboRealmIdMock.mockReset();
    vi.spyOn(dbModule, 'createTenantKnex').mockResolvedValue({ knex: {} as any, tenant: TENANT_ID });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls create("CreditMemo", ...) for a document with documentType=CreditMemo', async () => {
    // qboClientCreateMock IS QboClientService.create (the factory).
    // It must resolve to a mock QBO client instance (with .create/.read/.update methods).
    const qboClientInstanceCreateMock = vi.fn(async () => ({ Id: 'cm-qbo-1', SyncToken: '0', DocNumber: 'CM-0001', Line: [] }));
    const mockQboClient = {
      create: qboClientInstanceCreateMock,
      read: vi.fn(async () => null),
      update: vi.fn(async () => ({}))
    };
    qboClientCreateMock.mockResolvedValue(mockQboClient);

    const { KnexInvoiceMappingRepository } = await import(
      '../../../../../packages/billing/src/repositories/invoiceMappingRepository'
    );
    vi.spyOn(KnexInvoiceMappingRepository.prototype, 'findInvoiceMapping').mockResolvedValue(null);
    vi.spyOn(KnexInvoiceMappingRepository.prototype, 'upsertInvoiceMapping').mockResolvedValue(undefined);

    const adapter = new QuickBooksOnlineAdapter();
    const context = buildContext([]);

    const creditMemoPayload = {
      invoice: {
        DocNumber: 'CM-0001',
        TxnDate: '2026-05-01',
        CustomerRef: { value: 'qb-cust-1' },
        Line: [{ Amount: 50, DetailType: 'SalesItemLineDetail', SalesItemLineDetail: { ItemRef: { value: 'ITEM-1' }, Qty: 1, UnitPrice: 50 } }]
      },
      clientId: CLIENT_ID,
      chargeIds: ['charge-cn-1'],
      mapping: { customerId: 'qb-cust-1' },
      totals: { amountCents: 5000 },
      documentType: 'CreditMemo'
    };

    await adapter.deliver({
      documents: [{
        documentId: 'inv-cn-1',
        lineIds: ['line-cn-1'],
        payload: creditMemoPayload as any
      }]
    } as any, context);

    // Should have called qboClient.create with 'CreditMemo' not 'Invoice'
    expect(qboClientInstanceCreateMock).toHaveBeenCalledWith('CreditMemo', expect.any(Object));
    expect(qboClientInstanceCreateMock).not.toHaveBeenCalledWith('Invoice', expect.any(Object));
  });
});

describe('QuickBooksOnlineAdapter deliver realm defaulting', () => {
  beforeEach(() => {
    qboClientCreateMock.mockReset();
    getDefaultQboRealmIdMock.mockReset();
    vi.spyOn(dbModule, 'createTenantKnex').mockResolvedValue({ knex: {} as any, tenant: TENANT_ID });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('falls back to the default stored realm when batch.target_realm is null', async () => {
    getDefaultQboRealmIdMock.mockResolvedValue('realm-default-1');
    qboClientCreateMock.mockResolvedValue({} as any);

    const adapter = new QuickBooksOnlineAdapter();
    const context = buildContext([]);
    (context.batch as any).target_realm = null;

    const result = await adapter.deliver({ documents: [] } as any, context);

    expect(getDefaultQboRealmIdMock).toHaveBeenCalledWith(TENANT_ID);
    expect(qboClientCreateMock).toHaveBeenCalledWith(TENANT_ID, 'realm-default-1');
    expect(result.deliveredLines).toEqual([]);
  });

  it('keeps using the batch target realm when one is stamped', async () => {
    qboClientCreateMock.mockResolvedValue({} as any);

    const adapter = new QuickBooksOnlineAdapter();
    const context = buildContext([]);

    await adapter.deliver({ documents: [] } as any, context);

    expect(getDefaultQboRealmIdMock).not.toHaveBeenCalled();
    expect(qboClientCreateMock).toHaveBeenCalledWith(TENANT_ID, 'realm-qbo-demo');
  });

  it('throws a clear error when no realm is stamped and none is connected', async () => {
    getDefaultQboRealmIdMock.mockResolvedValue(null);

    const adapter = new QuickBooksOnlineAdapter();
    const context = buildContext([]);
    (context.batch as any).target_realm = null;

    await expect(adapter.deliver({ documents: [] } as any, context)).rejects.toThrow(
      /connected QuickBooks Online company/
    );
    expect(qboClientCreateMock).not.toHaveBeenCalled();
  });
});

// ─── Class & Department transform tests ────────────────────────────────────────

describe('QuickBooksOnlineAdapter class/department transform', () => {
  const mockResolver = {
    resolveServiceMapping: vi.fn(),
    resolveTaxCodeMapping: vi.fn()
  };

  const baseLine: MinimalLine = {
    line_id: 'line-cls-1',
    batch_id: 'batch-cls',
    document_id: INVOICE_ID,
    document_line_id: 'charge-cls-1',
    client_id: CLIENT_ID,
    amount_cents: 10_000,
    currency_code: 'USD',
    status: 'ready',
    payload: null,
    mapping_resolution: null,
    service_period_start: null,
    service_period_end: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  const baseInvoice = {
    invoice_id: INVOICE_ID,
    invoice_number: 'INV-CLS-001',
    invoice_date: '2026-01-01',
    due_date: '2026-01-30',
    total_amount: 10_000,
    client_id: CLIENT_ID,
    currency_code: 'USD'
  };

  const baseCharge = {
    item_id: 'charge-cls-1',
    invoice_id: INVOICE_ID,
    service_id: 'svc-cls-1',
    description: 'Managed services',
    quantity: 1,
    unit_price: 10_000,
    net_amount: 10_000,
    total_price: 10_000,
    tax_amount: 0,
    tax_region: null
  };

  const baseClientMapping = {
    clients: new Map([[CLIENT_ID, { client_id: CLIENT_ID, client_name: 'Acme', billing_email: null, payment_terms: null }]]),
    mappings: new Map([[CLIENT_ID, { id: 'm-1', integration_type: 'quickbooks_online', alga_entity_type: 'client', alga_entity_id: CLIENT_ID, external_entity_id: 'qb-cust-1', metadata: null }]])
  };

  beforeEach(() => {
    mockResolver.resolveServiceMapping.mockReset();
    mockResolver.resolveTaxCodeMapping.mockReset();
    getAccountingSyncSettingsMock.mockReset();
    vi.spyOn(dbModule, 'createTenantKnex').mockResolvedValue({ knex: {} as any, tenant: TENANT_ID });
    vi.spyOn(AccountingMappingResolver, 'create').mockResolvedValue(mockResolver as unknown as AccountingMappingResolver);
    mockResolver.resolveTaxCodeMapping.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses item mapping metadata.classId over tenant default class', async () => {
    // item metadata has classId, tenant also has a default — item wins
    getAccountingSyncSettingsMock.mockResolvedValue({
      autoSyncEnabled: false,
      autoSyncStartDate: null,
      depositAccountRef: null,
      defaultClassRef: { value: 'cls-tenant', name: 'Tenant Default' },
      defaultDepartmentRef: null,
      defaultRealm: null
    });
    mockResolver.resolveServiceMapping.mockResolvedValue({
      external_entity_id: 'ITEM-1',
      metadata: { classId: 'cls-item' }
    });

    const adapter = new QuickBooksOnlineAdapter();
    const context = buildContext([{ ...baseLine }]);
    vi.spyOn(adapter as any, 'loadInvoices').mockResolvedValue(new Map([[INVOICE_ID, baseInvoice]]));
    vi.spyOn(adapter as any, 'loadCharges').mockResolvedValue(new Map([['charge-cls-1', baseCharge]]));
    vi.spyOn(adapter as any, 'loadClients').mockResolvedValue(baseClientMapping);

    const result = await adapter.transform(context);
    const salesDetail = (result.documents[0].payload as any).invoice.Line[0].SalesItemLineDetail;

    expect(salesDetail.ClassRef).toEqual({ value: 'cls-item' });
  });

  it('falls back to tenant default class when item mapping has no classId', async () => {
    getAccountingSyncSettingsMock.mockResolvedValue({
      autoSyncEnabled: false,
      autoSyncStartDate: null,
      depositAccountRef: null,
      defaultClassRef: { value: 'cls-default', name: 'Managed Services' },
      defaultDepartmentRef: null,
      defaultRealm: null
    });
    mockResolver.resolveServiceMapping.mockResolvedValue({
      external_entity_id: 'ITEM-1',
      metadata: {} // no classId
    });

    const adapter = new QuickBooksOnlineAdapter();
    const context = buildContext([{ ...baseLine }]);
    vi.spyOn(adapter as any, 'loadInvoices').mockResolvedValue(new Map([[INVOICE_ID, baseInvoice]]));
    vi.spyOn(adapter as any, 'loadCharges').mockResolvedValue(new Map([['charge-cls-1', baseCharge]]));
    vi.spyOn(adapter as any, 'loadClients').mockResolvedValue(baseClientMapping);

    const result = await adapter.transform(context);
    const salesDetail = (result.documents[0].payload as any).invoice.Line[0].SalesItemLineDetail;

    expect(salesDetail.ClassRef).toEqual({ value: 'cls-default' });
  });

  it('omits ClassRef/DepartmentRef when no class or department configured', async () => {
    getAccountingSyncSettingsMock.mockResolvedValue({
      autoSyncEnabled: false,
      autoSyncStartDate: null,
      depositAccountRef: null,
      defaultClassRef: null,
      defaultDepartmentRef: null,
      defaultRealm: null
    });
    mockResolver.resolveServiceMapping.mockResolvedValue({
      external_entity_id: 'ITEM-1',
      metadata: {} // no classId
    });

    const adapter = new QuickBooksOnlineAdapter();
    const context = buildContext([{ ...baseLine }]);
    vi.spyOn(adapter as any, 'loadInvoices').mockResolvedValue(new Map([[INVOICE_ID, baseInvoice]]));
    vi.spyOn(adapter as any, 'loadCharges').mockResolvedValue(new Map([['charge-cls-1', baseCharge]]));
    vi.spyOn(adapter as any, 'loadClients').mockResolvedValue(baseClientMapping);

    const result = await adapter.transform(context);
    const payload = result.documents[0].payload as any;
    const salesDetail = payload.invoice.Line[0].SalesItemLineDetail;
    const invoiceHeader = payload.invoice;

    expect(salesDetail.ClassRef).toBeUndefined();
    expect(invoiceHeader.DepartmentRef).toBeUndefined();
  });

  it('sets DepartmentRef on the invoice header from tenant default department', async () => {
    getAccountingSyncSettingsMock.mockResolvedValue({
      autoSyncEnabled: false,
      autoSyncStartDate: null,
      depositAccountRef: null,
      defaultClassRef: null,
      defaultDepartmentRef: { value: 'dept-east', name: 'East Region' },
      defaultRealm: null
    });
    mockResolver.resolveServiceMapping.mockResolvedValue({
      external_entity_id: 'ITEM-1',
      metadata: {}
    });

    const adapter = new QuickBooksOnlineAdapter();
    const context = buildContext([{ ...baseLine }]);
    vi.spyOn(adapter as any, 'loadInvoices').mockResolvedValue(new Map([[INVOICE_ID, baseInvoice]]));
    vi.spyOn(adapter as any, 'loadCharges').mockResolvedValue(new Map([['charge-cls-1', baseCharge]]));
    vi.spyOn(adapter as any, 'loadClients').mockResolvedValue(baseClientMapping);

    const result = await adapter.transform(context);
    const invoiceHeader = (result.documents[0].payload as any).invoice;

    expect(invoiceHeader.DepartmentRef).toEqual({ value: 'dept-east' });
  });
});

describe('QuickBooksOnlineAdapter customer auto-provisioning gate', () => {
  const mockResolver = {
    resolveServiceMapping: vi.fn(),
    resolveTaxCodeMapping: vi.fn(),
    ensureCompanyMapping: vi.fn()
  };

  const gateLine: MinimalLine = {
    line_id: 'line-gate-1',
    batch_id: 'batch-qbo-spec',
    document_id: INVOICE_ID,
    document_line_id: 'charge-gate-1',
    client_id: CLIENT_ID,
    amount_cents: 10_000,
    currency_code: 'USD',
    status: 'ready',
    payload: null,
    mapping_resolution: null,
    service_period_start: null,
    service_period_end: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  function spyLoadersWithUnmappedClient(adapter: QuickBooksOnlineAdapter) {
    vi.spyOn(adapter as any, 'loadInvoices').mockResolvedValue(
      new Map([
        [
          INVOICE_ID,
          {
            invoice_id: INVOICE_ID,
            invoice_number: 'INV-GATE-1',
            invoice_date: '2026-06-05',
            due_date: '2026-06-20',
            total_amount: 10_000,
            client_id: CLIENT_ID,
            currency_code: 'USD'
          }
        ]
      ])
    );
    vi.spyOn(adapter as any, 'loadCharges').mockResolvedValue(
      new Map([
        [
          'charge-gate-1',
          {
            item_id: 'charge-gate-1',
            invoice_id: INVOICE_ID,
            service_id: 'svc-gate-1',
            description: 'Managed services',
            quantity: 1,
            unit_price: 10_000,
            net_amount: 10_000,
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
            client_name: 'Unmapped Newco LLC',
            billing_email: 'billing@example.com',
            payment_terms: null
          }
        ]
      ]),
      // No mapping: this client has never been through the wizard.
      mappings: new Map()
    });
  }

  beforeEach(() => {
    mockResolver.resolveServiceMapping.mockReset();
    mockResolver.resolveTaxCodeMapping.mockReset();
    mockResolver.ensureCompanyMapping.mockReset();
    getAccountingSyncSettingsMock.mockReset();
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

  it('unmapped client with auto-provisioning off (default) → transform refuses to touch the QBO customer list', async () => {
    getAccountingSyncSettingsMock.mockResolvedValue({
      autoSyncEnabled: true,
      autoSyncStartDate: null,
      autoProvisionCustomers: false,
      depositAccountRef: null,
      defaultClassRef: null,
      defaultDepartmentRef: null,
      defaultRealm: null
    });

    const adapter = new QuickBooksOnlineAdapter();
    spyLoadersWithUnmappedClient(adapter);

    await expect(adapter.transform(buildContext([gateLine]))).rejects.toThrow(
      /automatic customer creation is disabled/i
    );
    expect(mockResolver.ensureCompanyMapping).not.toHaveBeenCalled();
  });

  it('unmapped client with auto-provisioning explicitly enabled → transform provisions through the resolver', async () => {
    getAccountingSyncSettingsMock.mockResolvedValue({
      autoSyncEnabled: true,
      autoSyncStartDate: null,
      autoProvisionCustomers: true,
      depositAccountRef: null,
      defaultClassRef: null,
      defaultDepartmentRef: null,
      defaultRealm: null
    });
    mockResolver.ensureCompanyMapping.mockResolvedValue({
      external_entity_id: 'qb-customer-new',
      metadata: {}
    });

    const adapter = new QuickBooksOnlineAdapter();
    spyLoadersWithUnmappedClient(adapter);

    const result = await adapter.transform(buildContext([gateLine]));

    expect(mockResolver.ensureCompanyMapping).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: CLIENT_ID })
    );
    expect((result.documents[0].payload as any).invoice.CustomerRef).toEqual({ value: 'qb-customer-new' });
  });
});
