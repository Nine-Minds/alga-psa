/**
 * @alga-psa/billing
 *
 * Billing module for Alga PSA.
 * Provides invoice management, payment processing, contract billing, and tax calculation.
 */

// Models
export { Invoice, Contract } from './models';

// Components
export { BillingDashboard, CreditsPage, TemplateRenderer, PurchaseOrderSummaryBanner, AutomaticInvoices, BillingCycles } from './components';

// Re-export invoice types from @alga-psa/types
export type {
  IInvoice,
  IInvoiceCharge,
  IInvoiceItem,
  IInvoiceTemplate,
  IInvoiceAnnotation,
  ICustomField,
  IConditionalRule,
  InvoiceStatus,
  InvoiceViewModel,
  TaxSource,
  TaxImportState,
  DiscountType,
  InvoiceTemplateSource,
  ICreditAllocation,
} from '@alga-psa/types';

// Re-export contract types from @alga-psa/types
export type {
  IContract,
  IContractWithClient,
  IClientContract,
  IContractLine,
  IContractLineMapping,
  IContractAssignmentSummary,
  IContractPricingSchedule,
  ContractStatus,
} from '@alga-psa/types';
export type {
  CadenceOwner,
  DuePosition,
  GeneratedRecurringServicePeriodReasonCode,
  ICadenceBoundaryGenerator,
  ICadenceBoundaryGeneratorInput,
  IGeneratedRecurringServicePeriodRecordProvenance,
  IPersistedRecurringObligationRef,
  IRecurringActivityWindow,
  IRecurringCoverage,
  IRecurringDuePeriodSelection,
  IRecurringInvoiceDetailTiming,
  IRecurringInvoiceWindow,
  IRecurringObligationRef,
  IRecurringServicePeriod,
  IRecurringServicePeriodRecord,
  IRecurringServicePeriodRecordProvenance,
  IRegeneratedRecurringServicePeriodRecordProvenance,
  IRepairRecurringServicePeriodRecordProvenance,
  IResolvedRecurringSettlement,
  IUserEditedRecurringServicePeriodRecordProvenance,
  RecurringServicePeriodProvenanceReasonCode,
  RecurringServicePeriodLifecycleState,
  RecurringServicePeriodProvenanceKind,
  RegeneratedRecurringServicePeriodReasonCode,
  RepairRecurringServicePeriodReasonCode,
  UserEditedRecurringServicePeriodReasonCode,
} from '@alga-psa/types';

// Re-export invoice constants
export {
  RECURRING_SERVICE_PERIOD_PROVENANCE_REASON_CODES,
  INVOICE_STATUS_METADATA,
  INVOICE_STATUS_DISPLAY_ORDER,
  DEFAULT_ACCOUNTING_EXPORT_STATUSES,
  getTaxImportState,
} from '@alga-psa/types';
export {
  resolveInvoicePdfPrintOptionsFromAst,
  resolveInvoicePrintResolutionInputFromAst,
  resolveInvoiceTemplatePrintSettingsFromAst,
} from './lib/invoice-template-ast/printSettings';

// Legacy accounting integration helpers (used by server adapters/workflows)
export { AccountingMappingResolver } from './services/accountingMappingResolver';
export type { MappingResolution } from './services/accountingMappingResolver';
export { KnexInvoiceMappingRepository } from './repositories/invoiceMappingRepository';
export {
  CompanyAccountingSyncService,
  KnexCompanyMappingRepository,
  buildNormalizedCompanyPayload,
  QuickBooksOnlineCompanyAdapter,
  XeroCompanyAdapter,
} from './services/companySync';
export {
  DEFAULT_CADENCE_OWNER,
  assertHalfOpenDateRange,
  buildRecurringInvoiceDetailTiming,
  calculateServicePeriodCoverage,
  intersectActivityWindow,
  mapServicePeriodToInvoiceWindow,
  resolveRecurringSettlementsForInvoiceWindow,
  resolveCadenceOwner,
  selectDueServicePeriodsForInvoiceWindow,
  selectCadenceBoundaryGenerator,
} from '@alga-psa/shared/billingClients/recurringTiming';
export {
  generateAnnualContractCadenceServicePeriods,
  contractCadenceMonthlyBoundaryGenerator,
  generateMonthlyContractCadenceServicePeriods,
  generateQuarterlyContractCadenceServicePeriods,
  resolveContractCadenceAnchorDate,
  generateSemiAnnualContractCadenceServicePeriods,
} from '@alga-psa/shared/billingClients/contractCadenceServicePeriods';
export {
  assessRecurringServicePeriodGenerationCoverage,
  DEFAULT_RECURRING_SERVICE_PERIOD_GENERATION_HORIZON_DAYS,
  DEFAULT_RECURRING_SERVICE_PERIOD_REPLENISHMENT_THRESHOLD_DAYS,
  findRecurringServicePeriodContinuityIssues,
  resolveRecurringServicePeriodGenerationHorizon,
} from '@alga-psa/shared/billingClients/recurringServicePeriodGenerationHorizon';
export {
  materializeClientCadenceServicePeriods,
} from '@alga-psa/shared/billingClients/materializeClientCadenceServicePeriods';
export type {
  IClientCadenceMaterializedServicePeriodPlan,
  MaterializeClientCadenceServicePeriodsInput,
} from '@alga-psa/shared/billingClients/materializeClientCadenceServicePeriods';
export {
  materializeContractCadenceServicePeriods,
} from '@alga-psa/shared/billingClients/materializeContractCadenceServicePeriods';
export type {
  IContractCadenceMaterializedServicePeriodPlan,
  MaterializeContractCadenceServicePeriodsInput,
} from '@alga-psa/shared/billingClients/materializeContractCadenceServicePeriods';
export {
  isRecurringServicePeriodProvenanceDivergent,
  isRecurringServicePeriodProvenanceReasonCode,
  validateRecurringServicePeriodProvenance,
} from '@alga-psa/shared/billingClients/recurringServicePeriodProvenance';
export {
  canTransitionRecurringServicePeriodState,
  isRecurringServicePeriodStateTerminal,
  RECURRING_SERVICE_PERIOD_LIFECYCLE_TRANSITIONS,
  RECURRING_SERVICE_PERIOD_TERMINAL_STATES,
} from '@alga-psa/shared/billingClients/recurringServicePeriodLifecycle';
export type {
  AccountingAdapterType,
  ExternalCompanyRecord,
  NormalizedCompanyPayload,
} from './services/companySync';

// Note: This module contains:
// - Invoice CRUD operations (migrated)
// - Contract management (migrated)
// - Payment processing (pending migration)
// - Tax calculation service (pending migration)
// - Credit management (pending migration)
// - 120+ billing dashboard components (pending migration)
