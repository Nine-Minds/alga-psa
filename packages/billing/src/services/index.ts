/**
 * @alga-psa/billing - Services
 *
 * Business logic services for billing operations (tax calculation, invoice generation).
 */

export { TaxService } from './taxService';
export { BillingEngine } from '../lib/billing/billingEngine';
export { recalculateQuoteFinancials } from './quoteCalculationService';
export { QuotePDFGenerationService, createQuotePDFGenerationService } from './quotePdfGenerationService';
export {
  convertQuoteToDraftContract,
  convertQuoteToDraftInvoice,
  type QuoteToContractConversionResult,
  type QuoteToInvoiceConversionResult,
} from './quoteConversionService';
export { ContractLineServiceConfigurationService } from './contractLineServiceConfigurationService';
export { ClientContractServiceConfigurationService } from './clientContractServiceConfigurationService';

// Accounting export services
export { AccountingExportService, type ExternalTaxImporter } from './accountingExportService';
export { AccountingExportInvoiceSelector, type InvoiceSelectionFilters, type InvoicePreviewLine } from './accountingExportInvoiceSelector';
export { AccountingExportValidation } from './accountingExportValidation';

// Accounting export repository
export {
  AccountingExportRepository,
  type CreateExportBatchInput,
  type CreateExportLineInput,
  type CreateExportErrorInput,
  type UpdateExportBatchStatusInput
} from '../repositories/accountingExportRepository';

// Accounting adapters
export { AccountingAdapterRegistry } from '../adapters/accounting/registry';
export { QuickBooksOnlineAdapter, buildQboPrivateNoteForPurchaseOrder } from '../adapters/accounting/quickBooksOnlineAdapter';
export { QuickBooksCSVAdapter, buildQuickBooksCsvMemo } from '../adapters/accounting/quickBooksCSVAdapter';
export { QuickBooksDesktopAdapter } from '../adapters/accounting/quickBooksDesktopAdapter';
export { XeroAdapter, buildXeroInvoiceReference } from '../adapters/accounting/xeroAdapter';
export { XeroCsvAdapter, buildXeroCsvReference } from '../adapters/accounting/xeroCsvAdapter';

// External tax import
export {
  ExternalTaxImportService,
  getExternalTaxImportService,
  type SingleImportResult,
  type BatchImportResult,
  type ReconciliationResult
} from './externalTaxImportService';
export {
  resolveInvoicePdfPrintOptionsFromAst,
  resolveInvoicePrintResolutionInputFromAst,
  resolveInvoiceTemplatePrintSettingsFromAst,
} from '../lib/invoice-template-ast/printSettings';
