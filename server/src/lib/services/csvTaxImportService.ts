/**
 * CSV Tax Import Service
 *
 * Handles importing externally calculated tax amounts from CSV files.
 * Uses the validator for validation and the distribution algorithm from
 * externalTaxImportService for applying taxes to charges.
 */

import { v4 as uuid4 } from 'uuid';
import logger from '@alga-psa/core/logger';
import { createTenantKnex } from '../db';
import { TaxSource } from '../../interfaces/tax.interfaces';
import { parseCSV } from '../utils/csvParser';
import {
  validateCSVForTaxImport,
  aggregateTaxByInvoice,
  CSVValidationResult,
  ParsedTaxRow,
  InvoiceValidationInfo
} from './csvTaxImportValidator';

/**
 * Options for importing tax from CSV
 */
export interface CSVTaxImportOptions {
  /** Raw CSV content as string */
  csvContent: string;
  /** Start date for date range validation */
  startDate: Date;
  /** End date for date range validation */
  endDate: Date;
  /** User ID performing the import */
  userId?: string;
  /** Whether to perform a dry run (validate only) */
  dryRun?: boolean;
}

/**
 * Result of a single invoice tax update
 */
export interface SingleInvoiceUpdateResult {
  invoiceId: string;
  invoiceNumber: string;
  success: boolean;
  originalTax: number;
  importedTax: number;
  difference: number;
  chargesUpdated: number;
  taxCode?: string;
  taxRate?: number;
  error?: string;
}

/**
 * Complete result of CSV tax import
 */
export interface CSVTaxImportResult {
  success: boolean;
  importId?: string;
  validation: CSVValidationResult;
  invoiceResults: SingleInvoiceUpdateResult[];
  summary: {
    totalInvoices: number;
    successfulUpdates: number;
    failedUpdates: number;
    totalOriginalTax: number;
    totalImportedTax: number;
    totalDifference: number;
  };
  error?: string;
}

/**
 * Service for importing tax data from CSV files.
 */
export class CSVTaxImportService {
  /**
   * Import tax data from a CSV file.
   *
   * @param options Import options including CSV content and date range
   * @returns Import result with validation details and update results
   */
  async importTaxFromCSV(options: CSVTaxImportOptions): Promise<CSVTaxImportResult> {
    const { csvContent, startDate, endDate, userId, dryRun = false } = options;
    const { knex, tenant } = await createTenantKnex();

    if (!tenant) {
      return {
        success: false,
        validation: this.createEmptyValidation('Tenant context is required'),
        invoiceResults: [],
        summary: this.createEmptySummary(),
        error: 'Tenant context is required'
      };
    }

    logger.info('[CSVTaxImportService] Starting CSV tax import', {
      tenant,
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      dryRun
    });

    try {
      // 1. Parse CSV
      const csvRows = parseCSV(csvContent) as string[][];

      // 2. Validate CSV
      const validation = await validateCSVForTaxImport(
        knex,
        tenant,
        csvRows,
        startDate,
        endDate
      );

      if (!validation.valid) {
        logger.warn('[CSVTaxImportService] CSV validation failed', {
          tenant,
          errors: validation.errors.length,
          warnings: validation.warnings.length
        });

        return {
          success: false,
          validation,
          invoiceResults: [],
          summary: this.createEmptySummary(),
          error: `Validation failed with ${validation.errors.length} errors`
        };
      }

      // If dry run, return validation results without applying changes
      if (dryRun) {
        logger.info('[CSVTaxImportService] Dry run completed', {
          tenant,
          validRows: validation.stats.validRows,
          matchedInvoices: validation.stats.matchedInvoices
        });

        return {
          success: true,
          validation,
          invoiceResults: [],
          summary: {
            totalInvoices: validation.stats.matchedInvoices,
            successfulUpdates: 0,
            failedUpdates: 0,
            totalOriginalTax: 0,
            totalImportedTax: 0,
            totalDifference: 0
          }
        };
      }

      // 3. Aggregate tax by invoice
      const aggregatedTax = aggregateTaxByInvoice(validation.parsedRows);

      // 4. Apply tax updates within a transaction
      const importId = uuid4();
      const invoiceResults: SingleInvoiceUpdateResult[] = [];

      await knex.transaction(async (trx: any) => {
        for (const [invoiceNo, taxData] of aggregatedTax) {
          const invoiceInfo = validation.matchedInvoices.get(invoiceNo);
          if (!invoiceInfo) continue;

          try {
            const result = await this.applyTaxToInvoice(
              trx,
              tenant,
              invoiceInfo,
              taxData.totalTax,
              taxData.taxCode,
              taxData.taxRate
            );
            invoiceResults.push(result);
          } catch (error: any) {
            invoiceResults.push({
              invoiceId: invoiceInfo.invoiceId,
              invoiceNumber: invoiceNo,
              success: false,
              originalTax: 0,
              importedTax: taxData.totalTax,
              difference: 0,
              chargesUpdated: 0,
              error: error.message
            });
          }
        }

        // 5. Record the import
        const summary = this.calculateSummary(invoiceResults);

        await trx('external_tax_imports').insert({
          import_id: importId,
          tenant,
          invoice_id: null, // Batch import - no single invoice
          adapter_type: 'quickbooks_csv',
          external_invoice_ref: `csv_import_${new Date().toISOString()}`,
          imported_at: trx.fn.now(),
          imported_by: userId ?? null,
          import_status: summary.failedUpdates === 0 ? 'success' : 'partial',
          original_internal_tax: summary.totalOriginalTax,
          imported_external_tax: summary.totalImportedTax,
          tax_difference: summary.totalDifference,
          metadata: {
            source: 'csv_upload',
            startDate: startDate.toISOString(),
            endDate: endDate.toISOString(),
            totalInvoices: summary.totalInvoices,
            successfulUpdates: summary.successfulUpdates,
            failedUpdates: summary.failedUpdates,
            invoiceNumbers: Array.from(aggregatedTax.keys())
          },
          created_at: trx.fn.now(),
          updated_at: trx.fn.now()
        });
      });

      const summary = this.calculateSummary(invoiceResults);

      logger.info('[CSVTaxImportService] CSV tax import completed', {
        tenant,
        importId,
        totalInvoices: summary.totalInvoices,
        successfulUpdates: summary.successfulUpdates,
        failedUpdates: summary.failedUpdates
      });

      return {
        success: summary.failedUpdates === 0,
        importId,
        validation,
        invoiceResults,
        summary
      };
    } catch (error: any) {
      logger.error('[CSVTaxImportService] CSV tax import failed', {
        tenant,
        error: error.message
      });

      return {
        success: false,
        validation: this.createEmptyValidation(error.message),
        invoiceResults: [],
        summary: this.createEmptySummary(),
        error: error.message
      };
    }
  }

  /**
   * Apply tax to a single invoice using proportional distribution.
   */
  private async applyTaxToInvoice(
    knex: any,
    tenant: string,
    invoiceInfo: InvoiceValidationInfo,
    totalTax: number,
    taxCode?: string,
    taxRate?: number
  ): Promise<SingleInvoiceUpdateResult> {
    const { invoiceId, invoiceNumber } = invoiceInfo;

    // 1. Get current charges and their tax
    const charges = await knex('invoice_charges')
      .where({ invoice_id: invoiceId, tenant })
      .select('item_id', 'net_amount', 'tax_amount')
      .orderBy('created_at')
      .orderBy('item_id');

    if (charges.length === 0) {
      return {
        invoiceId,
        invoiceNumber,
        success: false,
        originalTax: 0,
        importedTax: totalTax,
        difference: totalTax,
        chargesUpdated: 0,
        error: 'Invoice has no charges'
      };
    }

    // 2. Calculate original tax
    const originalTax = charges.reduce(
      (sum: number, c: any) => sum + Number(c.tax_amount ?? 0),
      0
    );

    // 3. Calculate subtotal for proportional distribution
    const subtotal = charges.reduce(
      (sum: number, c: any) => sum + Number(c.net_amount ?? 0),
      0
    );

    // 4. Distribute tax proportionally using floor + remainder algorithm
    let distributedTax = 0;
    let chargesUpdated = 0;

    for (let i = 0; i < charges.length; i++) {
      const charge = charges[i];
      const chargeAmount = Number(charge.net_amount ?? 0);
      const isLast = i === charges.length - 1;

      let chargeTax: number;
      if (isLast) {
        // Last item gets the remainder to ensure sum equals total
        chargeTax = totalTax - distributedTax;
      } else if (subtotal > 0) {
        // Proportional distribution using floor
        chargeTax = Math.floor((chargeAmount / subtotal) * totalTax);
        distributedTax += chargeTax;
      } else {
        // Equal distribution if no amounts
        chargeTax = Math.floor(totalTax / charges.length);
        distributedTax += chargeTax;
      }

      await knex('invoice_charges')
        .where({ item_id: charge.item_id, tenant })
        .update({
          external_tax_amount: chargeTax,
          external_tax_code: taxCode ?? null,
          external_tax_rate: taxRate ?? null,
          updated_at: knex.fn.now()
        });

      chargesUpdated++;
    }

    // 5. Update invoice tax_source to 'external'
    await knex('invoices')
      .where({ invoice_id: invoiceId, tenant })
      .update({
        tax_source: 'external' as TaxSource,
        updated_at: knex.fn.now()
      });

    // 6. Recalculate invoice total
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

    const difference = totalTax - originalTax;

    return {
      invoiceId,
      invoiceNumber,
      success: true,
      originalTax,
      importedTax: totalTax,
      difference,
      chargesUpdated,
      taxCode,
      taxRate
    };
  }

  /**
   * Calculate summary statistics from invoice results.
   */
  private calculateSummary(results: SingleInvoiceUpdateResult[]): CSVTaxImportResult['summary'] {
    return {
      totalInvoices: results.length,
      successfulUpdates: results.filter(r => r.success).length,
      failedUpdates: results.filter(r => !r.success).length,
      totalOriginalTax: results.reduce((sum, r) => sum + r.originalTax, 0),
      totalImportedTax: results.reduce((sum, r) => sum + r.importedTax, 0),
      totalDifference: results.reduce((sum, r) => sum + r.difference, 0)
    };
  }

  /**
   * Create an empty validation result for error cases.
   */
  private createEmptyValidation(errorMessage: string): CSVValidationResult {
    return {
      valid: false,
      structureValid: false,
      rowsValid: false,
      databaseValid: false,
      parsedRows: [],
      matchedInvoices: new Map(),
      errors: [{ field: 'general', message: errorMessage }],
      warnings: [],
      stats: {
        totalRows: 0,
        validRows: 0,
        matchedInvoices: 0,
        uniqueInvoices: 0,
        duplicateInvoices: []
      }
    };
  }

  /**
   * Create an empty summary for error cases.
   */
  private createEmptySummary(): CSVTaxImportResult['summary'] {
    return {
      totalInvoices: 0,
      successfulUpdates: 0,
      failedUpdates: 0,
      totalOriginalTax: 0,
      totalImportedTax: 0,
      totalDifference: 0
    };
  }

  /**
   * Validate a CSV file without applying changes (convenience method).
   */
  async validateOnly(
    csvContent: string,
    startDate: Date,
    endDate: Date
  ): Promise<CSVValidationResult> {
    const result = await this.importTaxFromCSV({
      csvContent,
      startDate,
      endDate,
      dryRun: true
    });
    return result.validation;
  }

  /**
   * Get import history for the tenant.
   */
  async getImportHistory(limit: number = 50): Promise<any[]> {
    const { knex, tenant } = await createTenantKnex();

    if (!tenant) {
      return [];
    }

    const imports = await knex('external_tax_imports')
      .where({ tenant, adapter_type: 'quickbooks_csv' })
      .orderBy('imported_at', 'desc')
      .limit(limit)
      .select('*');

    return imports.map((row: any) => ({
      importId: row.import_id,
      importedAt: row.imported_at,
      importedBy: row.imported_by,
      status: row.import_status,
      originalTax: row.original_internal_tax,
      importedTax: row.imported_external_tax,
      difference: row.tax_difference,
      metadata: row.metadata
    }));
  }

  /**
   * Rollback an import by reverting invoices to pending_external state.
   * This removes external_tax_amount values and sets tax_source back.
   */
  async rollbackImport(importId: string, userId?: string): Promise<{
    success: boolean;
    invoicesReverted: number;
    error?: string;
  }> {
    const { knex, tenant } = await createTenantKnex();

    if (!tenant) {
      return { success: false, invoicesReverted: 0, error: 'Tenant context required' };
    }

    try {
      // Get the import record
      const importRecord = await knex('external_tax_imports')
        .where({ import_id: importId, tenant })
        .first();

      if (!importRecord) {
        return { success: false, invoicesReverted: 0, error: 'Import not found' };
      }

      const invoiceNumbers = importRecord.metadata?.invoiceNumbers ?? [];
      if (invoiceNumbers.length === 0) {
        return { success: false, invoicesReverted: 0, error: 'No invoices in import record' };
      }

      let invoicesReverted = 0;

      await knex.transaction(async (trx: any) => {
        // Get invoice IDs from numbers
        const invoices = await trx('invoices')
          .where({ tenant })
          .whereIn('invoice_number', invoiceNumbers)
          .select('invoice_id');

        for (const invoice of invoices) {
          // Clear external tax from charges
          await trx('invoice_charges')
            .where({ invoice_id: invoice.invoice_id, tenant })
            .update({
              external_tax_amount: null,
              external_tax_code: null,
              external_tax_rate: null,
              updated_at: trx.fn.now()
            });

          // Revert invoice tax_source
          await trx('invoices')
            .where({ invoice_id: invoice.invoice_id, tenant })
            .update({
              tax_source: 'pending_external' as TaxSource,
              updated_at: trx.fn.now()
            });

          // Recalculate invoice total
          const totals = await trx('invoice_charges')
            .where({ invoice_id: invoice.invoice_id, tenant })
            .select(
              trx.raw('COALESCE(SUM(net_amount), 0) as subtotal'),
              trx.raw('COALESCE(SUM(tax_amount), 0) as tax')
            )
            .first();

          const newTotal = Number(totals?.subtotal ?? 0) + Number(totals?.tax ?? 0);

          await trx('invoices')
            .where({ invoice_id: invoice.invoice_id, tenant })
            .update({
              total_amount: newTotal,
              updated_at: trx.fn.now()
            });

          invoicesReverted++;
        }

        // Update import status
        await trx('external_tax_imports')
          .where({ import_id: importId, tenant })
          .update({
            import_status: 'rolled_back',
            metadata: {
              ...importRecord.metadata,
              rolledBackAt: new Date().toISOString(),
              rolledBackBy: userId
            },
            updated_at: trx.fn.now()
          });
      });

      logger.info('[CSVTaxImportService] Import rolled back', {
        tenant,
        importId,
        invoicesReverted
      });

      return { success: true, invoicesReverted };
    } catch (error: any) {
      logger.error('[CSVTaxImportService] Rollback failed', {
        tenant,
        importId,
        error: error.message
      });

      return { success: false, invoicesReverted: 0, error: error.message };
    }
  }
}

// Singleton instance
let serviceInstance: CSVTaxImportService | null = null;

/**
 * Get the singleton instance of CSVTaxImportService.
 */
export function getCSVTaxImportService(): CSVTaxImportService {
  if (!serviceInstance) {
    serviceInstance = new CSVTaxImportService();
  }
  return serviceInstance;
}
