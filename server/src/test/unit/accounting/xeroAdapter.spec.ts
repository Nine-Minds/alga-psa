import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { XeroAdapter } from '../../../../../packages/billing/src/adapters/accounting/xeroAdapter';
import { AccountingExportAdapterContext } from '@alga-psa/types';
import { AccountingMappingResolver } from '../../../../../packages/billing/src/services/accountingMappingResolver';
import { XeroClientService } from '@alga-psa/integrations/lib/xero/xeroClientService';
import * as dbModule from 'server/src/lib/db';

/**
 * Specs referenced from:
 * https://developer.xero.com/documentation/accounting/invoices
 */

const TENANT_ID = 'tenant-xero-spec';
const BATCH_ID = 'batch-xero-spec';
const INVOICE_ID = 'inv-xero-spec';
const CHARGE_ID = 'charge-xero-spec';
const CLIENT_ID = 'client-xero-spec';

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
      batch_id: BATCH_ID,
      tenant: TENANT_ID,
      adapter_type: 'xero',
      export_type: 'invoice',
      target_realm: 'realm-demo',
      status: 'ready',
      queued_at: now,
      created_at: now,
      updated_at: now,
      notes: null
    } as any,
    lines: lines as any
  };
}

describe('XeroAdapter – spec validation scaffolding', () => {
  const mockResolver = {
    resolveServiceMapping: vi.fn(),
    resolveTaxCodeMapping: vi.fn()
  };

  const baseLine: MinimalLine = {
    line_id: 'line-1',
    batch_id: BATCH_ID,
    invoice_id: INVOICE_ID,
    invoice_charge_id: CHARGE_ID,
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
    vi.spyOn(AccountingMappingResolver, 'create').mockResolvedValue(mockResolver as unknown as AccountingMappingResolver);
    mockResolver.resolveServiceMapping.mockResolvedValue({
      external_entity_id: 'ITEM-001',
      metadata: {
        accountCode: '200',
        taxType: 'OUTPUT',
        lineAmountType: 'Exclusive',
        tracking: [{ name: 'Region', option: 'North' }]
      }
    });
    mockResolver.resolveTaxCodeMapping.mockResolvedValue({
      external_entity_id: 'OUTPUT',
      metadata: {
        components: [
          { name: 'GST', rate: 15 }
        ]
      }
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('builds invoice payloads that satisfy POST Invoices required fields', async () => {
    const adapter = new XeroAdapter();
    const context = buildContext([baseLine]);
    const invoiceDate = '2025-02-10';

    vi.spyOn(adapter as any, 'loadInvoices').mockResolvedValue(
      new Map([
        [
          INVOICE_ID,
          {
            invoice_id: INVOICE_ID,
            invoice_number: 'INV-1001',
            invoice_date: invoiceDate,
            due_date: '2025-02-20',
            client_id: CLIENT_ID,
            currency_code: 'USD'
          }
        ]
      ])
    );

    vi.spyOn(adapter as any, 'loadCharges').mockResolvedValue(
      new Map([
        [
          CHARGE_ID,
          {
            item_id: CHARGE_ID,
            invoice_id: INVOICE_ID,
            service_id: 'svc-123',
            description: 'Consulting services',
            quantity: 1,
            unit_price: 12_345,
            total_price: 12_345,
            tax_amount: 1_235,
            tax_region: 'tax-region'
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
            billing_email: 'billing@example.com'
          }
        ]
      ]),
      mappings: new Map([
        [
          CLIENT_ID,
          {
            id: 'mapping-1',
            integration_type: 'xero',
            alga_entity_type: 'client',
            alga_entity_id: CLIENT_ID,
            external_entity_id: 'external-contact-1',
            metadata: { source: 'mapping_table' }
          }
        ]
      ])
    });

    const result = await adapter.transform(context);
    expect(result.documents).toHaveLength(1);

    const document = result.documents[0];
    const payload = document.payload as Record<string, any>;
    const invoice = payload.invoice;
    expect(invoice).toBeTruthy();
    expect(invoice.contactId).toBe('external-contact-1');
    expect(invoice.lines).toHaveLength(1);
    expect(invoice.amountCents).toBeGreaterThan(0);
    expect(invoice.invoiceDate).toBe('2025-02-10');
    expect(invoice.dueDate).toBe('2025-02-20');
    expect(['Exclusive', 'Inclusive', 'NoTax']).toContain(invoice.lineAmountType);
    const line = invoice.lines[0];
    expect(line.description).toMatch(/Consulting services/);
    expect(line.itemCode).toBe('ITEM-001');
    expect(line.accountCode).toBe('200');
    expect(line.taxType).toBe('OUTPUT');
    expect(line.tracking?.[0]).toMatchObject({ name: 'Region', option: 'North' });
    expect(Array.isArray(line.taxComponents ?? [])).toBe(true);
  });

  it('merges mapping and resolver tax metadata to include multiple tax components', async () => {
    const adapter = new XeroAdapter();
    const context = buildContext([baseLine]);

    mockResolver.resolveServiceMapping.mockResolvedValue({
      external_entity_id: 'ITEM-002',
      metadata: {
        accountCode: '400',
        taxType: 'TAX001',
        tracking: [{ name: 'Region', option: 'West' }],
        taxComponents: [
          { name: 'GST', rate: 5, amountCents: 500 },
          { name: 'PST', rate: 7, amountCents: 700 }
        ]
      }
    });

    mockResolver.resolveTaxCodeMapping.mockResolvedValue({
      external_entity_id: 'TAX001',
      metadata: {
        components: [
          { name: 'GST', rate: 5, amountCents: 500 },
          { name: 'PST', rate: 7, amountCents: 700 }
        ]
      }
    });

    vi.spyOn(adapter as any, 'loadInvoices').mockResolvedValue(
      new Map([
        [
          INVOICE_ID,
          {
            invoice_id: INVOICE_ID,
            invoice_number: 'INV-2001',
            invoice_date: '2025-03-01',
            due_date: '2025-03-15',
            client_id: CLIENT_ID,
            currency_code: 'CAD'
          }
        ]
      ])
    );

    vi.spyOn(adapter as any, 'loadCharges').mockResolvedValue(
      new Map([
        [
          CHARGE_ID,
          {
            item_id: CHARGE_ID,
            invoice_id: INVOICE_ID,
            service_id: 'svc-456',
            description: 'Managed backup',
            quantity: 1,
            unit_price: 20_000,
            total_price: 20_000,
            tax_amount: 2_400,
            tax_region: 'tax-region'
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
            client_name: 'Northwind',
            billing_email: 'finance@northwind.test'
          }
        ]
      ]),
      mappings: new Map([
        [
          CLIENT_ID,
          {
            id: 'mapping-1',
            integration_type: 'xero',
            alga_entity_type: 'client',
            alga_entity_id: CLIENT_ID,
            external_entity_id: 'external-contact-20',
            metadata: { source: 'mapping_table' }
          }
        ]
      ])
    });

    const result = await adapter.transform(context);
    const document = result.documents[0];
    const invoice = (document.payload as Record<string, any>).invoice;
    const line = invoice.lines[0];
    expect(line.taxComponents).toEqual([
      { name: 'GST', rate: 5, amountCents: 500 },
      { name: 'PST', rate: 7, amountCents: 700 }
    ]);
    expect(invoice.lineAmountType).toBe('Exclusive');
  });

  it('carries canonical service-period ranges through Xero line payloads and keeps null fallbacks periodless', async () => {
    const adapter = new XeroAdapter();
    const context = buildContext([
      {
        ...baseLine,
        line_id: 'line-range',
        invoice_charge_id: 'charge-range',
        service_period_start: '2025-01-01T00:00:00.000Z',
        service_period_end: '2025-03-01T00:00:00.000Z',
        payload: {
          service_period_source: 'canonical_detail_periods'
        }
      },
      {
        ...baseLine,
        line_id: 'line-financial',
        invoice_charge_id: 'charge-financial',
        amount_cents: 4_000,
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
            invoice_number: 'INV-3001',
            invoice_date: '2025-03-01',
            due_date: '2025-03-15',
            client_id: CLIENT_ID,
            currency_code: 'USD'
          }
        ]
      ])
    );

    vi.spyOn(adapter as any, 'loadCharges').mockResolvedValue(
      new Map([
        [
          'charge-range',
          {
            item_id: 'charge-range',
            invoice_id: INVOICE_ID,
            service_id: 'svc-range',
            description: 'Managed services',
            quantity: 1,
            unit_price: 12_345,
            total_price: 12_345,
            tax_amount: 1_235,
            tax_region: 'tax-region'
          }
        ],
        [
          'charge-financial',
          {
            item_id: 'charge-financial',
            invoice_id: INVOICE_ID,
            service_id: 'svc-financial',
            description: 'Credit adjustment',
            quantity: 1,
            unit_price: 4_000,
            total_price: 4_000,
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
            billing_email: 'billing@example.com'
          }
        ]
      ]),
      mappings: new Map([
        [
          CLIENT_ID,
          {
            id: 'mapping-1',
            integration_type: 'xero',
            alga_entity_type: 'client',
            alga_entity_id: CLIENT_ID,
            external_entity_id: 'external-contact-1',
            metadata: { source: 'mapping_table' }
          }
        ]
      ])
    });

    const result = await adapter.transform(context);
    const invoice = (result.documents[0]?.payload as Record<string, any>).invoice;
    expect(invoice.lines).toHaveLength(2);
    expect(invoice.lines[0]).toMatchObject({
      servicePeriodStart: '2025-01-01T00:00:00.000Z',
      servicePeriodEnd: '2025-03-01T00:00:00.000Z'
    });
    expect(invoice.lines[1]).toMatchObject({
      servicePeriodStart: null,
      servicePeriodEnd: null
    });
  });

  it('T274: Xero adapter preserves mixed-cadence recurring service periods line-by-line inside one exported invoice', async () => {
    const adapter = new XeroAdapter();
    const context = buildContext([
      {
        ...baseLine,
        line_id: 'line-client-cadence',
        invoice_charge_id: 'charge-client-cadence',
        service_period_start: '2025-02-01T00:00:00.000Z',
        service_period_end: '2025-03-01T00:00:00.000Z',
        payload: {
          service_period_source: 'canonical_detail_periods',
          cadence_owner: 'client'
        }
      },
      {
        ...baseLine,
        line_id: 'line-contract-cadence',
        invoice_charge_id: 'charge-contract-cadence',
        amount_cents: 9_500,
        service_period_start: '2025-02-08T00:00:00.000Z',
        service_period_end: '2025-03-08T00:00:00.000Z',
        payload: {
          service_period_source: 'canonical_detail_periods',
          cadence_owner: 'contract'
        }
      }
    ]);

    vi.spyOn(adapter as any, 'loadInvoices').mockResolvedValue(
      new Map([
        [
          INVOICE_ID,
          {
            invoice_id: INVOICE_ID,
            invoice_number: 'INV-274',
            invoice_date: '2025-02-10',
            due_date: '2025-02-25',
            client_id: CLIENT_ID,
            currency_code: 'USD'
          }
        ]
      ])
    );

    vi.spyOn(adapter as any, 'loadCharges').mockResolvedValue(
      new Map([
        [
          'charge-client-cadence',
          {
            item_id: 'charge-client-cadence',
            invoice_id: INVOICE_ID,
            service_id: 'svc-client-cadence',
            description: 'Client cadence managed services',
            quantity: 1,
            unit_price: 12_345,
            total_price: 12_345,
            tax_amount: 1_235,
            tax_region: 'tax-region'
          }
        ],
        [
          'charge-contract-cadence',
          {
            item_id: 'charge-contract-cadence',
            invoice_id: INVOICE_ID,
            service_id: 'svc-contract-cadence',
            description: 'Contract cadence backup',
            quantity: 1,
            unit_price: 9_500,
            total_price: 9_500,
            tax_amount: 950,
            tax_region: 'tax-region'
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
            billing_email: 'billing@example.com'
          }
        ]
      ]),
      mappings: new Map([
        [
          CLIENT_ID,
          {
            id: 'mapping-1',
            integration_type: 'xero',
            alga_entity_type: 'client',
            alga_entity_id: CLIENT_ID,
            external_entity_id: 'external-contact-1',
            metadata: { source: 'mapping_table' }
          }
        ]
      ])
    });

    const result = await adapter.transform(context);
    const invoice = (result.documents[0]?.payload as Record<string, any>).invoice;
    expect(invoice.lines).toHaveLength(2);
    expect(invoice.lines[0]).toMatchObject({
      servicePeriodStart: '2025-02-01T00:00:00.000Z',
      servicePeriodEnd: '2025-03-01T00:00:00.000Z'
    });
    expect(invoice.lines[1]).toMatchObject({
      servicePeriodStart: '2025-02-08T00:00:00.000Z',
      servicePeriodEnd: '2025-03-08T00:00:00.000Z'
    });
  });

  it('delivers payloads conforming to Xero POST expectations', async () => {
    const adapter = new XeroAdapter();
    const context = buildContext([baseLine]);

    vi.spyOn(adapter as any, 'loadInvoices').mockResolvedValue(
      new Map([
        [
          INVOICE_ID,
          {
            invoice_id: INVOICE_ID,
            invoice_number: null,
            invoice_date: '2025-02-05',
            due_date: '2025-02-28',
            client_id: CLIENT_ID,
            currency_code: 'USD'
          }
        ]
      ])
    );

    vi.spyOn(adapter as any, 'loadCharges').mockResolvedValue(
      new Map([
        [
          CHARGE_ID,
          {
            item_id: CHARGE_ID,
            invoice_id: INVOICE_ID,
            service_id: 'svc-123',
            description: 'Monthly subscription',
            quantity: 2,
            unit_price: 6_000,
            total_price: 12_000,
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
            client_name: 'Example Ltd',
            billing_email: 'accounts@example.com'
          }
        ]
      ]),
      mappings: new Map([
        [
          CLIENT_ID,
          {
            id: 'mapping-1',
            integration_type: 'xero',
            alga_entity_type: 'client',
            alga_entity_id: CLIENT_ID,
            external_entity_id: 'external-contact-123',
            metadata: { source: 'mapping_table' }
          }
        ]
      ])
    });

    const transformResult = await adapter.transform(context);

    const createSpy = vi.spyOn(XeroClientService, 'create').mockResolvedValue({
      createInvoices: async (payloads: any[]) => {
        expect(payloads).toHaveLength(1);
        const invoice = payloads[0];
        expect(invoice.contactId).toBe('external-contact-123');
        expect(invoice.lines.length).toBeGreaterThan(0);
        expect(invoice.lineAmountType === 'Exclusive' || invoice.lineAmountType === 'Inclusive' || invoice.lineAmountType === 'NoTax').toBe(true);
        invoice.lines.forEach((line: any) => {
          expect(typeof line.description).toBe('string');
          expect(line.description.length).toBeGreaterThan(0);
          expect(line.accountCode || line.itemCode).toBeTruthy();
        });
        expect(invoice.invoiceDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(invoice.dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        return payloads.map((payload) => ({
          status: 'success',
          invoiceId: `XERO-${payload.invoiceId}`,
          documentId: payload.invoiceId
        }));
      }
    } as unknown as XeroClientService);

    const delivery = await adapter.deliver(transformResult, context);
    expect(delivery.deliveredLines).toHaveLength(1);
    expect(createSpy).toHaveBeenCalledWith(TENANT_ID, 'realm-demo');
  });
});
