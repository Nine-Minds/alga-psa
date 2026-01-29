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
export * from './billingCurrencyActions';
export * from './billingCycleActions';
export * from './billingCycleAnchorActions';
export * from './billingScheduleActions';
export * from './billingSettingsActions';
export * from './bucketOverlayActions';
export * from './contractLineAction';
export * from './contractLinePresetActions';
export * from './contractLineServiceActions';
export * from './contractLineServiceConfigurationActions';
export * from './contractPricingScheduleActions';
export * from './contractReportActions';
export * from './contractWizardActions';
export * from './creditActions';
export * from './creditExpirationSettingsActions';
export * from './creditReconciliationActions';
export * from './creditReconciliationFixActions';
export * from './invoiceModification';
export * from './invoiceQueries';
export * from './invoiceJobActions';
export * from './invoiceTemplates';
export * from './manualInvoiceActions';
export * from './materialActions';
export * from './paymentActions';
export * from './serviceActions';
export * from './serviceRateTierActions';
export * from './taxSettingsActions';
export * from './taxSourceActions';
export * from './usageActions';

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
  checkClientHasActiveContract,
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
