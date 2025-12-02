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
   */
  function mockAdapterFetchInvoice(
    adapterType: 'quickbooks_online' | 'xero',
    externalRef: string,
    taxAmounts: number[],
    totalTax: number
  ): void {
    const adapter = (service as any).adapters.get(adapterType);
    if (!adapter) {
      throw new Error(`Adapter ${adapterType} not found`);
    }

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

    vi.spyOn(adapter, 'fetchExternalInvoice').mockResolvedValue(mockResult);
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
