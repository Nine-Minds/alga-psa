export type TaxImportPreviewStatus = 'matched' | 'unmatched' | 'already_imported' | 'not_pending';

/**
 * Preview of a single invoice match for Xero CSV tax import.
 */
export interface TaxImportPreviewItem {
  xeroInvoiceNumber: string;
  algaInvoiceId: string | null;
  algaInvoiceNumber: string | null;
  contactName: string;
  status: TaxImportPreviewStatus;
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

