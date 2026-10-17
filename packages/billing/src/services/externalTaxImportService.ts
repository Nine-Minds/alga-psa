import { v4 as uuid4 } from 'uuid';
import logger from '@alga-psa/core/logger';
import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { IExternalTaxImport, TaxSource } from '@alga-psa/types';
import {
  AccountingExportAdapter,
  ExternalInvoiceData,
  ExternalInvoiceFetchResult
} from '@alga-psa/types';
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
  currencyCode: string | null;
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
      const db = tenantDb(knex, tenant);

      const invoice = await db.table('invoices')
        .where({ invoice_id: invoiceId })
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
      const mapping = await db.table('tenant_external_entity_mappings')
        .where({
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

      // Tax import stays invoice- and charge-amount-driven. Canonical recurring
      // service periods may explain why a charge exists, but they do not change
      // external tax matching or the imported amount basis.
      // 6. Get current invoice charges and their tax
      const charges = await db.table('invoice_charges')
        .where({ invoice_id: invoiceId })
        .select('item_id', 'description', 'tax_amount', 'net_amount');

      const originalTax = charges.reduce(
        (sum, c) => sum + Number(c.tax_amount ?? 0),
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
      await db.table('invoices')
        .where({ invoice_id: invoiceId })
        .update({
          tax_source: 'external' as TaxSource,
          updated_at: knex.fn.now()
        });

      // 9. Recalculate invoice total
      const newTotals = await db.table('invoice_charges')
        .where({ invoice_id: invoiceId })
        .select(
          knex.raw('COALESCE(SUM(net_amount), 0) as subtotal'),
          knex.raw('COALESCE(SUM(COALESCE(external_tax_amount, tax_amount, 0)), 0) as tax')
        )
        .first();

      const newTotalsRow = newTotals as unknown as { subtotal?: number | string; tax?: number | string } | undefined;
      const newSubtotal = Number(newTotalsRow?.subtotal ?? 0);
      const newTax = Number(newTotalsRow?.tax ?? 0);
      const newTotal = newSubtotal + newTax;

      await db.table('invoices')
        .where({ invoice_id: invoiceId })
        .update({
          subtotal: newSubtotal,
          tax: newTax,
          total_amount: newTotal,
          updated_at: knex.fn.now()
        });

      // 10. Record the import
      const importId = uuid4();
      const importedTax = fetchResult.invoice.totalTax;
      const difference = importedTax - originalTax;

      await db.table('external_tax_imports').insert({
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
      const pendingInvoices = await tenantDb(knex, tenant).table('invoices')
        .where({ tax_source: 'pending_external' })
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

    const imports = await tenantDb(knex, tenant).table('external_tax_imports')
      .where({ invoice_id: invoiceId })
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
    const db = tenantDb(knex, tenant);

    const invoice = await db.table('invoices')
      .where({ invoice_id: invoiceId })
      .select('invoice_id', 'tax_source', 'currency_code')
      .first();

    if (!invoice) {
      throw new Error(`Invoice ${invoiceId} not found`);
    }

    // Reconciliation is financial-tax-centric: compare stored internal and
    // imported external tax amounts per invoice charge. Canonical recurring
    // service periods stay explanatory context, not reconciliation inputs.
    // Get charges with both internal and external tax
    const charges = await db.table('invoice_charges')
      .where({ invoice_id: invoiceId })
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
      currencyCode: invoice.currency_code ?? null,
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

    const result = await tenantDb(knex, tenant).table('invoices')
      .where({ tax_source: 'pending_external' })
      .count('invoice_id as count')
      .first();

    return Number(result?.count ?? 0);
  }

  /**
   * Apply external tax amounts to invoice charges.
   * Uses the documented rounding algorithm from docs/tax_calculation_allocation.md:
   * - floor((chargeAmount / subtotal) * totalTax) for each charge
   * - Remainder assigned to the last charge
   */
  private async applyExternalTaxToCharges(
    knex: any,
    tenant: string,
    invoiceId: string,
    charges: Array<{ item_id: string; description?: string; tax_amount?: number; net_amount?: number }>,
    externalInvoice: ExternalInvoiceData
  ): Promise<{ chargesUpdated: number; warnings: string[] }> {
    const warnings: string[] = [];
    let chargesUpdated = 0;
    const db = tenantDb(knex, tenant);

    // Provider split IDs remain unique in lineId. A consolidated fixed-plan
    // parent is carried separately so the split tax can be summed onto its
    // invoice_charges row without collapsing sibling allocations in a Map.
    const externalChargeMap = new Map(
      externalInvoice.charges.map(c => [c.lineId, c])
    );

    // Build set of charge IDs for robust matching
    const chargeIds = new Set(charges.map(c => c.item_id));

    // Older exports stored allocation detail IDs as charge IDs without parent
    // lineage. Recover their parent from the canonical persisted details table.
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const externalLineIds = externalInvoice.charges.map(charge => charge.lineId)
      .filter(lineId => !chargeIds.has(lineId) && uuidPattern.test(lineId));
    const detailParents = externalLineIds.length > 0
      ? await db.table('invoice_charge_details')
          .whereIn('item_detail_id', externalLineIds)
          .select('item_detail_id', 'item_id')
      : [];
    const detailParentById = new Map<string, string>(
      detailParents.map((row: { item_detail_id: string; item_id: string }) => [row.item_detail_id, row.item_id])
    );
    const externalByParent = new Map<string, typeof externalInvoice.charges>();
    for (const externalCharge of externalInvoice.charges) {
      const parentId = externalCharge.parentChargeId ??
        (chargeIds.has(externalCharge.lineId) ? externalCharge.lineId : detailParentById.get(externalCharge.lineId));
      if (!parentId || !chargeIds.has(parentId)) continue;
      const matched = externalByParent.get(parentId) ?? [];
      matched.push(externalCharge);
      externalByParent.set(parentId, matched);
    }

    // Check whether any provider line resolves to an invoice charge (directly
    // or through fixed-detail lineage), else retain the positional fallback.
    const hasChargeIdMatching = externalByParent.size > 0;

    const hasPositionalMatching = !hasChargeIdMatching &&
      charges.every((_, i) => externalChargeMap.has(`line-${i}`));

    if (hasChargeIdMatching && externalInvoice.charges.length > 0) {
      // Match direct invoice lines one-to-one and sum allocation split taxes
      // onto a consolidated fixed-plan parent. Keep positional IDs available
      // for individual unmatched rows, then distribute any remaining provider
      // tax over the remaining charges instead of dropping it.
      const matchedExternalLineIds = new Set<string>();
      const unresolvedCharges: typeof charges = [];
      let matchedTax = 0;
      for (const charge of charges) {
        const directCharge = externalChargeMap.get(charge.item_id);
        const parentMatches = externalByParent.get(charge.item_id) ?? [];
        const allocationMatches = parentMatches.filter(externalCharge =>
          externalCharge.allocationDetailId != null || externalCharge.lineId !== charge.item_id
        );
        const externalCharge = directCharge ?? (allocationMatches.length > 0
          ? {
              ...allocationMatches[0],
              taxAmount: allocationMatches.reduce((sum, allocation) => sum + allocation.taxAmount, 0),
              taxCode: allocationMatches.every(allocation => allocation.taxCode === allocationMatches[0].taxCode)
                ? allocationMatches[0].taxCode : undefined,
              taxRate: allocationMatches.every(allocation => allocation.taxRate === allocationMatches[0].taxRate)
                ? allocationMatches[0].taxRate : undefined,
            }
          : undefined);
        const positionalCharge = !externalCharge ? externalChargeMap.get(`line-${charges.indexOf(charge)}`) : undefined;
        const chargeTax = externalCharge ?? positionalCharge;

        if (chargeTax) {
          // An aggregate consumes every allocation, including legacy detail
          // mappings recovered from the DB rather than provider metadata.
          const consumedLines = directCharge || positionalCharge
            ? [chargeTax]
            : allocationMatches;
          for (const consumed of consumedLines) matchedExternalLineIds.add(consumed.lineId);
          await db.table('invoice_charges')
            .where({ item_id: charge.item_id })
            .update({
              external_tax_amount: chargeTax.taxAmount,
              external_tax_code: chargeTax.taxCode,
              external_tax_rate: chargeTax.taxRate,
              updated_at: knex.fn.now()
            });

          matchedTax += chargeTax.taxAmount;
          chargesUpdated++;
        } else {
          unresolvedCharges.push(charge);
        }
      }

      if (unresolvedCharges.length > 0) {
        const unmatchedProviderLines = externalInvoice.charges.filter(externalCharge =>
          !matchedExternalLineIds.has(externalCharge.lineId)
        );
        // The provider's invoice total is authoritative. Allocate only its
        // remaining signed tax, never amounts already included in a parent.
        const taxToDistribute = externalInvoice.totalTax - matchedTax;
        const unresolvedAmount = unresolvedCharges.reduce((sum, charge) => sum + Number(charge.net_amount ?? 0), 0);
        let distributedTax = 0;

        for (let index = 0; index < unresolvedCharges.length; index++) {
          const charge = unresolvedCharges[index];
          const taxAmount = index === unresolvedCharges.length - 1
            ? taxToDistribute - distributedTax
            : unresolvedAmount > 0
              ? Math.floor((Number(charge.net_amount ?? 0) / unresolvedAmount) * taxToDistribute)
              : 0;
          distributedTax += taxAmount;
          await db.table('invoice_charges')
            .where({ item_id: charge.item_id })
            .update({ external_tax_amount: taxAmount, updated_at: knex.fn.now() });
          chargesUpdated++;
        }
        if (unmatchedProviderLines.length > 0) {
          warnings.push('Using proportional tax distribution for unmatched external lines');
        } else if (unresolvedCharges.length > 0) {
          warnings.push(`No external tax data for ${unresolvedCharges.length} charge(s); distributed remaining invoice tax`);
        }
      }
    } else if (hasPositionalMatching && externalInvoice.charges.length > 0) {
      // Fallback: positional matching (line-0, line-1, etc.)
      warnings.push('Using positional line matching - charge ID mapping not available');
      for (let i = 0; i < charges.length; i++) {
        const charge = charges[i];
        const externalCharge = externalChargeMap.get(`line-${i}`)!;

        await db.table('invoice_charges')
          .where({ item_id: charge.item_id })
          .update({
            external_tax_amount: externalCharge.taxAmount,
            external_tax_code: externalCharge.taxCode,
            external_tax_rate: externalCharge.taxRate,
            updated_at: knex.fn.now()
          });

        chargesUpdated++;
      }
    } else {
      // Fallback: Proportional distribution based on charge amounts
      // Using documented algorithm: floor + remainder to last item
      warnings.push('Using proportional tax distribution - external line matching failed');

      // Get charge amounts from database (order must match the charges parameter)
      const chargeAmounts = await db.table('invoice_charges')
        .where({ invoice_id: invoiceId })
        .select('item_id', 'net_amount')
        .orderBy('created_at')
        .orderBy('item_id');

      const subtotal = chargeAmounts.reduce(
        (sum: number, c: any) => sum + Number(c.net_amount || 0),
        0
      );

      const totalTax = externalInvoice.totalTax;
      let distributedTax = 0;

      for (let i = 0; i < chargeAmounts.length; i++) {
        const chargeData = chargeAmounts[i];
        const chargeAmount = Number(chargeData.net_amount || 0);
        const isLast = i === chargeAmounts.length - 1;

        let taxAmount: number;
        if (isLast) {
          // Last item gets the remainder to ensure sum equals total
          taxAmount = totalTax - distributedTax;
        } else if (subtotal > 0) {
          // Proportional distribution using floor
          taxAmount = Math.floor((chargeAmount / subtotal) * totalTax);
          distributedTax += taxAmount;
        } else {
          taxAmount = 0;
        }

        await db.table('invoice_charges')
          .where({ item_id: chargeData.item_id })
          .update({
            external_tax_amount: taxAmount,
            updated_at: knex.fn.now()
          });

        chargesUpdated++;
      }
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
