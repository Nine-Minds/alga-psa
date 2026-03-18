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

export const RECURRING_SERVICE_PERIOD_PROVENANCE_KINDS = [
  'generated',
  'user_edited',
  'regenerated',
  'repair',
] as const;
export type RecurringServicePeriodProvenanceKind =
  (typeof RECURRING_SERVICE_PERIOD_PROVENANCE_KINDS)[number];

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

export interface IRecurringServicePeriodRecordProvenance {
  kind: RecurringServicePeriodProvenanceKind;
  sourceRuleVersion: string;
  reasonCode?: string | null;
  sourceRunKey?: string | null;
  supersedesRecordId?: string | null;
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
