/**
 * External Tax Import Integration Tests
 *
 * These tests verify that when an invoice is configured for external tax calculation,
 * the tax amounts from the accounting system (QuickBooks/Xero) are correctly imported
 * back into Alga and the invoice reflects those external tax amounts.
 */

import { beforeAll, afterAll, beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';

import { TestContext } from '../../../../test-utils/testContext';
import { createTestService } from '../../../../test-utils/billingTestHelpers';
import { ExternalInvoiceFetchResult } from '../../../lib/adapters/accounting/accountingExportAdapter';

// We need to import the service after mocking createTenantKnex
let ExternalTaxImportService: any;
let getExternalTaxImportService: any;

const helpers = TestContext.createHelpers();
const HOOK_TIMEOUT = 240_000;

// Variables to hold test context for the mock
let testDb: any;
let testTenant: string;

// Mock createTenantKnex to use test database
vi.mock('../../../lib/db', () => ({
  createTenantKnex: vi.fn().mockImplementation(async () => ({
    knex: testDb,
    tenant: testTenant
  }))
}));

describe('External Tax Import', () => {
  let ctx: TestContext;
  let service: any;

  beforeAll(async () => {
    ctx = await helpers.beforeAll();

    // Set up the mock context
    testDb = ctx.db;
    testTenant = ctx.tenantId;

    // Import the service after mocking
    const serviceModule = await import('../../../lib/services/externalTaxImportService');
    ExternalTaxImportService = serviceModule.ExternalTaxImportService;
    getExternalTaxImportService = serviceModule.getExternalTaxImportService;

    service = new ExternalTaxImportService();
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await helpers.afterAll();
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    ctx = await helpers.beforeEach();
    // Update mock context for each test
    testDb = ctx.db;
    testTenant = ctx.tenantId;
  });

  afterEach(async () => {
    await helpers.afterEach();
    vi.restoreAllMocks();
  });

  /**
   * Helper to create an invoice ready for external tax import.
   */
  async function createInvoiceWithPendingExternalTax(chargeAmounts: number[]): Promise<{
    invoiceId: string;
    chargeIds: string[];
  }> {
    const invoiceId = uuidv4();
    const now = new Date().toISOString();
    const subtotal = chargeAmounts.reduce((sum, amt) => sum + amt, 0);

    // Create service for the charges
    const serviceId = await createTestService(ctx);

    // Create invoice with pending_external tax source
    await ctx.db('invoices').insert({
      invoice_id: invoiceId,
      tenant: ctx.tenantId,
      client_id: ctx.clientId,
      invoice_number: `TEST-${Date.now()}`,
      invoice_date: now,
      due_date: now,
      subtotal,
      tax: 0,
      total_amount: subtotal,
      currency_code: 'USD',
      status: 'draft',
      tax_source: 'pending_external',
      created_at: now,
      updated_at: now
    });

    // Create charges
    const chargeIds: string[] = [];
    for (let i = 0; i < chargeAmounts.length; i++) {
      const chargeId = uuidv4();
      chargeIds.push(chargeId);

      await ctx.db('invoice_charges').insert({
        item_id: chargeId,
        tenant: ctx.tenantId,
        invoice_id: invoiceId,
        service_id: serviceId,
        description: `Line item ${i + 1}`,
        quantity: 1,
        unit_price: chargeAmounts[i],
        total_price: chargeAmounts[i],
        net_amount: chargeAmounts[i],
        tax_amount: 0,
        is_manual: false,
        created_at: now,
        updated_at: now
      });
    }

    return { invoiceId, chargeIds };
  }

  /**
   * Helper to create the external entity mapping (simulating export to accounting system).
   */
  async function createExternalMapping(
    invoiceId: string,
    externalRef: string,
    integrationType: 'quickbooks_online' | 'xero' = 'quickbooks_online'
  ): Promise<void> {
    const now = new Date().toISOString();

    await ctx.db('tenant_external_entity_mappings').insert({
      id: uuidv4(),
      tenant: ctx.tenantId,
      alga_entity_type: 'invoice',
      alga_entity_id: invoiceId,
      integration_type: integrationType,
      external_entity_id: externalRef,
      external_realm_id: 'test-realm-123',
      sync_status: 'synced',
      created_at: now,
      updated_at: now
    });
  }

  /**
   * Mock the adapter's fetchExternalInvoice to return specific tax amounts.
   * Mocks both our local service instance and the singleton used by AccountingExportService.
   */
  function mockAdapterFetchInvoice(
    adapterType: 'quickbooks_online' | 'xero',
    externalRef: string,
    taxAmounts: number[],
    totalTax: number
  ): void {
    const mockResult: ExternalInvoiceFetchResult = {
      success: true,
      invoice: {
        externalInvoiceId: `ext-${externalRef}`,
        externalInvoiceRef: externalRef,
        status: 'synced',
        totalTax,
        totalAmount: taxAmounts.reduce((sum, amt) => sum + amt, 0) + totalTax,
        currency: 'USD',
        charges: taxAmounts.map((_, i) => ({
          lineId: `line-${i}`,
          externalLineId: `ext-line-${i}`,
          taxAmount: taxAmounts[i],
          taxCode: 'TAX',
          taxRate: 10
        }))
      }
    };

    // Mock on our local service instance
    const localAdapter = (service as any).adapters.get(adapterType);
    if (localAdapter) {
      vi.spyOn(localAdapter, 'fetchExternalInvoice').mockResolvedValue(mockResult);
    }

    // Also mock on the singleton (used by AccountingExportService)
    const singleton = getExternalTaxImportService();
    const singletonAdapter = (singleton as any).adapters.get(adapterType);
    if (singletonAdapter) {
      vi.spyOn(singletonAdapter, 'fetchExternalInvoice').mockResolvedValue(mockResult);
    }
  }

  describe('importing tax from external accounting system', () => {
    it('should update invoice charges with tax amounts from QuickBooks', async () => {
      // Arrange: Create invoice with 2 line items ($100 and $50)
      const { invoiceId } = await createInvoiceWithPendingExternalTax([10000, 5000]);

      // Simulate invoice was exported to QuickBooks
      const externalRef = 'QB-INV-123';
      await createExternalMapping(invoiceId, externalRef, 'quickbooks_online');

      // QuickBooks calculated tax: $10 on first line, $5 on second line
      mockAdapterFetchInvoice('quickbooks_online', externalRef, [1000, 500], 1500);

      // Act: Import the tax
      const result = await service.importTaxForInvoice(invoiceId);

      // Assert: Import succeeded
      expect(result.success).toBe(true);
      expect(result.importedTax).toBe(1500);
      expect(result.chargesUpdated).toBe(2);

      // Assert: Charges have external tax amounts
      const charges = await ctx.db('invoice_charges')
        .where({ invoice_id: invoiceId, tenant: ctx.tenantId })
        .orderBy('created_at');

      expect(Number(charges[0].external_tax_amount)).toBe(1000);
      expect(Number(charges[1].external_tax_amount)).toBe(500);
    });

    it('should change invoice tax_source from pending_external to external', async () => {
      // Arrange
      const { invoiceId } = await createInvoiceWithPendingExternalTax([10000]);
      const externalRef = 'QB-INV-456';
      await createExternalMapping(invoiceId, externalRef, 'quickbooks_online');
      mockAdapterFetchInvoice('quickbooks_online', externalRef, [1000], 1000);

      // Act
      await service.importTaxForInvoice(invoiceId);

      // Assert: tax_source changed
      const invoice = await ctx.db('invoices')
        .where({ invoice_id: invoiceId, tenant: ctx.tenantId })
        .first();

      expect(invoice.tax_source).toBe('external');
    });

    it('should create audit record in external_tax_imports table', async () => {
      // Arrange
      const { invoiceId } = await createInvoiceWithPendingExternalTax([10000]);
      const externalRef = 'QB-INV-789';
      await createExternalMapping(invoiceId, externalRef, 'quickbooks_online');
      mockAdapterFetchInvoice('quickbooks_online', externalRef, [1000], 1000);

      // Act
      const result = await service.importTaxForInvoice(invoiceId);

      // Assert: Audit record exists
      const importRecord = await ctx.db('external_tax_imports')
        .where({ invoice_id: invoiceId, tenant: ctx.tenantId })
        .first();

      expect(importRecord).toBeDefined();
      expect(importRecord.import_id).toBe(result.importId);
      expect(importRecord.adapter_type).toBe('quickbooks_online');
      expect(importRecord.external_invoice_ref).toBe(externalRef);
      expect(Number(importRecord.imported_external_tax)).toBe(1000);
      expect(importRecord.import_status).toBe('success');
    });

    it('should update invoice total_amount to include imported tax', async () => {
      // Arrange: Invoice with $150 subtotal
      const { invoiceId } = await createInvoiceWithPendingExternalTax([10000, 5000]);
      const externalRef = 'QB-INV-TOTAL';
      await createExternalMapping(invoiceId, externalRef, 'quickbooks_online');

      // QuickBooks calculated $15 total tax
      mockAdapterFetchInvoice('quickbooks_online', externalRef, [1000, 500], 1500);

      // Act
      await service.importTaxForInvoice(invoiceId);

      // Assert: Total = subtotal + tax = $150 + $15 = $165
      const invoice = await ctx.db('invoices')
        .where({ invoice_id: invoiceId, tenant: ctx.tenantId })
        .first();

      expect(Number(invoice.total_amount)).toBe(16500);
    });
  });

  describe('tax allocation across charges', () => {
    it('should apply per-line tax amounts from external system', async () => {
      // Arrange: Invoice with 3 lines - different amounts, different tax
      const { invoiceId } = await createInvoiceWithPendingExternalTax([10000, 5000, 2000]);
      const externalRef = 'QB-PERLINE';
      await createExternalMapping(invoiceId, externalRef, 'quickbooks_online');

      // External system calculated: $10 tax on $100, $5 on $50, $2 on $20
      // (different effective rates based on items)
      mockAdapterFetchInvoice('quickbooks_online', externalRef, [1000, 500, 200], 1700);

      // Act
      await service.importTaxForInvoice(invoiceId);

      // Assert: Each charge has its specific tax amount
      const charges = await ctx.db('invoice_charges')
        .where({ invoice_id: invoiceId, tenant: ctx.tenantId })
        .orderBy('created_at');

      expect(Number(charges[0].external_tax_amount)).toBe(1000); // $10
      expect(Number(charges[1].external_tax_amount)).toBe(500);  // $5
      expect(Number(charges[2].external_tax_amount)).toBe(200);  // $2
    });

    it('should handle mix of taxable and non-taxable items', async () => {
      // Arrange: Invoice with 3 lines - one is non-taxable (0 tax from external)
      const { invoiceId } = await createInvoiceWithPendingExternalTax([10000, 5000, 3000]);
      const externalRef = 'QB-MIXED';
      await createExternalMapping(invoiceId, externalRef, 'quickbooks_online');

      // External system: $10 tax, $0 (non-taxable), $3 tax
      mockAdapterFetchInvoice('quickbooks_online', externalRef, [1000, 0, 300], 1300);

      // Act
      await service.importTaxForInvoice(invoiceId);

      // Assert: Middle item has zero tax (non-taxable)
      const charges = await ctx.db('invoice_charges')
        .where({ invoice_id: invoiceId, tenant: ctx.tenantId })
        .orderBy('created_at');

      expect(Number(charges[0].external_tax_amount)).toBe(1000);
      expect(Number(charges[1].external_tax_amount)).toBe(0);    // Non-taxable
      expect(Number(charges[2].external_tax_amount)).toBe(300);
    });

    it('should handle different tax rates across items', async () => {
      // Arrange: Invoice with items at different rates
      // Item 1: $100 @ 10% = $10, Item 2: $100 @ 5% = $5, Item 3: $100 @ 0% = $0
      const { invoiceId } = await createInvoiceWithPendingExternalTax([10000, 10000, 10000]);
      const externalRef = 'QB-RATES';
      await createExternalMapping(invoiceId, externalRef, 'quickbooks_online');

      // External calculated different rates
      mockAdapterFetchInvoice('quickbooks_online', externalRef, [1000, 500, 0], 1500);

      // Act
      await service.importTaxForInvoice(invoiceId);

      // Assert: Each has its rate-specific tax
      const charges = await ctx.db('invoice_charges')
        .where({ invoice_id: invoiceId, tenant: ctx.tenantId })
        .orderBy('created_at');

      expect(Number(charges[0].external_tax_amount)).toBe(1000); // 10%
      expect(Number(charges[1].external_tax_amount)).toBe(500);  // 5%
      expect(Number(charges[2].external_tax_amount)).toBe(0);    // 0%
    });

    it('should distribute proportionally when line matching fails', async () => {
      // Arrange: Create invoice but mock adapter returns different line count
      const { invoiceId } = await createInvoiceWithPendingExternalTax([10000, 5000]);
      const externalRef = 'QB-MISMATCH';
      await createExternalMapping(invoiceId, externalRef, 'quickbooks_online');

      // Mock adapter returns total tax but with empty charges array (simulating mismatch)
      const adapter = (service as any).adapters.get('quickbooks_online');
      vi.spyOn(adapter, 'fetchExternalInvoice').mockResolvedValue({
        success: true,
        invoice: {
          externalInvoiceId: `ext-${externalRef}`,
          externalInvoiceRef: externalRef,
          status: 'synced',
          totalTax: 1500,
          totalAmount: 16500,
          currency: 'USD',
          charges: [] // No per-line tax - forces fallback
        }
      });

      // Also mock on singleton
      const singleton = getExternalTaxImportService();
      const singletonAdapter = (singleton as any).adapters.get('quickbooks_online');
      vi.spyOn(singletonAdapter, 'fetchExternalInvoice').mockResolvedValue({
        success: true,
        invoice: {
          externalInvoiceId: `ext-${externalRef}`,
          externalInvoiceRef: externalRef,
          status: 'synced',
          totalTax: 1500,
          totalAmount: 16500,
          currency: 'USD',
          charges: [] // No per-line tax - forces fallback
        }
      });

      // Act
      await service.importTaxForInvoice(invoiceId);

      // Assert: Tax distributed proportionally by line amount
      const charges = await ctx.db('invoice_charges')
        .where({ invoice_id: invoiceId, tenant: ctx.tenantId })
        .orderBy('created_at')
        .orderBy('item_id');

      // Get taxes and amounts for verification
      const charge1Tax = Number(charges[0].external_tax_amount);
      const charge2Tax = Number(charges[1].external_tax_amount);
      const charge1Amount = Number(charges[0].net_amount);
      const charge2Amount = Number(charges[1].net_amount);

      // Total tax should equal 1500
      expect(charge1Tax + charge2Tax).toBe(1500);

      // Tax should be proportional to amounts
      // Verify the ratio of tax matches the ratio of amounts (within rounding tolerance)
      const amountRatio = charge1Amount / charge2Amount;
      const taxRatio = charge1Tax / charge2Tax;
      // Allow 20% tolerance for rounding effects
      expect(Math.abs(amountRatio - taxRatio)).toBeLessThan(amountRatio * 0.2);
    });

    it('should match by charge ID even when external lines are returned out of order', async () => {
      // Arrange: Create invoice with 3 lines at different amounts
      const { invoiceId, chargeIds } = await createInvoiceWithPendingExternalTax([10000, 5000, 2000]);
      const externalRef = 'QB-OUTOFORDER';

      // Store mapping with chargeLineMappings in metadata (simulating what adapter stores during export)
      const now = new Date().toISOString();
      await ctx.db('tenant_external_entity_mappings').insert({
        id: uuidv4(),
        tenant: ctx.tenantId,
        alga_entity_type: 'invoice',
        alga_entity_id: invoiceId,
        integration_type: 'quickbooks_online',
        external_entity_id: externalRef,
        external_realm_id: 'test-realm-123',
        sync_status: 'synced',
        metadata: {
          chargeLineMappings: [
            { chargeId: chargeIds[0], qboLineId: 'qbo-line-A' },
            { chargeId: chargeIds[1], qboLineId: 'qbo-line-B' },
            { chargeId: chargeIds[2], qboLineId: 'qbo-line-C' }
          ]
        },
        created_at: now,
        updated_at: now
      });

      // Mock adapter returns charges in REVERSE order but with charge IDs as lineId
      // This simulates the robust matching where lineId = chargeId
      const mockResult: ExternalInvoiceFetchResult = {
        success: true,
        invoice: {
          externalInvoiceId: `ext-${externalRef}`,
          externalInvoiceRef: externalRef,
          status: 'synced',
          totalTax: 1700,
          totalAmount: 18700,
          currency: 'USD',
          // Return in REVERSE order: charge[2], charge[1], charge[0]
          // Each should still map to correct charge by ID
          charges: [
            { lineId: chargeIds[2], externalLineId: 'qbo-line-C', taxAmount: 200, taxCode: 'TAX', taxRate: 10 },
            { lineId: chargeIds[1], externalLineId: 'qbo-line-B', taxAmount: 500, taxCode: 'TAX', taxRate: 10 },
            { lineId: chargeIds[0], externalLineId: 'qbo-line-A', taxAmount: 1000, taxCode: 'TAX', taxRate: 10 }
          ]
        }
      };

      // Mock on our local service instance
      const localAdapter = (service as any).adapters.get('quickbooks_online');
      vi.spyOn(localAdapter, 'fetchExternalInvoice').mockResolvedValue(mockResult);

      // Also mock on the singleton
      const singleton = getExternalTaxImportService();
      const singletonAdapter = (singleton as any).adapters.get('quickbooks_online');
      vi.spyOn(singletonAdapter, 'fetchExternalInvoice').mockResolvedValue(mockResult);

      // Act
      const result = await service.importTaxForInvoice(invoiceId);

      // Assert: Import succeeded
      expect(result.success).toBe(true);
      expect(result.chargesUpdated).toBe(3);

      // Assert: Each charge has the correct tax despite out-of-order return
      // We look up by item_id (charge ID) to verify mapping worked correctly
      const charge1 = await ctx.db('invoice_charges')
        .where({ item_id: chargeIds[0], tenant: ctx.tenantId })
        .first();
      const charge2 = await ctx.db('invoice_charges')
        .where({ item_id: chargeIds[1], tenant: ctx.tenantId })
        .first();
      const charge3 = await ctx.db('invoice_charges')
        .where({ item_id: chargeIds[2], tenant: ctx.tenantId })
        .first();

      // $100 item gets $10 tax, $50 item gets $5 tax, $20 item gets $2 tax
      expect(Number(charge1.external_tax_amount)).toBe(1000); // chargeIds[0] -> $10
      expect(Number(charge2.external_tax_amount)).toBe(500);  // chargeIds[1] -> $5
      expect(Number(charge3.external_tax_amount)).toBe(200);  // chargeIds[2] -> $2
    });
  });

  describe('internal tax calculation is skipped for external delegation', () => {
    it('should set tax to zero when invoice has pending_external tax source', async () => {
      // Arrange: Create invoice with pending_external tax source
      const { invoiceId } = await createInvoiceWithPendingExternalTax([10000, 5000]);

      // Import the invoice service function
      const { calculateAndDistributeTax } = await import('../../../lib/services/invoiceService');

      // Create a mock tax service (shouldn't be called)
      const mockTaxService = {
        calculateTax: vi.fn().mockRejectedValue(new Error('Should not be called'))
      };

      // Act: Run tax calculation on invoice with pending_external tax source
      const result = await ctx.db.transaction(async (trx: any) => {
        return calculateAndDistributeTax(
          trx,
          invoiceId,
          { company_id: ctx.clientId },
          mockTaxService as any,
          ctx.tenantId
        );
      });

      // Assert: Tax should be zero (internal calculation skipped)
      expect(result).toBe(0);

      // Assert: Tax service should NOT have been called
      expect(mockTaxService.calculateTax).not.toHaveBeenCalled();

      // Assert: All charges should have zero tax
      const charges = await ctx.db('invoice_charges')
        .where({ invoice_id: invoiceId, tenant: ctx.tenantId });

      for (const charge of charges) {
        expect(Number(charge.tax_amount)).toBe(0);
      }
    });

  });

  describe('automatic tax import after export', () => {
    /**
     * This test exposes a gap in the current implementation:
     * When an invoice with external tax delegation is exported to the accounting system,
     * the tax should be automatically imported back after successful export.
     */
    it('should automatically import tax after exporting invoice with tax delegation', async () => {
      // Arrange: Create invoice with pending_external tax source
      const { invoiceId } = await createInvoiceWithPendingExternalTax([10000, 5000]);

      // Set up the external mapping (simulating the export created this)
      const externalRef = 'QB-AUTO-123';
      await createExternalMapping(invoiceId, externalRef, 'quickbooks_online');

      // Mock the adapter to return tax when fetched
      mockAdapterFetchInvoice('quickbooks_online', externalRef, [1000, 500], 1500);

      // Import the AccountingExportService after mocking
      const { AccountingExportService } = await import('../../../lib/services/accountingExportService');

      // Create a mock export batch and context that simulates a completed export
      // with tax delegation mode
      const mockDeliveryResult = {
        deliveredLines: [
          { lineId: `line-${invoiceId}-0`, externalDocumentRef: externalRef }
        ]
      };

      const mockContext = {
        batch: {
          batch_id: uuidv4(),
          tenant: ctx.tenantId,
          status: 'delivered'
        },
        lines: [
          { invoice_id: invoiceId, line_id: `line-${invoiceId}-0` }
        ],
        taxDelegationMode: 'delegate' as const,
        excludeTaxFromExport: true
      };

      // Act: Call the method that should trigger automatic tax import after export
      const exportService = new AccountingExportService(null as any, null as any);

      // Get the adapter from the tax import service to pass to the export service
      const adapter = (service as any).adapters.get('quickbooks_online');

      // Call the private method that handles post-export tax import
      await (exportService as any).importExternalTaxAfterDelivery(mockDeliveryResult, mockContext, adapter);

      // Assert: Invoice should now have external tax imported
      const invoice = await ctx.db('invoices')
        .where({ invoice_id: invoiceId, tenant: ctx.tenantId })
        .first();

      // This assertion will FAIL until we implement automatic tax import
      expect(invoice.tax_source).toBe('external');

      // Charges should have external tax amounts
      const charges = await ctx.db('invoice_charges')
        .where({ invoice_id: invoiceId, tenant: ctx.tenantId })
        .orderBy('created_at');

      expect(Number(charges[0].external_tax_amount)).toBe(1000);
      expect(Number(charges[1].external_tax_amount)).toBe(500);

      // Total should include tax
      expect(Number(invoice.total_amount)).toBe(16500);
    });
  });

  describe('error handling', () => {
    it('should fail if invoice is not pending_external', async () => {
      // Arrange: Create invoice with internal tax source
      const invoiceId = uuidv4();
      const now = new Date().toISOString();

      await ctx.db('invoices').insert({
        invoice_id: invoiceId,
        tenant: ctx.tenantId,
        client_id: ctx.clientId,
        invoice_number: `TEST-${Date.now()}`,
        invoice_date: now,
        due_date: now,
        subtotal: 10000,
        tax: 1000,
        total_amount: 11000,
        currency_code: 'USD',
        status: 'draft',
        tax_source: 'internal', // NOT pending_external
        created_at: now,
        updated_at: now
      });

      // Act
      const result = await service.importTaxForInvoice(invoiceId);

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toContain("expected 'pending_external'");
    });

    it('should fail if invoice has no external mapping', async () => {
      // Arrange: Create invoice without mapping
      const { invoiceId } = await createInvoiceWithPendingExternalTax([10000]);
      // Note: NOT creating external mapping

      // Act
      const result = await service.importTaxForInvoice(invoiceId);

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toContain('No external mapping found');
    });

    it('should fail if external system returns error', async () => {
      // Arrange
      const { invoiceId } = await createInvoiceWithPendingExternalTax([10000]);
      const externalRef = 'QB-INV-ERROR';
      await createExternalMapping(invoiceId, externalRef, 'quickbooks_online');

      // Mock adapter to return error
      const adapter = (service as any).adapters.get('quickbooks_online');
      vi.spyOn(adapter, 'fetchExternalInvoice').mockResolvedValue({
        success: false,
        error: 'Invoice not found in QuickBooks'
      });

      // Act
      const result = await service.importTaxForInvoice(invoiceId);

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invoice not found in QuickBooks');
    });
  });
});
