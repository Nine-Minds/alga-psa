import type { ISO8601String } from '../lib/temporal';

export const CADENCE_OWNERS = ['client', 'contract'] as const;
export type CadenceOwner = (typeof CADENCE_OWNERS)[number];

export const DUE_POSITIONS = ['advance', 'arrears'] as const;
export type DuePosition = (typeof DUE_POSITIONS)[number];

export const RECURRING_RANGE_SEMANTICS = 'half_open' as const;
export type RecurringRangeSemantics = typeof RECURRING_RANGE_SEMANTICS;

export type RecurringChargeFamily = 'fixed' | 'product' | 'license' | 'bucket';
export type RecurringObligationType = 'contract_line' | 'client_contract_line' | 'template_line' | 'preset_line';

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
  timingMetadata?: Record<string, string | number | boolean | null>;
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
