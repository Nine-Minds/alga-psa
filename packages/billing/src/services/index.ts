/**
 * @alga-psa/billing - Services
 *
 * Business logic services for billing operations (tax calculation, invoice generation).
 */

export { TaxService } from './taxService';
export { BillingEngine } from '../lib/billing/billingEngine';
export { recalculateQuoteFinancials } from './quoteCalculationService';
export { PDFGenerationService, createPDFGenerationService } from './pdfGenerationService';
export {
  buildQuoteConversionPreview,
  convertQuoteToDraftContract,
  convertQuoteToDraftContractAndInvoice,
  convertQuoteToDraftInvoice,
  convertQuoteToDraftSalesOrder,
  type QuoteToContractConversionResult,
  type QuoteToBothConversionResult,
  type QuoteToInvoiceConversionResult,
  type QuoteToSalesOrderConversionResult,
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
  resolvePdfPrintOptionsFromAst,
  resolvePrintResolutionInputFromAst,
  resolveTemplatePrintSettingsFromAst,
} from '../lib/invoice-template-ast/printSettings';

// Accounting sync engine (closed-loop sync cycles)
export {
  runAccountingSyncCycle,
  CURSOR_OVERLAP_MS,
  type RunCycleParams,
  type RunCycleResult
} from './accountingSync/accountingSyncCycleService';
export {
  getAccountingSyncSettings,
  updateAccountingSyncSettings,
  type AccountingSyncSettings
} from './accountingSync/accountingSyncSettings';
export { SyncOperationsRepository, MAX_OP_ATTEMPTS } from './accountingSync/syncOperationsRepository';
export { SyncCycleRepository } from './accountingSync/syncCycleRepository';
export { SyncMappingLedger } from './accountingSync/syncMappingLedger';
export {
  recordExternalPayment,
  reverseExternalPayment,
  computeBalanceDue
} from './accountingSync/recordExternalPayment';
export { WorkflowTaskSyncExceptionService } from './accountingSync/syncExceptionService';
export {
  enqueueInvoiceAutoExport,
  satisfyExportOpsForManualBatch
} from './accountingSync/syncProducers';
export type { SyncExceptionService, SyncExceptionInput, SyncExceptionType } from './accountingSync/syncExceptions.types';
export {
  emptyCycleStats,
  MAPPING_SYNC_STATUS,
  type AccountingSyncCycleStats,
  type AccountingSyncOperation
} from './accountingSync/accountingSync.types';
