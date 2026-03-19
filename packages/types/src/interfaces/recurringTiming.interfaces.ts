import type { ISO8601String } from '../lib/temporal';

export const CADENCE_OWNERS = ['client', 'contract'] as const;
export type CadenceOwner = (typeof CADENCE_OWNERS)[number];

export const RECURRING_RUN_EXECUTION_WINDOW_KINDS = [
  'client_cadence_window',
  'billing_cycle_window',
  'contract_cadence_window',
] as const;
export type RecurringRunExecutionWindowKind =
  (typeof RECURRING_RUN_EXECUTION_WINDOW_KINDS)[number];

export const DUE_POSITIONS = ['advance', 'arrears'] as const;
export type DuePosition = (typeof DUE_POSITIONS)[number];

export const RECURRING_RANGE_SEMANTICS = 'half_open' as const;
export type RecurringRangeSemantics = typeof RECURRING_RANGE_SEMANTICS;

export type RecurringChargeFamily =
  | 'fixed'
  | 'product'
  | 'license'
  | 'bucket'
  | 'hourly'
  | 'usage';
export type RecurringObligationType = 'contract_line' | 'client_contract_line' | 'template_line' | 'preset_line';
export type RecurringTimingMetadataValue = string | number | boolean | null;
export type RecurringTimingMetadata = Record<string, RecurringTimingMetadataValue>;

export const RECURRING_SERVICE_PERIOD_LIFECYCLE_STATES = [
  'generated',
  'edited',
  'skipped',
  'locked',
  'billed',
  'superseded',
  'archived',
] as const;
export type RecurringServicePeriodLifecycleState =
  (typeof RECURRING_SERVICE_PERIOD_LIFECYCLE_STATES)[number];

export const DEFAULT_RECURRING_SERVICE_PERIOD_DUE_SELECTION_STATES = [
  'generated',
  'edited',
  'locked',
] as const satisfies readonly RecurringServicePeriodLifecycleState[];
export type RecurringServicePeriodDueSelectionState =
  (typeof DEFAULT_RECURRING_SERVICE_PERIOD_DUE_SELECTION_STATES)[number];

export const DEFAULT_RECURRING_SERVICE_PERIOD_LISTING_STATES = [
  'generated',
  'edited',
  'skipped',
  'locked',
] as const satisfies readonly RecurringServicePeriodLifecycleState[];
export type RecurringServicePeriodListingState =
  (typeof DEFAULT_RECURRING_SERVICE_PERIOD_LISTING_STATES)[number];

export const RECURRING_SERVICE_PERIOD_EDIT_REQUEST_OPERATIONS = [
  'boundary_adjustment',
  'skip',
  'defer',
] as const;
export type RecurringServicePeriodEditRequestOperation =
  (typeof RECURRING_SERVICE_PERIOD_EDIT_REQUEST_OPERATIONS)[number];

export const RECURRING_SERVICE_PERIOD_EDIT_VALIDATION_ISSUE_CODES = [
  'record_mismatch',
  'immutable_record',
  'no_changes',
  'invalid_service_period_range',
  'invalid_invoice_window_range',
  'invalid_activity_window_range',
  'missing_deferred_invoice_window',
  'invalid_deferred_invoice_window',
  'unchanged_deferred_invoice_window',
  'continuity_gap_before',
  'continuity_overlap_before',
  'continuity_gap_after',
  'continuity_overlap_after',
  'unknown_validation_error',
] as const;
export type RecurringServicePeriodEditValidationIssueCode =
  (typeof RECURRING_SERVICE_PERIOD_EDIT_VALIDATION_ISSUE_CODES)[number];
export type RecurringServicePeriodEditValidationField =
  | 'recordId'
  | 'servicePeriod'
  | 'invoiceWindow'
  | 'activityWindow'
  | 'deferredInvoiceWindow'
  | 'operation';

export const RECURRING_SERVICE_PERIOD_DISPLAY_TONES = [
  'neutral',
  'accent',
  'warning',
  'success',
  'muted',
] as const;
export type RecurringServicePeriodDisplayTone =
  (typeof RECURRING_SERVICE_PERIOD_DISPLAY_TONES)[number];

export const RECURRING_SERVICE_PERIOD_GOVERNANCE_ACTIONS = [
  'view',
  'edit_boundaries',
  'skip',
  'defer',
  'regenerate',
  'invoice_linkage_repair',
  'archive',
] as const;
export type RecurringServicePeriodGovernanceAction =
  (typeof RECURRING_SERVICE_PERIOD_GOVERNANCE_ACTIONS)[number];

export const RECURRING_SERVICE_PERIOD_PERMISSION_KEYS = [
  'billing.recurring_service_periods.view',
  'billing.recurring_service_periods.manage_future',
  'billing.recurring_service_periods.regenerate',
  'billing.recurring_service_periods.correct_history',
] as const;
export type RecurringServicePeriodPermissionKey =
  (typeof RECURRING_SERVICE_PERIOD_PERMISSION_KEYS)[number];

export const RECURRING_SERVICE_PERIOD_AUDIT_EVENTS = [
  'recurring_service_period.viewed',
  'recurring_service_period.boundary_adjusted',
  'recurring_service_period.skipped',
  'recurring_service_period.deferred',
  'recurring_service_period.regenerated',
  'recurring_service_period.invoice_linkage_repaired',
  'recurring_service_period.archived',
] as const;
export type RecurringServicePeriodAuditEvent =
  (typeof RECURRING_SERVICE_PERIOD_AUDIT_EVENTS)[number];

export const RECURRING_SERVICE_PERIOD_REGENERATION_TRIGGER_SOURCES = [
  'contract_line_edit',
  'contract_assignment_edit',
  'billing_schedule_edit',
] as const;
export type RecurringServicePeriodRegenerationTriggerSource =
  (typeof RECURRING_SERVICE_PERIOD_REGENERATION_TRIGGER_SOURCES)[number];

export const RECURRING_SERVICE_PERIOD_REGENERATION_TRIGGER_KINDS = [
  'contract_line_edit',
  'contract_assignment_edit',
  'cadence_owner_change',
  'billing_schedule_change',
] as const;
export type RecurringServicePeriodRegenerationTriggerKind =
  (typeof RECURRING_SERVICE_PERIOD_REGENERATION_TRIGGER_KINDS)[number];

export const RECURRING_SERVICE_PERIOD_REGENERATION_SCOPES = [
  'obligation_schedule_only',
  'replace_schedule_identity',
  'client_cadence_dependents',
] as const;
export type RecurringServicePeriodRegenerationScope =
  (typeof RECURRING_SERVICE_PERIOD_REGENERATION_SCOPES)[number];

export const RECURRING_SERVICE_PERIOD_AUTHORITY_LAYERS = [
  'source_rule',
  'materialized_override',
  'ledger_state',
] as const;
export type RecurringServicePeriodAuthorityLayer =
  (typeof RECURRING_SERVICE_PERIOD_AUTHORITY_LAYERS)[number];

export const RECURRING_SERVICE_PERIOD_AUTHORITY_CHANGE_CHANNELS = [
  'edit_source_rule',
  'edit_materialized_period',
  'corrective_flow',
] as const;
export type RecurringServicePeriodAuthorityChangeChannel =
  (typeof RECURRING_SERVICE_PERIOD_AUTHORITY_CHANGE_CHANNELS)[number];

export const RECURRING_SERVICE_PERIOD_AUTHORITY_FUTURE_EFFECTS = [
  'regenerate_unedited_future',
  'supersede_current_revision',
  'corrective_only',
] as const;
export type RecurringServicePeriodAuthorityFutureEffect =
  (typeof RECURRING_SERVICE_PERIOD_AUTHORITY_FUTURE_EFFECTS)[number];

export const RECURRING_SERVICE_PERIOD_AUTHORITY_SUBJECTS = [
  'cadence_owner',
  'billing_frequency',
  'due_position',
  'activity_window',
  'service_period_boundary',
  'invoice_window_boundary',
  'skip_disposition',
  'defer_disposition',
  'lifecycle_state',
  'invoice_linkage',
  'provenance',
] as const;
export type RecurringServicePeriodAuthoritySubject =
  (typeof RECURRING_SERVICE_PERIOD_AUTHORITY_SUBJECTS)[number];

export const DEFAULT_RECURRING_SERVICE_PERIOD_PARITY_COMPARISON_STATES = [
  'generated',
  'edited',
  'locked',
  'billed',
] as const satisfies readonly RecurringServicePeriodLifecycleState[];
export type RecurringServicePeriodParityComparisonState =
  (typeof DEFAULT_RECURRING_SERVICE_PERIOD_PARITY_COMPARISON_STATES)[number];
export type RecurringServicePeriodParityDriftKind =
  | 'missing_persisted_period'
  | 'unexpected_persisted_period'
  | 'invoice_window_mismatch';

export const RECURRING_SERVICE_PERIOD_PROVENANCE_KINDS = [
  'generated',
  'user_edited',
  'regenerated',
  'repair',
] as const;
export type RecurringServicePeriodProvenanceKind =
  (typeof RECURRING_SERVICE_PERIOD_PROVENANCE_KINDS)[number];

export const RECURRING_SERVICE_PERIOD_PROVENANCE_REASON_CODES = {
  generated: [
    'initial_materialization',
    'backfill_materialization',
  ],
  user_edited: [
    'boundary_adjustment',
    'invoice_window_adjustment',
    'activity_window_adjustment',
    'skip',
    'defer',
  ],
  regenerated: [
    'source_rule_changed',
    'billing_schedule_changed',
    'cadence_owner_changed',
    'activity_window_changed',
    'backfill_realignment',
  ],
  repair: [
    'integrity_repair',
    'invoice_linkage_repair',
    'admin_correction',
  ],
} as const satisfies Record<RecurringServicePeriodProvenanceKind, readonly string[]>;

export type GeneratedRecurringServicePeriodReasonCode =
  (typeof RECURRING_SERVICE_PERIOD_PROVENANCE_REASON_CODES.generated)[number];
export type UserEditedRecurringServicePeriodReasonCode =
  (typeof RECURRING_SERVICE_PERIOD_PROVENANCE_REASON_CODES.user_edited)[number];
export type RegeneratedRecurringServicePeriodReasonCode =
  (typeof RECURRING_SERVICE_PERIOD_PROVENANCE_REASON_CODES.regenerated)[number];
export type RepairRecurringServicePeriodReasonCode =
  (typeof RECURRING_SERVICE_PERIOD_PROVENANCE_REASON_CODES.repair)[number];
export type RecurringServicePeriodProvenanceReasonCode =
  | GeneratedRecurringServicePeriodReasonCode
  | UserEditedRecurringServicePeriodReasonCode
  | RegeneratedRecurringServicePeriodReasonCode
  | RepairRecurringServicePeriodReasonCode;

export interface IRecurringObligationRef {
  tenant?: string;
  obligationId: string;
  obligationType: RecurringObligationType;
  chargeFamily: RecurringChargeFamily;
}

export interface IRecurringDateRange {
  start: ISO8601String;
  end: ISO8601String;
  semantics: RecurringRangeSemantics;
}

export interface IRecurringActivityWindow extends Partial<IRecurringDateRange> {
  semantics: RecurringRangeSemantics;
}

export interface IRecurringServicePeriod extends IRecurringDateRange {
  kind: 'service_period';
  cadenceOwner: CadenceOwner;
  duePosition: DuePosition;
  sourceObligation: IRecurringObligationRef;
  timingMetadata?: RecurringTimingMetadata;
}

export interface IRecurringInvoiceWindow extends IRecurringDateRange {
  kind: 'invoice_window';
  cadenceOwner: CadenceOwner;
  duePosition: DuePosition;
  windowId?: string;
  billingCycleId?: string | null;
}

export interface IRecurringCoverage {
  coveredPeriod: IRecurringDateRange;
  coveredDays: number;
  totalDays: number;
  coverageRatio: number;
}

export interface IRecurringDuePeriodSelection {
  servicePeriod: IRecurringServicePeriod;
  invoiceWindow: IRecurringInvoiceWindow;
}

export interface IRecurringInvoiceCandidateGroup {
  groupKey: string;
  windowStart: ISO8601String;
  windowEnd: ISO8601String;
  semantics: RecurringRangeSemantics;
  cadenceOwners: CadenceOwner[];
  dueSelections: IRecurringDuePeriodSelection[];
}

export interface IRecurringScopedDuePeriodSelection extends IRecurringDuePeriodSelection {
  clientContractId?: string | null;
  purchaseOrderScopeKey?: string | null;
  currencyCode?: string | null;
  taxSource?: string | null;
  exportShapeKey?: string | null;
}

export type RecurringInvoiceSplitReason =
  | 'single_contract'
  | 'purchase_order_scope'
  | 'financial_constraint';

export interface IRecurringScopedInvoiceCandidateGroup extends IRecurringInvoiceCandidateGroup {
  clientContractId?: string | null;
  purchaseOrderScopeKey?: string | null;
  currencyCode?: string | null;
  taxSource?: string | null;
  exportShapeKey?: string | null;
  splitReasons: RecurringInvoiceSplitReason[];
  dueSelections: IRecurringScopedDuePeriodSelection[];
}

export interface IResolvedRecurringSettlement {
  servicePeriod: IRecurringServicePeriod;
  coveredServicePeriod: IRecurringServicePeriod;
  invoiceWindow: IRecurringInvoiceWindow;
  coverage: IRecurringCoverage;
}

export interface IRecurringInvoiceDetailTiming {
  cadenceOwner: CadenceOwner;
  duePosition: DuePosition;
  sourceObligation: IRecurringObligationRef;
  servicePeriodStart: ISO8601String;
  servicePeriodEnd: ISO8601String;
  invoiceWindowStart: ISO8601String;
  invoiceWindowEnd: ISO8601String;
}

export interface IRecurringRunExecutionWindowIdentity {
  kind: RecurringRunExecutionWindowKind;
  identityKey: string;
  cadenceOwner: CadenceOwner;
  clientId?: string;
  billingCycleId?: string | null;
  scheduleKey?: string | null;
  periodKey?: string | null;
  contractId?: string | null;
  contractLineId?: string | null;
  windowStart?: ISO8601String | null;
  windowEnd?: ISO8601String | null;
}

export type RecurringDueWorkCadenceSource = 'client_schedule' | 'contract_anniversary';

export type RecurringDueWorkState = 'due' | 'early';

export interface IPersistedRecurringObligationRef extends IRecurringObligationRef {
  tenant: string;
}

interface IRecurringServicePeriodRecordProvenanceBase<
  TKind extends RecurringServicePeriodProvenanceKind,
  TReasonCode extends RecurringServicePeriodProvenanceReasonCode,
> {
  kind: TKind;
  sourceRuleVersion: string;
  reasonCode: TReasonCode;
}

export interface IGeneratedRecurringServicePeriodRecordProvenance
  extends IRecurringServicePeriodRecordProvenanceBase<
    'generated',
    GeneratedRecurringServicePeriodReasonCode
  > {
  sourceRunKey: string;
  supersedesRecordId?: null;
}

export interface IUserEditedRecurringServicePeriodRecordProvenance
  extends IRecurringServicePeriodRecordProvenanceBase<
    'user_edited',
    UserEditedRecurringServicePeriodReasonCode
  > {
  sourceRunKey?: string | null;
  supersedesRecordId: string;
}

export interface IRegeneratedRecurringServicePeriodRecordProvenance
  extends IRecurringServicePeriodRecordProvenanceBase<
    'regenerated',
    RegeneratedRecurringServicePeriodReasonCode
  > {
  sourceRunKey: string;
  supersedesRecordId: string;
}

export interface IRepairRecurringServicePeriodRecordProvenance
  extends IRecurringServicePeriodRecordProvenanceBase<
    'repair',
    RepairRecurringServicePeriodReasonCode
  > {
  sourceRunKey?: string | null;
  supersedesRecordId?: string | null;
}

export type IRecurringServicePeriodRecordProvenance =
  | IGeneratedRecurringServicePeriodRecordProvenance
  | IUserEditedRecurringServicePeriodRecordProvenance
  | IRegeneratedRecurringServicePeriodRecordProvenance
  | IRepairRecurringServicePeriodRecordProvenance;

export interface IRecurringServicePeriodInvoiceLinkage {
  invoiceId: string;
  invoiceChargeId: string;
  invoiceChargeDetailId: string;
  linkedAt: ISO8601String;
}

export interface IRecurringServicePeriodRecord {
  kind: 'persisted_service_period_record';
  recordId: string;
  scheduleKey: string;
  periodKey: string;
  revision: number;
  sourceObligation: IPersistedRecurringObligationRef;
  cadenceOwner: CadenceOwner;
  duePosition: DuePosition;
  lifecycleState: RecurringServicePeriodLifecycleState;
  servicePeriod: IRecurringDateRange;
  invoiceWindow: IRecurringDateRange;
  activityWindow?: IRecurringActivityWindow | null;
  timingMetadata?: RecurringTimingMetadata;
  provenance: IRecurringServicePeriodRecordProvenance;
  invoiceLinkage?: IRecurringServicePeriodInvoiceLinkage | null;
  createdAt: ISO8601String;
  updatedAt: ISO8601String;
}

export interface IRecurringServicePeriodEditSuccess {
  ok: true;
  operation: RecurringServicePeriodEditRequestOperation;
  recordId: string;
  supersededRecord: IRecurringServicePeriodRecord;
  editedRecord: IRecurringServicePeriodRecord;
  provenance: IRecurringServicePeriodRecordProvenance;
  validationIssues: [];
}

export interface IRecurringServicePeriodEditFailure {
  ok: false;
  operation: RecurringServicePeriodEditRequestOperation;
  recordId: string;
  validationIssues: IRecurringServicePeriodEditValidationIssue[];
}

export type IRecurringServicePeriodEditResponse =
  | IRecurringServicePeriodEditSuccess
  | IRecurringServicePeriodEditFailure;

export interface IRecurringDueSelectionInput {
  clientId: string;
  windowStart: ISO8601String;
  windowEnd: ISO8601String;
  billingCycleId?: string | null;
  executionWindow: IRecurringRunExecutionWindowIdentity;
}

export interface IRecurringDueWorkRow {
  rowKey: string;
  executionIdentityKey: string;
  selectionKey: string;
  retryKey: string;
  selectorInput: IRecurringDueSelectionInput;
  executionWindow: IRecurringRunExecutionWindowIdentity;
  executionWindowKind: RecurringRunExecutionWindowKind;
  cadenceOwner: CadenceOwner;
  cadenceSource: RecurringDueWorkCadenceSource;
  dueState: RecurringDueWorkState;
  isEarly: boolean;
  canGenerate: boolean;
  clientId: string;
  clientName?: string | null;
  billingCycleId?: string | null;
  hasBillingCycleBridge: boolean;
  servicePeriodStart: ISO8601String;
  servicePeriodEnd: ISO8601String;
  servicePeriodLabel: string;
  invoiceWindowStart: ISO8601String;
  invoiceWindowEnd: ISO8601String;
  invoiceWindowLabel: string;
  scheduleKey?: string | null;
  periodKey?: string | null;
  recordId?: string | null;
  lifecycleState?: RecurringServicePeriodLifecycleState | null;
  contractId?: string | null;
  contractLineId?: string | null;
  contractName?: string | null;
  contractLineName?: string | null;
}

export interface IRecurringServicePeriodDueSelectionQuery {
  tenant: string;
  cadenceOwner: CadenceOwner;
  executionWindow: IRecurringRunExecutionWindowIdentity;
  scheduleKeys: string[];
  windowStart: ISO8601String;
  windowEnd: ISO8601String;
  lifecycleStates: RecurringServicePeriodDueSelectionState[];
  chargeFamilies?: RecurringChargeFamily[];
}

export interface IRecurringServicePeriodListingQuery {
  tenant: string;
  asOf: ISO8601String;
  scheduleKeys?: string[];
  cadenceOwner?: CadenceOwner;
  duePosition?: DuePosition;
  lifecycleStates: RecurringServicePeriodListingState[];
  chargeFamilies?: RecurringChargeFamily[];
}

export interface IRecurringServicePeriodEditRequestContext {
  editedAt: ISO8601String;
  sourceRuleVersion: string;
  sourceRunKey?: string | null;
}

export interface IBoundaryAdjustmentRecurringServicePeriodEditRequest {
  operation: 'boundary_adjustment';
  recordId: string;
  updatedServicePeriod?: IRecurringDateRange;
  updatedInvoiceWindow?: IRecurringDateRange;
  updatedActivityWindow?: IRecurringActivityWindow | null;
}

export interface ISkipRecurringServicePeriodEditRequest {
  operation: 'skip';
  recordId: string;
}

export interface IDeferRecurringServicePeriodEditRequest {
  operation: 'defer';
  recordId: string;
  deferredInvoiceWindow?: IRecurringDateRange;
}

export type IRecurringServicePeriodEditRequest =
  | IBoundaryAdjustmentRecurringServicePeriodEditRequest
  | ISkipRecurringServicePeriodEditRequest
  | IDeferRecurringServicePeriodEditRequest;

export interface IRecurringServicePeriodEditValidationIssue {
  code: RecurringServicePeriodEditValidationIssueCode;
  field: RecurringServicePeriodEditValidationField;
  message: string;
}

export interface IRecurringServicePeriodDisplayState {
  lifecycleState: RecurringServicePeriodLifecycleState;
  label: string;
  tone: RecurringServicePeriodDisplayTone;
  detail: string;
  reasonLabel?: string | null;
}

export interface IRecurringServicePeriodOperationalViewRow {
  recordId: string;
  scheduleKey: string;
  revision: number;
  cadenceOwner: CadenceOwner;
  duePosition: DuePosition;
  sourceObligation: IRecurringServicePeriodRecord['sourceObligation'];
  chargeFamily: IRecurringServicePeriodRecord['sourceObligation']['chargeFamily'];
  servicePeriod: IRecurringServicePeriodRecord['servicePeriod'];
  invoiceWindow: IRecurringServicePeriodRecord['invoiceWindow'];
  activityWindow: IRecurringServicePeriodRecord['activityWindow'];
  displayState: IRecurringServicePeriodDisplayState;
  isException: boolean;
}

export interface IRecurringServicePeriodOperationalViewSummary {
  totalRows: number;
  exceptionRows: number;
  generatedRows: number;
  editedRows: number;
  skippedRows: number;
  lockedRows: number;
}

export interface IRecurringServicePeriodOperationalView {
  query: IRecurringServicePeriodListingQuery;
  summary: IRecurringServicePeriodOperationalViewSummary;
  rows: IRecurringServicePeriodOperationalViewRow[];
}

export interface IRecurringServicePeriodGovernanceRequirement {
  action: RecurringServicePeriodGovernanceAction;
  permissionKey: RecurringServicePeriodPermissionKey;
  auditEvent: RecurringServicePeriodAuditEvent;
  auditRequired: boolean;
  allowed: boolean;
  reason: string;
}

export interface IRecurringServicePeriodRegenerationTriggerInput {
  source: RecurringServicePeriodRegenerationTriggerSource;
  changedFields: string[];
  cadenceOwnerBefore?: CadenceOwner;
  cadenceOwnerAfter?: CadenceOwner;
}

export interface IRecurringServicePeriodRegenerationDecision {
  shouldRegenerate: boolean;
  triggerKind: RecurringServicePeriodRegenerationTriggerKind | null;
  regenerationReasonCode: RegeneratedRecurringServicePeriodReasonCode | null;
  scope: RecurringServicePeriodRegenerationScope | null;
  changedFields: string[];
  affectedCadenceOwners: CadenceOwner[];
  preserveEditedRows: boolean;
  preserveBilledHistory: boolean;
  reason: string;
  notes: string[];
}

export interface IRecurringServicePeriodAuthorityBoundary {
  subject: RecurringServicePeriodAuthoritySubject;
  authorityLayer: RecurringServicePeriodAuthorityLayer;
  changeChannel: RecurringServicePeriodAuthorityChangeChannel;
  futureEffect: RecurringServicePeriodAuthorityFutureEffect;
  reason: string;
}

export interface IRecurringServicePeriodParityDrift {
  kind: RecurringServicePeriodParityDriftKind;
  scheduleKey: string;
  periodKey: string;
  obligationId: string;
  cadenceOwner: CadenceOwner;
  duePosition: DuePosition;
  servicePeriodStart: ISO8601String;
  servicePeriodEnd: ISO8601String;
  derivedInvoiceWindowStart?: ISO8601String;
  derivedInvoiceWindowEnd?: ISO8601String;
  persistedInvoiceWindowStart?: ISO8601String;
  persistedInvoiceWindowEnd?: ISO8601String;
  persistedLifecycleState?: RecurringServicePeriodLifecycleState;
}

export interface IRecurringServicePeriodParityComparisonResult {
  matches: boolean;
  drifts: IRecurringServicePeriodParityDrift[];
}

export interface ICadenceBoundaryGeneratorInput {
  cadenceOwner: CadenceOwner;
  duePosition: DuePosition;
  rangeStart: ISO8601String;
  rangeEnd: ISO8601String;
  sourceObligation: IRecurringObligationRef;
  anchorDate?: ISO8601String | null;
}

export interface ICadenceBoundaryGenerator {
  owner: CadenceOwner;
  generate(input: ICadenceBoundaryGeneratorInput): IRecurringServicePeriod[];
}
