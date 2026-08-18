/**
 * @alga-psa/billing - Actions
 *
 * Note: Some modules have overlapping exports. Consumers should import
 * from specific action files when there are conflicts:
 * - contractActions vs contractLineMappingActions (contract line functions)
 * - categoryActions vs serviceCategoryActions (service category functions)
 * - taxRateActions vs taxSettingsActions (getTaxRates)
 * - invoiceActions vs manualInvoiceActions (ManualInvoiceUpdate)
 * - billingSettingsActions vs billingSettingsTypes (BillingSettings)
 */

export * from './billingAndTax';
export * from './billingClientLocationActions';
export * from './billingCurrencyActions';
export * from './billingCycleActions';
export * from './billingCycleAnchorActions';
export * from './billingScheduleActions';
export * from './billingSettingsActions';
export * from './bucketOverlayActions';
export * from './bucketPoolActions';
export * from './accountingExportActions';
export * from './contractLineAction';
export * from './contractLinePresetActions';
export * from './contractLineServiceActions';
export * from './contractLineServiceConfigurationActions';
export * from './contractPricingScheduleActions';
export * from './contractReportActions';
export * from './contractWizardActions';
export * from './costRateActions';
export * from './creditActions';
export * from './hourBlockActions';
export * from './creditExpirationSettingsActions';
export * from './prepaidBalanceAlertSettingsActions';
export * from './externalTaxImportActions';
export * from './invoiceModification';
export * from './invoiceCogsActions';
export * from './invoiceQueries';
export * from './invoiceJobActions';
// NOTE: invoiceEmailLinkContext is intentionally NOT re-exported here. It is not a
// `'use server'` module (it exports a pure sync predicate), so re-exporting it from
// this barrel pulls its server-only transitive imports (@alga-psa/tenancy/server -> db
// -> node:async_hooks/crypto/buffer) into any client component that imports from the
// barrel, breaking the webpack client build. Import it directly from
// './invoiceEmailLinkContext' or '@alga-psa/billing/actions/invoiceEmailLinkContext'.
export {
  createSeparateProjectProductInvoices,
  getSeparateProjectProductInvoiceReview,
  type SeparateProjectProductInvoiceReview,
  type SeparateProjectProductInvoiceReviewRow,
} from './invoiceGeneration';
export * from './invoiceTemplates';
export * from './manualInvoiceActions';
export * from './salesOrderInvoicingActions';
export * from './rmaChargeActions';
export * from './restockingFeeActions';
export * from './salesOrderDocumentActions';
export * from '../lib/salesOrderDocumentError';
export * from './documentTemplateActions';
export * from './materialActions';
export * from './paymentActions';
export * from './profitabilityReportActions';
export * from './projectBillingConfigActions';
export * from './projectBillingScheduleActions';
export * from './projectBillingWarningActions';
export * from './quoteActions';
export * from './renewalsQueueActions';
export * from './serviceActions';
export * from './serviceRateTierActions';
export * from './taxSettingsActions';
export * from './taxSourceActions';
export * from './usageActions';
export * from './vendorBillExportActions';
export * from './voidInvoiceActions';

// Export contract actions explicitly to avoid conflicts with contractLineMappingActions
export {
  createContract,
  deleteContract,
  getContractById,
  getContracts,
  getContractsWithClients,
  getContractTemplates,
  updateContract,
  updateContractLineRate,
  checkContractHasInvoices,
  getContractLinesForContract,
  getContractSummary,
  getContractAssignments,
  getContractOverview,
  // These are duplicated with contractLineMappingActions - export from contractActions
  getContractLineMappings,
  addContractLine,
  removeContractLine,
  updateContractLineAssociation,
  getDetailedContractLines,
  isContractLineAttached,
} from './contractActions';

// Export category actions (same as service category)
export {
  getServiceCategories,
  createServiceCategory,
  updateServiceCategory,
  deleteServiceCategory,
} from './categoryActions';

// Export tax rate actions
export {
  getTaxRates,
  addTaxRate,
  updateTaxRate,
  deleteTaxRate,
} from './taxRateActions';

// QBO onboarding & reconciliation actions (EE only)
export {
  getCustomerMatchCandidates,
  linkClientToQboCustomer,
  bulkLinkExactCustomerMatches,
  createQboCustomerForClient,
  getHistoricalInvoiceMatches,
  bulkLinkHistoricalInvoices,
  backfillPaymentsForLinkedInvoices,
  getOnboardingWizardState,
  completeOnboardingWizard,
  type HistMatch,
} from './qboOnboardingActions';

// QBO products & services import (EE only, flag-gated)
export {
  previewQboItemImport,
  executeQboItemImport,
} from './qboItemImportActions';

// Accounting sync actions (EE only)
export {
  getAccountingSyncSettingsAction,
  updateAccountingSyncSettingsAction,
  runAccountingSyncNow,
  queueInvoiceSync,
  resolveAccountingDriftReExport,
  resolveAccountingDriftAccept,
  getInvoiceSyncStatuses,
  getAccountingSyncHealth,
  setDefaultQboRealm,
} from './accountingSyncActions';
export type {
  InvoiceSyncState,
  InvoiceSyncStatus,
  AccountingSyncHealth,
  AccountingSyncRealmInfo,
} from './accountingSyncActions';
