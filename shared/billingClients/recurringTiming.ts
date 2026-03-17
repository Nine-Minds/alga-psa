import { Temporal } from '@js-temporal/polyfill';
import type {
  CadenceOwner,
  DuePosition,
  ICadenceBoundaryGenerator,
  IRecurringActivityWindow,
  IRecurringCoverage,
  IRecurringDateRange,
  IRecurringInvoiceDetailTiming,
  IRecurringInvoiceWindow,
  IRecurringServicePeriod,
} from '@alga-psa/types';
import { RECURRING_RANGE_SEMANTICS } from '@alga-psa/types';

export const DEFAULT_CADENCE_OWNER: CadenceOwner = 'client';

const toPlainDate = (value: string) => Temporal.PlainDate.from(value.slice(0, 10));

export function assertHalfOpenDateRange(range: Pick<IRecurringDateRange, 'start' | 'end'>): void {
  if (Temporal.PlainDate.compare(toPlainDate(range.end), toPlainDate(range.start)) <= 0) {
    throw new Error('Recurring timing ranges must use [start, end) semantics with end after start.');
  }
}

export function resolveCadenceOwner(owner?: CadenceOwner | null): CadenceOwner {
  return owner ?? DEFAULT_CADENCE_OWNER;
}

export function selectCadenceBoundaryGenerator(
  generators: Record<CadenceOwner, ICadenceBoundaryGenerator>,
  owner?: CadenceOwner | null
): ICadenceBoundaryGenerator {
  return generators[resolveCadenceOwner(owner)];
}

export function intersectActivityWindow(
  servicePeriod: IRecurringServicePeriod,
  activityWindow: IRecurringActivityWindow
): IRecurringServicePeriod | null {
  assertHalfOpenDateRange(servicePeriod);

  const nextStart = activityWindow.start && activityWindow.start > servicePeriod.start ? activityWindow.start : servicePeriod.start;
  const nextEnd = activityWindow.end && activityWindow.end < servicePeriod.end ? activityWindow.end : servicePeriod.end;

  if (Temporal.PlainDate.compare(toPlainDate(nextEnd), toPlainDate(nextStart)) <= 0) {
    return null;
  }

  return {
    ...servicePeriod,
    start: nextStart,
    end: nextEnd,
  };
}

export function calculateServicePeriodCoverage(
  servicePeriod: IRecurringServicePeriod,
  coveredPeriod: Pick<IRecurringDateRange, 'start' | 'end'>
): IRecurringCoverage {
  assertHalfOpenDateRange(servicePeriod);
  assertHalfOpenDateRange(coveredPeriod);

  const totalDays = toPlainDate(servicePeriod.end).since(toPlainDate(servicePeriod.start)).days;
  const coveredDays = toPlainDate(coveredPeriod.end).since(toPlainDate(coveredPeriod.start)).days;

  if (coveredDays > totalDays) {
    throw new Error('Covered period cannot exceed its parent service period.');
  }

  return {
    coveredPeriod: {
      start: coveredPeriod.start,
      end: coveredPeriod.end,
      semantics: RECURRING_RANGE_SEMANTICS,
    },
    coveredDays,
    totalDays,
    coverageRatio: coveredDays / totalDays,
  };
}

export function mapServicePeriodToInvoiceWindow(
  servicePeriod: IRecurringServicePeriod,
  options: {
    duePosition: DuePosition;
    currentInvoiceWindow: IRecurringInvoiceWindow;
    nextInvoiceWindow?: IRecurringInvoiceWindow;
  }
): { servicePeriod: IRecurringServicePeriod; invoiceWindow: IRecurringInvoiceWindow } {
  return {
    servicePeriod,
    invoiceWindow: options.duePosition === 'arrears'
      ? (options.nextInvoiceWindow ?? options.currentInvoiceWindow)
      : options.currentInvoiceWindow,
  };
}

export function buildRecurringInvoiceDetailTiming(input: {
  servicePeriod: IRecurringServicePeriod;
  invoiceWindow: IRecurringInvoiceWindow;
}): IRecurringInvoiceDetailTiming {
  return {
    cadenceOwner: input.servicePeriod.cadenceOwner,
    duePosition: input.servicePeriod.duePosition,
    sourceObligation: input.servicePeriod.sourceObligation,
    servicePeriodStart: input.servicePeriod.start,
    servicePeriodEnd: input.servicePeriod.end,
    invoiceWindowStart: input.invoiceWindow.start,
    invoiceWindowEnd: input.invoiceWindow.end,
  };
}
