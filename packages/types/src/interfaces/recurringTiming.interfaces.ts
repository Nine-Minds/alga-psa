import type { ISO8601String } from '../lib/temporal';

export const CADENCE_OWNERS = ['client', 'contract'] as const;
export type CadenceOwner = (typeof CADENCE_OWNERS)[number];

export const RECURRING_RUN_EXECUTION_WINDOW_KINDS = [
  'billing_cycle_window',
  'contract_cadence_window',
] as const;
export type RecurringRunExecutionWindowKind =
  (typeof RECURRING_RUN_EXECUTION_WINDOW_KINDS)[number];

export const DUE_POSITIONS = ['advance', 'arrears'] as const;
export type DuePosition = (typeof DUE_POSITIONS)[number];

export const RECURRING_RANGE_SEMANTICS = 'half_open' as const;
export type RecurringRangeSemantics = typeof RECURRING_RANGE_SEMANTICS;

export type RecurringChargeFamily = 'fixed' | 'product' | 'license' | 'bucket';
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
  contractId?: string | null;
  contractLineId?: string | null;
  windowStart?: ISO8601String | null;
  windowEnd?: ISO8601String | null;
}

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

export interface IRecurringDueSelectionInput {
  clientId: string;
  windowStart: ISO8601String;
  windowEnd: ISO8601String;
  billingCycleId?: string | null;
  executionWindow: IRecurringRunExecutionWindowIdentity;
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
