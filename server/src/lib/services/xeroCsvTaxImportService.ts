import { v4 as uuid4 } from 'uuid';
import logger from '@shared/core/logger';
import { createTenantKnex } from '../db';
import { TaxSource } from '../../interfaces/tax.interfaces';
import { parseCSV } from '../utils/csvParser';

/**
 * Fixed tracking category names - must match XeroCsvAdapter constants.
 */
const TRACKING_CATEGORY_SOURCE_SYSTEM = 'Source System';
const TRACKING_CATEGORY_SOURCE_VALUE = 'AlgaPSA';
const TRACKING_CATEGORY_INVOICE_ID = 'External Invoice ID';

/**
 * Parsed row from Xero Invoice Details Report.
 * Column names vary slightly based on Xero export settings.
 */
interface XeroInvoiceDetailsRow {
  invoiceNumber: string;
  invoiceDate?: string;
  dueDate?: string;
  status?: string;
  reference?: string;
  contactName: string;
  lineDescription?: string;
  quantity?: number;
  unitAmount?: number;
  lineAmount: number;
  taxType?: string;
  taxRate?: number;
  taxAmount: number;
  // Tracking categories
  trackingCategory1Name?: string;
  trackingCategory1Option?: string;
  trackingCategory2Name?: string;
  trackingCategory2Option?: string;
  // Alternative tracking column names
  sourceSystem?: string;
  externalInvoiceId?: string;
}

/**
 * Matched invoice ready for tax import.
 */
interface MatchedInvoice {
  algaInvoiceId: string;
  xeroInvoiceNumber: string;
  contactName: string;
  lines: XeroInvoiceDetailsRow[];
  totalTax: number;
  totalAmount: number;
}

/**
 * Preview of a single invoice match.
 */
export interface TaxImportPreviewItem {
  xeroInvoiceNumber: string;
  algaInvoiceId: string | null;
  algaInvoiceNumber: string | null;
  contactName: string;
  status: 'matched' | 'unmatched' | 'already_imported' | 'not_pending';
  reason?: string;
  lineCount: number;
  taxAmount: number;
}

/**
 * Result of tax import preview.
 */
export interface TaxImportPreviewResult {
  invoiceCount: number;
  matchedCount: number;
  unmatchedCount: number;
  alreadyImportedCount: number;
  notPendingCount: number;
  totalTaxToImport: number;
  preview: TaxImportPreviewItem[];
}

/**
 * Result of a single invoice tax import.
 */
export interface SingleTaxImportResult {
  success: boolean;
  invoiceId: string;
  xeroInvoiceNumber: string;
  importId?: string;
  originalTax: number;
  importedTax: number;
  difference: number;
  chargesUpdated: number;
  error?: string;
}

/**
 * Result of full tax import operation.
 */
export interface TaxImportResult {
  success: boolean;
  totalProcessed: number;
  successCount: number;
  failureCount: number;
  skippedCount: number;
  totalTaxImported: number;
  results: SingleTaxImportResult[];
  errors: Array<{ invoiceId: string; xeroInvoiceNumber: string; error: string }>;
}

/**
 * Service for importing tax amounts from Xero Invoice Details Report CSV.
 *
 * This service handles the CSV-based tax import workflow:
 * 1. Parse Xero Invoice Details Report CSV
 * 2. Match rows to Alga invoices using tracking categories
 * 3. Apply tax amounts to invoice charges
 * 4. Update invoice tax_source to 'external'
 *
 * The matching is done using the "External Invoice ID" tracking category
 * that was included when invoices were exported from Alga.
 */
export class XeroCsvTaxImportService {
  /**
   * Parse Xero Invoice Details Report CSV content.
   */
  parseInvoiceDetailsReport(csvContent: string): XeroInvoiceDetailsRow[] {
    const parsed = parseCSV(csvContent);

    if (parsed.length === 0) {
      return [];
    }

    // First row is headers
    const headers = parsed[0].map(h => h.toLowerCase().trim());
    const rows = parsed.slice(1);

    // Map column indices
    const columnMap = this.buildColumnMap(headers);

    const result: XeroInvoiceDetailsRow[] = [];

    for (const row of rows) {
      if (row.every(cell => !cell || cell.trim() === '')) {
        continue; // Skip empty rows
      }

      const parsed = this.parseRow(row, columnMap);
      if (parsed) {
        result.push(parsed);
      }
    }

    return result;
  }

  /**
   * Build a map of column indices from headers.
   * Xero reports can have varying column names, so we handle multiple variants.
   */
  private buildColumnMap(headers: string[]): Map<string, number> {
    const map = new Map<string, number>();

    const columnVariants: Record<string, string[]> = {
      invoiceNumber: ['invoice number', 'invoicenumber', 'invoice no', 'invoice #', 'inv no'],
      invoiceDate: ['invoice date', 'invoicedate', 'date'],
      dueDate: ['due date', 'duedate'],
      status: ['status', 'invoice status'],
      reference: ['reference', 'ref'],
      contactName: ['contact name', 'contactname', 'contact', 'customer', 'customer name'],
      lineDescription: ['description', 'line description', 'item', 'line item'],
      quantity: ['quantity', 'qty'],
      unitAmount: ['unit amount', 'unitamount', 'unit price', 'rate'],
      lineAmount: ['line amount', 'lineamount', 'amount', 'line total'],
      taxType: ['tax type', 'taxtype', 'tax code', 'tax rate name'],
      taxRate: ['tax rate', 'taxrate', 'tax %', 'tax percent'],
      taxAmount: ['tax amount', 'taxamount', 'tax', 'line tax'],
      trackingCategory1Name: ['tracking name 1', 'trackingname1', 'tracking category 1'],
      trackingCategory1Option: ['tracking option 1', 'trackingoption1', 'tracking value 1'],
      trackingCategory2Name: ['tracking name 2', 'trackingname2', 'tracking category 2'],
      trackingCategory2Option: ['tracking option 2', 'trackingoption2', 'tracking value 2'],
      sourceSystem: ['source system'],
      externalInvoiceId: ['external invoice id', 'external invoice', 'alga invoice id']
    };

    for (const [field, variants] of Object.entries(columnVariants)) {
      for (const variant of variants) {
        const index = headers.indexOf(variant);
        if (index !== -1) {
          map.set(field, index);
          break;
        }
      }
    }

    return map;
  }

  /**
   * Parse a single CSV row into an XeroInvoiceDetailsRow.
   */
  private parseRow(row: string[], columnMap: Map<string, number>): XeroInvoiceDetailsRow | null {
    const getValue = (field: string): string | undefined => {
      const index = columnMap.get(field);
      if (index === undefined || index >= row.length) {
        return undefined;
      }
      const value = row[index]?.trim();
      return value || undefined;
    };

    const getNumber = (field: string): number | undefined => {
      const value = getValue(field);
      if (!value) return undefined;
      // Remove currency symbols, commas, etc.
      const cleaned = value.replace(/[^0-9.-]/g, '');
      const num = parseFloat(cleaned);
      return isNaN(num) ? undefined : num;
    };

    const invoiceNumber = getValue('invoiceNumber');
    const contactName = getValue('contactName');
    const lineAmount = getNumber('lineAmount');
    const taxAmount = getNumber('taxAmount') ?? 0;

    // Skip rows without essential data
    if (!invoiceNumber || !contactName || lineAmount === undefined) {
      return null;
    }

    // Try to get tracking category data
    let externalInvoiceId: string | undefined;

    // Check direct column first
    externalInvoiceId = getValue('externalInvoiceId');

    // Check tracking categories if direct column not found
    if (!externalInvoiceId) {
      const tc1Name = getValue('trackingCategory1Name');
      const tc1Option = getValue('trackingCategory1Option');
      const tc2Name = getValue('trackingCategory2Name');
      const tc2Option = getValue('trackingCategory2Option');

      if (tc1Name?.toLowerCase().includes('external invoice') ||
          tc1Name?.toLowerCase().includes('invoice id')) {
        externalInvoiceId = tc1Option;
      } else if (tc2Name?.toLowerCase().includes('external invoice') ||
                 tc2Name?.toLowerCase().includes('invoice id')) {
        externalInvoiceId = tc2Option;
      }
    }

    return {
      invoiceNumber,
      invoiceDate: getValue('invoiceDate'),
      dueDate: getValue('dueDate'),
      status: getValue('status'),
      reference: getValue('reference'),
      contactName,
      lineDescription: getValue('lineDescription'),
      quantity: getNumber('quantity'),
      unitAmount: getNumber('unitAmount'),
      lineAmount,
      taxType: getValue('taxType'),
      taxRate: getNumber('taxRate'),
      taxAmount,
      trackingCategory1Name: getValue('trackingCategory1Name'),
      trackingCategory1Option: getValue('trackingCategory1Option'),
      trackingCategory2Name: getValue('trackingCategory2Name'),
      trackingCategory2Option: getValue('trackingCategory2Option'),
      sourceSystem: getValue('sourceSystem'),
      externalInvoiceId
    };
  }

  /**
   * Group parsed rows by invoice and match to Alga invoices.
   */
  async matchInvoicesToAlga(
    rows: XeroInvoiceDetailsRow[]
  ): Promise<Map<string, MatchedInvoice>> {
    const { knex, tenant } = await createTenantKnex();

    if (!tenant) {
      throw new Error('Tenant context required for invoice matching');
    }

    // Group rows by Xero invoice number
    const invoiceGroups = new Map<string, XeroInvoiceDetailsRow[]>();
    for (const row of rows) {
      const existing = invoiceGroups.get(row.invoiceNumber) ?? [];
      existing.push(row);
      invoiceGroups.set(row.invoiceNumber, existing);
    }

    const matched = new Map<string, MatchedInvoice>();

    for (const [xeroInvoiceNumber, lines] of invoiceGroups) {
      // Try to find Alga invoice ID from tracking categories
      let algaInvoiceId: string | null = null;

      for (const line of lines) {
        if (line.externalInvoiceId) {
          algaInvoiceId = line.externalInvoiceId;
          break;
        }
      }

      // If no tracking category, try to match by invoice number
      if (!algaInvoiceId) {
        const invoice = await knex('invoices')
          .where({ tenant, invoice_number: xeroInvoiceNumber })
          .select('invoice_id')
          .first();

        if (invoice) {
          algaInvoiceId = invoice.invoice_id;
        }
      }

      // If still no match, try reference field
      if (!algaInvoiceId) {
        const reference = lines[0]?.reference;
        if (reference) {
          // Reference might be the invoice_id
          const invoice = await knex('invoices')
            .where({ tenant })
            .where(function() {
              this.where('invoice_id', reference)
                .orWhere('invoice_number', reference);
            })
            .select('invoice_id')
            .first();

          if (invoice) {
            algaInvoiceId = invoice.invoice_id;
          }
        }
      }

      if (algaInvoiceId) {
        const totalTax = lines.reduce((sum, l) => sum + (l.taxAmount ?? 0), 0);
        const totalAmount = lines.reduce((sum, l) => sum + (l.lineAmount ?? 0), 0);

        matched.set(algaInvoiceId, {
          algaInvoiceId,
          xeroInvoiceNumber,
          contactName: lines[0]?.contactName ?? '',
          lines,
          totalTax,
          totalAmount
        });
      }
    }

    return matched;
  }

  /**
   * Preview tax import without applying changes.
   */
  async previewTaxImport(csvContent: string): Promise<TaxImportPreviewResult> {
    const { knex, tenant } = await createTenantKnex();

    if (!tenant) {
      throw new Error('Tenant context required for tax import preview');
    }

    const rows = this.parseInvoiceDetailsReport(csvContent);
    const matched = await this.matchInvoicesToAlga(rows);

    // Group rows by Xero invoice number for unmatched count
    const xeroInvoiceNumbers = new Set(rows.map(r => r.invoiceNumber));

    const preview: TaxImportPreviewItem[] = [];
    let matchedCount = 0;
    let unmatchedCount = 0;
    let alreadyImportedCount = 0;
    let notPendingCount = 0;
    let totalTaxToImport = 0;

    // Process matched invoices
    const matchedInvoiceIds = Array.from(matched.keys());
    const invoiceInfo = matchedInvoiceIds.length > 0
      ? await knex('invoices')
          .whereIn('invoice_id', matchedInvoiceIds)
          .where({ tenant })
          .select('invoice_id', 'invoice_number', 'tax_source')
      : [];

    const invoiceInfoMap = new Map(invoiceInfo.map(i => [i.invoice_id, i]));

    for (const [algaInvoiceId, matchedInvoice] of matched) {
      const info = invoiceInfoMap.get(algaInvoiceId);

      let status: TaxImportPreviewItem['status'];
      let reason: string | undefined;

      if (!info) {
        status = 'unmatched';
        reason = 'Invoice not found in database';
        unmatchedCount++;
      } else if (info.tax_source === 'external') {
        status = 'already_imported';
        reason = 'Tax has already been imported';
        alreadyImportedCount++;
      } else if (info.tax_source !== 'pending_external') {
        status = 'not_pending';
        reason = `Invoice tax source is '${info.tax_source}', not 'pending_external'`;
        notPendingCount++;
      } else {
        status = 'matched';
        matchedCount++;
        totalTaxToImport += matchedInvoice.totalTax;
      }

      preview.push({
        xeroInvoiceNumber: matchedInvoice.xeroInvoiceNumber,
        algaInvoiceId,
        algaInvoiceNumber: info?.invoice_number ?? null,
        contactName: matchedInvoice.contactName,
        status,
        reason,
        lineCount: matchedInvoice.lines.length,
        taxAmount: matchedInvoice.totalTax
      });
    }

    // Add unmatched invoices (in Xero but not matched to Alga)
    for (const xeroInvoiceNumber of xeroInvoiceNumbers) {
      const isMatched = Array.from(matched.values()).some(
        m => m.xeroInvoiceNumber === xeroInvoiceNumber
      );

      if (!isMatched) {
        const lines = rows.filter(r => r.invoiceNumber === xeroInvoiceNumber);
        const totalTax = lines.reduce((sum, l) => sum + (l.taxAmount ?? 0), 0);

        unmatchedCount++;
        preview.push({
          xeroInvoiceNumber,
          algaInvoiceId: null,
          algaInvoiceNumber: null,
          contactName: lines[0]?.contactName ?? '',
          status: 'unmatched',
          reason: 'No matching Alga invoice found',
          lineCount: lines.length,
          taxAmount: totalTax
        });
      }
    }

    // Sort by status (matched first) then by invoice number
    preview.sort((a, b) => {
      const statusOrder = { matched: 0, not_pending: 1, already_imported: 2, unmatched: 3 };
      const statusDiff = statusOrder[a.status] - statusOrder[b.status];
      if (statusDiff !== 0) return statusDiff;
      return a.xeroInvoiceNumber.localeCompare(b.xeroInvoiceNumber);
    });

    return {
      invoiceCount: xeroInvoiceNumbers.size,
      matchedCount,
      unmatchedCount,
      alreadyImportedCount,
      notPendingCount,
      totalTaxToImport,
      preview
    };
  }

  /**
   * Import tax amounts from Xero Invoice Details Report.
   */
  async importTaxFromReport(csvContent: string, userId?: string): Promise<TaxImportResult> {
    const { knex, tenant } = await createTenantKnex();

    if (!tenant) {
      throw new Error('Tenant context required for tax import');
    }

    const rows = this.parseInvoiceDetailsReport(csvContent);
    const matched = await this.matchInvoicesToAlga(rows);

    const result: TaxImportResult = {
      success: true,
      totalProcessed: 0,
      successCount: 0,
      failureCount: 0,
      skippedCount: 0,
      totalTaxImported: 0,
      results: [],
      errors: []
    };

    // Get invoice info for all matched
    const matchedInvoiceIds = Array.from(matched.keys());
    if (matchedInvoiceIds.length === 0) {
      logger.info('[XeroCsvTaxImportService] No invoices matched for import', { tenant });
      return result;
    }

    const invoiceInfo = await knex('invoices')
      .whereIn('invoice_id', matchedInvoiceIds)
      .where({ tenant })
      .select('invoice_id', 'invoice_number', 'tax_source');

    const invoiceInfoMap = new Map(invoiceInfo.map(i => [i.invoice_id, i]));

    for (const [algaInvoiceId, matchedInvoice] of matched) {
      result.totalProcessed++;

      const info = invoiceInfoMap.get(algaInvoiceId);

      // Skip if invoice not found or not pending
      if (!info) {
        result.skippedCount++;
        result.results.push({
          success: false,
          invoiceId: algaInvoiceId,
          xeroInvoiceNumber: matchedInvoice.xeroInvoiceNumber,
          originalTax: 0,
          importedTax: 0,
          difference: 0,
          chargesUpdated: 0,
          error: 'Invoice not found in database'
        });
        continue;
      }

      if (info.tax_source !== 'pending_external') {
        result.skippedCount++;
        result.results.push({
          success: false,
          invoiceId: algaInvoiceId,
          xeroInvoiceNumber: matchedInvoice.xeroInvoiceNumber,
          originalTax: 0,
          importedTax: 0,
          difference: 0,
          chargesUpdated: 0,
          error: `Invoice tax source is '${info.tax_source}', expected 'pending_external'`
        });
        continue;
      }

      try {
        const importResult = await this.importTaxForSingleInvoice(
          knex,
          tenant,
          algaInvoiceId,
          matchedInvoice,
          userId
        );

        result.results.push(importResult);

        if (importResult.success) {
          result.successCount++;
          result.totalTaxImported += importResult.importedTax;
        } else {
          result.failureCount++;
          result.errors.push({
            invoiceId: algaInvoiceId,
            xeroInvoiceNumber: matchedInvoice.xeroInvoiceNumber,
            error: importResult.error ?? 'Unknown error'
          });
        }
      } catch (error: any) {
        result.failureCount++;
        result.errors.push({
          invoiceId: algaInvoiceId,
          xeroInvoiceNumber: matchedInvoice.xeroInvoiceNumber,
          error: error.message
        });
        result.results.push({
          success: false,
          invoiceId: algaInvoiceId,
          xeroInvoiceNumber: matchedInvoice.xeroInvoiceNumber,
          originalTax: 0,
          importedTax: 0,
          difference: 0,
          chargesUpdated: 0,
          error: error.message
        });
      }
    }

    result.success = result.failureCount === 0;

    logger.info('[XeroCsvTaxImportService] Tax import completed', {
      tenant,
      totalProcessed: result.totalProcessed,
      successCount: result.successCount,
      failureCount: result.failureCount,
      skippedCount: result.skippedCount,
      totalTaxImported: result.totalTaxImported
    });

    return result;
  }

  /**
   * Import tax for a single invoice.
   */
  private async importTaxForSingleInvoice(
    knex: any,
    tenant: string,
    invoiceId: string,
    matchedInvoice: MatchedInvoice,
    userId?: string
  ): Promise<SingleTaxImportResult> {
    // Get current charges
    const charges = await knex('invoice_charges')
      .where({ invoice_id: invoiceId, tenant })
      .select('item_id', 'description', 'tax_amount', 'net_amount')
      .orderBy('created_at')
      .orderBy('item_id');

    const originalTax = charges.reduce(
      (sum: number, c: any) => sum + (c.tax_amount ?? 0),
      0
    );

    // Apply tax using proportional distribution
    // Since we don't have line-level matching from CSV, distribute based on amounts
    const subtotal = charges.reduce(
      (sum: number, c: any) => sum + Number(c.net_amount || 0),
      0
    );

    const totalTax = Math.round(matchedInvoice.totalTax * 100); // Convert to cents
    let distributedTax = 0;
    let chargesUpdated = 0;

    for (let i = 0; i < charges.length; i++) {
      const charge = charges[i];
      const chargeAmount = Number(charge.net_amount || 0);
      const isLast = i === charges.length - 1;

      let taxAmount: number;
      if (isLast) {
        taxAmount = totalTax - distributedTax;
      } else if (subtotal > 0) {
        taxAmount = Math.floor((chargeAmount / subtotal) * totalTax);
        distributedTax += taxAmount;
      } else {
        taxAmount = 0;
      }

      await knex('invoice_charges')
        .where({ item_id: charge.item_id, tenant })
        .update({
          external_tax_amount: taxAmount,
          external_tax_code: matchedInvoice.lines[0]?.taxType ?? null,
          external_tax_rate: matchedInvoice.lines[0]?.taxRate ?? null,
          updated_at: knex.fn.now()
        });

      chargesUpdated++;
    }

    // Update invoice tax_source
    await knex('invoices')
      .where({ invoice_id: invoiceId, tenant })
      .update({
        tax_source: 'external' as TaxSource,
        updated_at: knex.fn.now()
      });

    // Recalculate invoice total
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

    // Record the import
    const importId = uuid4();
    const importedTax = totalTax;
    const difference = importedTax - originalTax;

    await knex('external_tax_imports').insert({
      import_id: importId,
      tenant,
      invoice_id: invoiceId,
      adapter_type: 'xero_csv',
      external_invoice_ref: matchedInvoice.xeroInvoiceNumber,
      imported_at: knex.fn.now(),
      imported_by: userId ?? null,
      import_status: 'success',
      original_internal_tax: originalTax,
      imported_external_tax: importedTax,
      tax_difference: difference,
      metadata: {
        source: 'xero_invoice_details_report',
        xeroInvoiceNumber: matchedInvoice.xeroInvoiceNumber,
        contactName: matchedInvoice.contactName,
        lineCount: matchedInvoice.lines.length,
        chargesUpdated
      },
      created_at: knex.fn.now(),
      updated_at: knex.fn.now()
    });

    logger.info('[XeroCsvTaxImportService] Imported tax for invoice', {
      invoiceId,
      xeroInvoiceNumber: matchedInvoice.xeroInvoiceNumber,
      originalTax,
      importedTax,
      difference,
      chargesUpdated
    });

    return {
      success: true,
      invoiceId,
      xeroInvoiceNumber: matchedInvoice.xeroInvoiceNumber,
      importId,
      originalTax,
      importedTax,
      difference,
      chargesUpdated
    };
  }
}

// Singleton instance
let serviceInstance: XeroCsvTaxImportService | null = null;

/**
 * Get the singleton instance of XeroCsvTaxImportService.
 */
export function getXeroCsvTaxImportService(): XeroCsvTaxImportService {
  if (!serviceInstance) {
    serviceInstance = new XeroCsvTaxImportService();
  }
  return serviceInstance;
}
