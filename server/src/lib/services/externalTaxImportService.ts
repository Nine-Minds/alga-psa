import { v4 as uuid4 } from 'uuid';
import logger from '@shared/core/logger';
import { createTenantKnex } from '../db';
import { IExternalTaxImport, IExternalTaxImportResult, TaxSource } from '../../interfaces/tax.interfaces';
import {
  AccountingExportAdapter,
  ExternalInvoiceData,
  ExternalInvoiceFetchResult
} from '../adapters/accounting/accountingExportAdapter';
import { QuickBooksOnlineAdapter } from '../adapters/accounting/quickBooksOnlineAdapter';
import { XeroAdapter } from '../adapters/accounting/xeroAdapter';

/**
 * Result of a single invoice tax import operation
 */
export interface SingleImportResult {
  success: boolean;
  invoiceId: string;
  importId?: string;
  originalTax: number;
  importedTax: number;
  difference: number;
  chargesUpdated: number;
  error?: string;
}

/**
 * Result of a batch tax import operation
 */
export interface BatchImportResult {
  totalProcessed: number;
  successCount: number;
  failureCount: number;
  skippedCount: number;
  results: SingleImportResult[];
  errors: Array<{ invoiceId: string; error: string }>;
}

/**
 * Result of tax reconciliation
 */
export interface ReconciliationResult {
  invoiceId: string;
  internalTax: number;
  externalTax: number;
  difference: number;
  differencePercent: number;
  hasSignificantDifference: boolean;
  lineComparisons: Array<{
    chargeId: string;
    description?: string;
    internalTax: number;
    externalTax: number;
    difference: number;
  }>;
}

/**
 * Service for importing externally calculated tax amounts from accounting systems.
 * Handles both QuickBooks Online and Xero tax imports.
 */
export class ExternalTaxImportService {
  private adapters: Map<string, AccountingExportAdapter> = new Map();

  constructor() {
    // Register available adapters
    this.adapters.set('quickbooks_online', new QuickBooksOnlineAdapter());
    this.adapters.set('xero', new XeroAdapter());
  }

  /**
   * Import externally calculated tax for a single invoice.
   */
  async importTaxForInvoice(invoiceId: string, userId?: string): Promise<SingleImportResult> {
    const { knex, tenant } = await createTenantKnex();

    if (!tenant) {
      throw new Error('Tenant context is required for tax import');
    }

    try {
      // 1. Get invoice and verify it's pending external tax
      const invoice = await knex('invoices')
        .where({ invoice_id: invoiceId, tenant })
        .select('invoice_id', 'invoice_number', 'tax_source', 'total_amount')
        .first();

      if (!invoice) {
        return {
          success: false,
          invoiceId,
          originalTax: 0,
          importedTax: 0,
          difference: 0,
          chargesUpdated: 0,
          error: 'Invoice not found'
        };
      }

      if (invoice.tax_source !== 'pending_external') {
        return {
          success: false,
          invoiceId,
          originalTax: 0,
          importedTax: 0,
          difference: 0,
          chargesUpdated: 0,
          error: `Invoice tax source is '${invoice.tax_source}', expected 'pending_external'`
        };
      }

      // 2. Get the export mapping to determine adapter and external reference
      const mapping = await knex('tenant_external_entity_mappings')
        .where({
          tenant,
          alga_entity_type: 'invoice',
          alga_entity_id: invoiceId
        })
        .select('integration_type', 'external_entity_id', 'external_realm_id')
        .first();

      if (!mapping) {
        return {
          success: false,
          invoiceId,
          originalTax: 0,
          importedTax: 0,
          difference: 0,
          chargesUpdated: 0,
          error: 'No external mapping found for invoice - has it been exported?'
        };
      }

      // 3. Get the appropriate adapter
      const adapter = this.adapters.get(mapping.integration_type);
      if (!adapter) {
        return {
          success: false,
          invoiceId,
          originalTax: 0,
          importedTax: 0,
          difference: 0,
          chargesUpdated: 0,
          error: `Unsupported adapter type: ${mapping.integration_type}`
        };
      }

      // 4. Check adapter capabilities
      const capabilities = adapter.capabilities();
      if (!capabilities.supportsInvoiceFetch) {
        return {
          success: false,
          invoiceId,
          originalTax: 0,
          importedTax: 0,
          difference: 0,
          chargesUpdated: 0,
          error: `Adapter ${mapping.integration_type} does not support invoice fetch`
        };
      }

      // 5. Fetch invoice from external system
      if (!adapter.fetchExternalInvoice) {
        return {
          success: false,
          invoiceId,
          originalTax: 0,
          importedTax: 0,
          difference: 0,
          chargesUpdated: 0,
          error: `Adapter ${mapping.integration_type} does not implement fetchExternalInvoice`
        };
      }

      const fetchResult = await adapter.fetchExternalInvoice(
        mapping.external_entity_id,
        mapping.external_realm_id
      );

      if (!fetchResult.success || !fetchResult.invoice) {
        return {
          success: false,
          invoiceId,
          originalTax: 0,
          importedTax: 0,
          difference: 0,
          chargesUpdated: 0,
          error: fetchResult.error ?? 'Failed to fetch invoice from external system'
        };
      }

      // 6. Get current invoice charges and their tax
      const charges = await knex('invoice_charges')
        .where({ invoice_id: invoiceId, tenant })
        .select('item_id', 'description', 'tax_amount');

      const originalTax = charges.reduce(
        (sum, c) => sum + (c.tax_amount ?? 0),
        0
      );

      // 7. Match external lines to invoice charges and update
      const importResult = await this.applyExternalTaxToCharges(
        knex,
        tenant,
        invoiceId,
        charges,
        fetchResult.invoice
      );

      // 8. Update invoice tax_source
      await knex('invoices')
        .where({ invoice_id: invoiceId, tenant })
        .update({
          tax_source: 'external' as TaxSource,
          updated_at: knex.fn.now()
        });

      // 9. Recalculate invoice total
      const newTotals = await knex('invoice_charges')
        .where({ invoice_id: invoiceId, tenant })
        .select(
          knex.raw('COALESCE(SUM(net_amount), 0) as subtotal'),
          knex.raw('COALESCE(SUM(COALESCE(external_tax_amount, tax_amount, 0)), 0) as tax')
        )
        .first();

      const newTotal = Number(newTotals?.subtotal ?? 0) + Number(newTotals?.tax ?? 0);

      await knex('invoices')
        .where({ invoice_id: invoiceId, tenant })
        .update({
          total_amount: newTotal,
          updated_at: knex.fn.now()
        });

      // 10. Record the import
      const importId = uuid4();
      const importedTax = fetchResult.invoice.totalTax;
      const difference = importedTax - originalTax;

      await knex('external_tax_imports').insert({
        import_id: importId,
        tenant,
        invoice_id: invoiceId,
        adapter_type: mapping.integration_type,
        external_invoice_ref: fetchResult.invoice.externalInvoiceRef,
        imported_at: knex.fn.now(),
        imported_by: userId ?? null,
        import_status: 'success',
        original_internal_tax: originalTax,
        imported_external_tax: importedTax,
        tax_difference: difference,
        metadata: {
          externalInvoiceId: fetchResult.invoice.externalInvoiceId,
          currency: fetchResult.invoice.currency,
          status: fetchResult.invoice.status,
          chargesUpdated: importResult.chargesUpdated
        },
        created_at: knex.fn.now(),
        updated_at: knex.fn.now()
      });

      logger.info('[ExternalTaxImportService] Successfully imported tax for invoice', {
        invoiceId,
        tenant,
        originalTax,
        importedTax,
        difference,
        chargesUpdated: importResult.chargesUpdated
      });

      return {
        success: true,
        invoiceId,
        importId,
        originalTax,
        importedTax,
        difference,
        chargesUpdated: importResult.chargesUpdated
      };
    } catch (error: any) {
      logger.error('[ExternalTaxImportService] Failed to import tax for invoice', {
        invoiceId,
        tenant,
        error: error.message
      });

      return {
        success: false,
        invoiceId,
        originalTax: 0,
        importedTax: 0,
        difference: 0,
        chargesUpdated: 0,
        error: error.message ?? 'Unknown error during tax import'
      };
    }
  }

  /**
   * Batch import taxes for all pending invoices.
   */
  async batchImportPendingTaxes(userId?: string): Promise<BatchImportResult> {
    const { knex, tenant } = await createTenantKnex();

    if (!tenant) {
      throw new Error('Tenant context is required for batch tax import');
    }

    const result: BatchImportResult = {
      totalProcessed: 0,
      successCount: 0,
      failureCount: 0,
      skippedCount: 0,
      results: [],
      errors: []
    };

    try {
      // Get all invoices pending external tax
      const pendingInvoices = await knex('invoices')
        .where({ tenant, tax_source: 'pending_external' })
        .select('invoice_id');

      result.totalProcessed = pendingInvoices.length;

      if (pendingInvoices.length === 0) {
        logger.info('[ExternalTaxImportService] No pending invoices for tax import', { tenant });
        return result;
      }

      logger.info('[ExternalTaxImportService] Starting batch tax import', {
        tenant,
        invoiceCount: pendingInvoices.length
      });

      // Process each invoice
      // Note: We process sequentially to avoid rate limiting issues with external APIs
      for (const invoice of pendingInvoices) {
        const importResult = await this.importTaxForInvoice(invoice.invoice_id, userId);

        result.results.push(importResult);

        if (importResult.success) {
          result.successCount++;
        } else {
          result.failureCount++;
          result.errors.push({
            invoiceId: invoice.invoice_id,
            error: importResult.error ?? 'Unknown error'
          });
        }

        // Small delay to avoid overwhelming external APIs
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      logger.info('[ExternalTaxImportService] Batch tax import completed', {
        tenant,
        totalProcessed: result.totalProcessed,
        successCount: result.successCount,
        failureCount: result.failureCount
      });

      return result;
    } catch (error: any) {
      logger.error('[ExternalTaxImportService] Batch tax import failed', {
        tenant,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Get import history for an invoice.
   */
  async getImportHistory(invoiceId: string): Promise<IExternalTaxImport[]> {
    const { knex, tenant } = await createTenantKnex();

    if (!tenant) {
      throw new Error('Tenant context is required for import history');
    }

    const imports = await knex('external_tax_imports')
      .where({ tenant, invoice_id: invoiceId })
      .orderBy('imported_at', 'desc')
      .select('*');

    return imports.map(row => ({
      import_id: row.import_id,
      tenant: row.tenant,
      invoice_id: row.invoice_id,
      adapter_type: row.adapter_type,
      external_invoice_ref: row.external_invoice_ref,
      imported_at: row.imported_at,
      imported_by: row.imported_by,
      import_status: row.import_status,
      original_internal_tax: row.original_internal_tax,
      imported_external_tax: row.imported_external_tax,
      tax_difference: row.tax_difference,
      metadata: row.metadata,
      created_at: row.created_at,
      updated_at: row.updated_at
    }));
  }

  /**
   * Reconcile tax differences between internal and external calculations.
   */
  async reconcileTaxDifferences(invoiceId: string): Promise<ReconciliationResult> {
    const { knex, tenant } = await createTenantKnex();

    if (!tenant) {
      throw new Error('Tenant context is required for tax reconciliation');
    }

    // Get invoice
    const invoice = await knex('invoices')
      .where({ invoice_id: invoiceId, tenant })
      .select('invoice_id', 'tax_source')
      .first();

    if (!invoice) {
      throw new Error(`Invoice ${invoiceId} not found`);
    }

    // Get charges with both internal and external tax
    const charges = await knex('invoice_charges')
      .where({ invoice_id: invoiceId, tenant })
      .select('item_id', 'description', 'tax_amount', 'external_tax_amount');

    const lineComparisons = charges.map(charge => ({
      chargeId: charge.item_id,
      description: charge.description,
      internalTax: charge.tax_amount ?? 0,
      externalTax: charge.external_tax_amount ?? charge.tax_amount ?? 0,
      difference: (charge.external_tax_amount ?? charge.tax_amount ?? 0) - (charge.tax_amount ?? 0)
    }));

    const internalTax = charges.reduce((sum, c) => sum + (c.tax_amount ?? 0), 0);
    const externalTax = charges.reduce(
      (sum, c) => sum + (c.external_tax_amount ?? c.tax_amount ?? 0),
      0
    );
    const difference = externalTax - internalTax;
    const differencePercent = internalTax > 0 ? (difference / internalTax) * 100 : 0;

    // Flag significant differences (>1%)
    const hasSignificantDifference = Math.abs(differencePercent) > 1;

    return {
      invoiceId,
      internalTax,
      externalTax,
      difference,
      differencePercent,
      hasSignificantDifference,
      lineComparisons
    };
  }

  /**
   * Get count of invoices pending external tax import.
   */
  async getPendingImportCount(): Promise<number> {
    const { knex, tenant } = await createTenantKnex();

    if (!tenant) {
      return 0;
    }

    const result = await knex('invoices')
      .where({ tenant, tax_source: 'pending_external' })
      .count('invoice_id as count')
      .first();

    return Number(result?.count ?? 0);
  }

  /**
   * Apply external tax amounts to invoice charges.
   */
  private async applyExternalTaxToCharges(
    knex: any,
    tenant: string,
    invoiceId: string,
    charges: Array<{ item_id: string; description?: string; tax_amount?: number }>,
    externalInvoice: ExternalInvoiceData
  ): Promise<{ chargesUpdated: number; warnings: string[] }> {
    const warnings: string[] = [];
    let chargesUpdated = 0;

    // Create a map of external charges by lineId for matching
    const externalChargeMap = new Map(
      externalInvoice.charges.map(c => [c.lineId, c])
    );

    // Also create a secondary map by description for fallback matching
    const externalChargeByDescMap = new Map<string, typeof externalInvoice.charges[0]>();
    for (const charge of externalInvoice.charges) {
      // External systems may not have clean line IDs, so we try description matching
      if (charge.externalLineId) {
        externalChargeByDescMap.set(charge.externalLineId, charge);
      }
    }

    for (let i = 0; i < charges.length; i++) {
      const charge = charges[i];

      // Try to find matching external charge
      let externalCharge = externalChargeMap.get(`line-${i}`);

      // If no match by index, try by external line ID stored in charge mapping
      if (!externalCharge) {
        // Fall back to proportional distribution if we can't match
        const proportionalTax = externalInvoice.charges.length > 0
          ? Math.round(externalInvoice.totalTax / charges.length)
          : 0;

        await knex('invoice_charges')
          .where({ item_id: charge.item_id, tenant })
          .update({
            external_tax_amount: proportionalTax,
            updated_at: knex.fn.now()
          });

        warnings.push(`Charge ${charge.item_id} matched proportionally`);
        chargesUpdated++;
        continue;
      }

      // Update the charge with external tax amount
      await knex('invoice_charges')
        .where({ item_id: charge.item_id, tenant })
        .update({
          external_tax_amount: externalCharge.taxAmount,
          external_tax_code: externalCharge.taxCode,
          external_tax_rate: externalCharge.taxRate,
          updated_at: knex.fn.now()
        });

      chargesUpdated++;
    }

    return { chargesUpdated, warnings };
  }
}

// Singleton instance
let serviceInstance: ExternalTaxImportService | null = null;

/**
 * Get the singleton instance of ExternalTaxImportService.
 */
export function getExternalTaxImportService(): ExternalTaxImportService {
  if (!serviceInstance) {
    serviceInstance = new ExternalTaxImportService();
  }
  return serviceInstance;
}
