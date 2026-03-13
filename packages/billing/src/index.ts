/**
 * @alga-psa/billing
 *
 * Billing module for Alga PSA.
 * Provides invoice management, payment processing, contract billing, and tax calculation.
 */

// Models
export { Invoice, Contract, Quote, QuoteItem, QuoteActivity } from './models';

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

export type {
  IQuote,
  IQuoteItem,
  IQuoteActivity,
  IQuoteWithClient,
  IQuoteListItem,
  QuoteStatus,
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
  IRecurringServicePeriodParityComparisonResult,
  IRecurringServicePeriodParityDrift,
  IRecurringServicePeriodDueSelectionQuery,
  IRecurringServicePeriodInvoiceLinkage,
  IRecurringInvoiceWindow,
  IRecurringObligationRef,
  IRecurringServicePeriod,
  IRecurringServicePeriodRecord,
  IRecurringServicePeriodRecordProvenance,
  IRegeneratedRecurringServicePeriodRecordProvenance,
  IRepairRecurringServicePeriodRecordProvenance,
  IResolvedRecurringSettlement,
  IUserEditedRecurringServicePeriodRecordProvenance,
  RecurringServicePeriodParityComparisonState,
  RecurringServicePeriodParityDriftKind,
  RecurringServicePeriodDueSelectionState,
  RecurringServicePeriodProvenanceReasonCode,
  RecurringServicePeriodLifecycleState,
  RecurringServicePeriodProvenanceKind,
  RegeneratedRecurringServicePeriodReasonCode,
  RepairRecurringServicePeriodReasonCode,
  UserEditedRecurringServicePeriodReasonCode,
} from '@alga-psa/types';

// Re-export invoice constants
export {
  DEFAULT_RECURRING_SERVICE_PERIOD_PARITY_COMPARISON_STATES,
  DEFAULT_RECURRING_SERVICE_PERIOD_DUE_SELECTION_STATES,
  RECURRING_SERVICE_PERIOD_PROVENANCE_REASON_CODES,
  INVOICE_STATUS_METADATA,
  INVOICE_STATUS_DISPLAY_ORDER,
  DEFAULT_ACCOUNTING_EXPORT_STATUSES,
  getTaxImportState,
  QUOTE_STATUS_METADATA,
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
  backfillRecurringServicePeriods,
} from '@alga-psa/shared/billingClients/backfillRecurringServicePeriods';
export {
  editRecurringServicePeriodBoundaries,
} from '@alga-psa/shared/billingClients/editRecurringServicePeriodBoundaries';
export {
  skipOrDeferRecurringServicePeriod,
} from '@alga-psa/shared/billingClients/skipOrDeferRecurringServicePeriod';
export {
  assertRecurringServicePeriodV1EditOperationSupported,
  isRecurringServicePeriodV1EditOperationSupported,
  RECURRING_SERVICE_PERIOD_SUPPORTED_EDIT_OPERATIONS,
  RECURRING_SERVICE_PERIOD_UNSUPPORTED_V1_EDIT_OPERATIONS,
} from '@alga-psa/shared/billingClients/recurringServicePeriodEditCapabilities';
export {
  validateRecurringServicePeriodEditContinuity,
} from '@alga-psa/shared/billingClients/recurringServicePeriodEditValidation';
export {
  applyRecurringServicePeriodEditRequest,
} from '@alga-psa/shared/billingClients/recurringServicePeriodEditRequests';
export {
  getRecurringServicePeriodDisplayState,
} from '@alga-psa/shared/billingClients/recurringServicePeriodDisplayState';
export {
  getRecurringServicePeriodGovernanceRequirement,
  listRecurringServicePeriodGovernanceRequirements,
} from '@alga-psa/shared/billingClients/recurringServicePeriodGovernance';
export {
  getRecurringServicePeriodAuthorityBoundary,
  listRecurringServicePeriodAuthorityBoundaries,
} from '@alga-psa/shared/billingClients/recurringServicePeriodAuthorityBoundary';
export {
  buildRecurringServicePeriodListingQuery,
  listRecurringServicePeriodRecords,
} from '@alga-psa/shared/billingClients/recurringServicePeriodListing';
export {
  buildRecurringServicePeriodOperationalView,
} from '@alga-psa/shared/billingClients/recurringServicePeriodOperationalView';
export {
  regenerateRecurringServicePeriods,
} from '@alga-psa/shared/billingClients/regenerateRecurringServicePeriods';
export {
  resolveRecurringServicePeriodRegenerationDecision,
} from '@alga-psa/shared/billingClients/recurringServicePeriodRegenerationTriggers';
export {
  applyRecurringServicePeriodInvoiceLinkage,
  hasRecurringServicePeriodInvoiceLinkage,
} from '@alga-psa/shared/billingClients/recurringServicePeriodInvoiceLinkage';
export {
  compareDerivedRecurringTimingToPersistedSchedule,
} from '@alga-psa/shared/billingClients/recurringServicePeriodParity';
export {
  buildRecurringServicePeriodPeriodKey,
  buildRecurringServicePeriodScheduleKey,
} from '@alga-psa/shared/billingClients/recurringServicePeriodKeys';
export {
  buildRecurringServicePeriodDueSelectionQuery,
  isRecurringServicePeriodRecordDue,
  selectDueRecurringServicePeriodRecords,
} from '@alga-psa/shared/billingClients/recurringServicePeriodDueSelection';
export type {
  BackfillRecurringServicePeriodsInput,
  IRecurringServicePeriodBackfillPlan,
} from '@alga-psa/shared/billingClients/backfillRecurringServicePeriods';
export type {
  EditRecurringServicePeriodBoundariesInput,
  IRecurringServicePeriodBoundaryEditResult,
} from '@alga-psa/shared/billingClients/editRecurringServicePeriodBoundaries';
export type {
  IRecurringServicePeriodDispositionEditResult,
  SkipOrDeferRecurringServicePeriodInput,
} from '@alga-psa/shared/billingClients/skipOrDeferRecurringServicePeriod';
export type {
  SupportedRecurringServicePeriodEditOperation,
  UnsupportedRecurringServicePeriodV1EditOperation,
} from '@alga-psa/shared/billingClients/recurringServicePeriodEditCapabilities';
export type {
  ApplyRecurringServicePeriodEditRequestInput,
} from '@alga-psa/shared/billingClients/recurringServicePeriodEditRequests';
export type {
  IRecurringServicePeriodEditContinuityValidation,
} from '@alga-psa/shared/billingClients/recurringServicePeriodEditValidation';
export type {
  IRecurringServicePeriodDisplayState,
  IRecurringServicePeriodGovernanceRequirement,
  IRecurringServicePeriodAuthorityBoundary,
  IRecurringServicePeriodRegenerationDecision,
  IRecurringServicePeriodRegenerationTriggerInput,
  RecurringServicePeriodAuditEvent,
  RecurringServicePeriodAuthorityChangeChannel,
  RecurringServicePeriodAuthorityFutureEffect,
  RecurringServicePeriodAuthorityLayer,
  RecurringServicePeriodAuthoritySubject,
  RecurringServicePeriodGovernanceAction,
  RecurringServicePeriodPermissionKey,
  RecurringServicePeriodDisplayTone,
  RecurringServicePeriodRegenerationScope,
  RecurringServicePeriodRegenerationTriggerKind,
  RecurringServicePeriodRegenerationTriggerSource,
} from '@alga-psa/types';
export type {
  IRecurringServicePeriodEditFailure,
  IRecurringServicePeriodEditRequest,
  IRecurringServicePeriodEditRequestContext,
  IRecurringServicePeriodEditResponse,
  IRecurringServicePeriodEditSuccess,
  IRecurringServicePeriodEditValidationIssue,
  IRecurringServicePeriodListingQuery,
  RecurringServicePeriodEditRequestOperation,
  RecurringServicePeriodEditValidationField,
  RecurringServicePeriodEditValidationIssueCode,
  RecurringServicePeriodListingState,
} from '@alga-psa/types';
export type {
  IRecurringServicePeriodRegenerationConflict,
  IRecurringServicePeriodRegenerationPlan,
  RecurringServicePeriodRegenerationConflictKind,
  RegenerateRecurringServicePeriodsInput,
} from '@alga-psa/shared/billingClients/regenerateRecurringServicePeriods';
export {
  evaluateRecurringServicePeriodMutationPermission,
  RECURRING_SERVICE_PERIOD_MUTATION_OPERATIONS,
} from '@alga-psa/shared/billingClients/recurringServicePeriodMutations';
export type {
  IRecurringServicePeriodMutationDecision,
  RecurringServicePeriodMutationOperation,
} from '@alga-psa/shared/billingClients/recurringServicePeriodMutations';
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
