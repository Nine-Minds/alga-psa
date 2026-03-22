import { Temporal } from '@js-temporal/polyfill';
import type {
  DuePosition,
  ICadenceBoundaryGenerator,
  IRecurringInvoiceWindow,
  IRecurringObligationRef,
  IRecurringServicePeriod,
  ISO8601String,
} from '@alga-psa/types';
import { RECURRING_RANGE_SEMANTICS } from '@alga-psa/types';
import { ensureUtcMidnightIsoDate } from './billingCycleAnchors';

export const CONTRACT_CADENCE_LIFECYCLE_MODES = [
  'new_assignment',
  'renew_in_place',
  'renewed_contract',
] as const;

export type ContractCadenceLifecycleMode = (typeof CONTRACT_CADENCE_LIFECYCLE_MODES)[number];

export interface ContractCadenceServicePeriodGenerationInput {
  rangeStart: ISO8601String;
  rangeEnd: ISO8601String;
  sourceObligation: IRecurringObligationRef;
  duePosition: DuePosition;
  anchorDate: ISO8601String;
}

export interface ResolveContractCadenceAnchorDateInput {
  assignmentStartDate: ISO8601String;
  lifecycleMode?: ContractCadenceLifecycleMode;
  previousAnchorDate?: ISO8601String | null;
}

export interface ResolveContractCadenceInvoiceWindowForServicePeriodInput {
  servicePeriod: IRecurringServicePeriod;
  anchorDate: ISO8601String;
  monthsPerPeriod: number;
  windowId?: string;
}

const toPlainDate = (value: ISO8601String) => Temporal.PlainDate.from(value.slice(0, 10));

const compareIsoDates = (left: ISO8601String, right: ISO8601String) =>
  Temporal.PlainDate.compare(toPlainDate(left), toPlainDate(right));

function toUtcMidnightIsoDate(date: Temporal.PlainDate): ISO8601String {
  return `${date.toString()}T00:00:00Z` as ISO8601String;
}

export function resolveContractCadenceAnchorDate(
  input: ResolveContractCadenceAnchorDateInput,
): ISO8601String {
  const assignmentStartDate = ensureUtcMidnightIsoDate(input.assignmentStartDate);

  if (input.lifecycleMode === 'renew_in_place' && input.previousAnchorDate) {
    return ensureUtcMidnightIsoDate(input.previousAnchorDate);
  }

  return assignmentStartDate;
}

export function resolveContractCadenceInvoiceWindowForServicePeriod(
  input: ResolveContractCadenceInvoiceWindowForServicePeriodInput,
): IRecurringInvoiceWindow {
  if (input.servicePeriod.cadenceOwner !== 'contract') {
    throw new Error('Contract cadence invoice windows require a contract-owned service period.');
  }

  if (input.monthsPerPeriod <= 0) {
    throw new Error('Contract cadence invoice windows require a positive monthsPerPeriod.');
  }

  const anchorDate = ensureUtcMidnightIsoDate(input.anchorDate);

  if (input.servicePeriod.duePosition === 'advance') {
    return {
      kind: 'invoice_window',
      cadenceOwner: 'contract',
      duePosition: 'advance',
      start: input.servicePeriod.start,
      end: input.servicePeriod.end,
      semantics: RECURRING_RANGE_SEMANTICS,
      windowId: input.windowId,
    };
  }

  const periodIndex = resolveBoundaryIndexAtOrBefore(
    toPlainDate(anchorDate),
    toPlainDate(input.servicePeriod.start),
    input.monthsPerPeriod,
  );
  const invoiceWindowEnd = toUtcMidnightIsoDate(
    toPlainDate(anchorDate).add({ months: (periodIndex + 2) * input.monthsPerPeriod }),
  );

  if (compareIsoDates(invoiceWindowEnd, input.servicePeriod.end) <= 0) {
    throw new Error('Contract cadence arrears invoice windows must advance beyond the service period end.');
  }

  return {
    kind: 'invoice_window',
    cadenceOwner: 'contract',
    duePosition: 'arrears',
    start: input.servicePeriod.end,
    end: invoiceWindowEnd,
    semantics: RECURRING_RANGE_SEMANTICS,
    windowId: input.windowId,
  };
}

function toServicePeriod(input: {
  start: ISO8601String;
  end: ISO8601String;
  sourceObligation: IRecurringObligationRef;
  duePosition: DuePosition;
  anchorDate: ISO8601String;
}): IRecurringServicePeriod {
  return {
    kind: 'service_period',
    cadenceOwner: 'contract',
    duePosition: input.duePosition,
    sourceObligation: input.sourceObligation,
    start: input.start,
    end: input.end,
    semantics: RECURRING_RANGE_SEMANTICS,
    timingMetadata: {
      anchorDate: input.anchorDate,
      boundarySource: 'assignment_start_date',
    },
  };
}

function resolveBoundaryIndexAtOrBefore(
  anchor: Temporal.PlainDate,
  target: Temporal.PlainDate,
  monthsPerPeriod: number,
): number {
  if (Temporal.PlainDate.compare(target, anchor) <= 0) {
    return 0;
  }

  let index = Math.floor(((target.year - anchor.year) * 12 + (target.month - anchor.month)) / monthsPerPeriod);
  let boundary = anchor.add({ months: index * monthsPerPeriod });

  while (Temporal.PlainDate.compare(boundary, target) > 0) {
    index -= 1;
    boundary = anchor.add({ months: index * monthsPerPeriod });
  }

  while (Temporal.PlainDate.compare(anchor.add({ months: (index + 1) * monthsPerPeriod }), target) <= 0) {
    index += 1;
  }

  return Math.max(index, 0);
}

function buildContractCadenceServicePeriods(
  input: ContractCadenceServicePeriodGenerationInput & { monthsPerPeriod: number },
): IRecurringServicePeriod[] {
  const rangeStart = ensureUtcMidnightIsoDate(input.rangeStart);
  const rangeEnd = ensureUtcMidnightIsoDate(input.rangeEnd);
  const anchorDate = ensureUtcMidnightIsoDate(input.anchorDate);

  if (compareIsoDates(rangeEnd, rangeStart) <= 0) {
    throw new Error('Contract cadence generation requires rangeEnd to be after rangeStart.');
  }

  if (compareIsoDates(anchorDate, rangeEnd) >= 0) {
    return [];
  }

  const anchor = toPlainDate(anchorDate);
  const rangeStartDate = toPlainDate(rangeStart);
  const rangeEndDate = toPlainDate(rangeEnd);
  const startIndex = resolveBoundaryIndexAtOrBefore(anchor, rangeStartDate, input.monthsPerPeriod);
  const periods: IRecurringServicePeriod[] = [];

  for (let index = startIndex; index < startIndex + 100; index += 1) {
    const offsetMonths = index * input.monthsPerPeriod;
    const periodStartDate = anchor.add({ months: offsetMonths });
    if (Temporal.PlainDate.compare(periodStartDate, rangeEndDate) >= 0) {
      break;
    }

    const periodEndDate = anchor.add({ months: offsetMonths + input.monthsPerPeriod });
    const periodStart = toUtcMidnightIsoDate(periodStartDate);
    const periodEnd = toUtcMidnightIsoDate(periodEndDate);

    if (compareIsoDates(periodEnd, periodStart) <= 0) {
      throw new Error('Contract cadence generation did not advance to the next service period.');
    }

    periods.push(
      toServicePeriod({
        start: periodStart,
        end: periodEnd,
        sourceObligation: input.sourceObligation,
        duePosition: input.duePosition,
        anchorDate,
      }),
    );
  }

  return periods;
}

export function generateMonthlyContractCadenceServicePeriods(
  input: ContractCadenceServicePeriodGenerationInput,
): IRecurringServicePeriod[] {
  return buildContractCadenceServicePeriods({
    ...input,
    monthsPerPeriod: 1,
  });
}

export function generateQuarterlyContractCadenceServicePeriods(
  input: ContractCadenceServicePeriodGenerationInput,
): IRecurringServicePeriod[] {
  return buildContractCadenceServicePeriods({
    ...input,
    monthsPerPeriod: 3,
  });
}

export function generateSemiAnnualContractCadenceServicePeriods(
  input: ContractCadenceServicePeriodGenerationInput,
): IRecurringServicePeriod[] {
  return buildContractCadenceServicePeriods({
    ...input,
    monthsPerPeriod: 6,
  });
}

export function generateAnnualContractCadenceServicePeriods(
  input: ContractCadenceServicePeriodGenerationInput,
): IRecurringServicePeriod[] {
  return buildContractCadenceServicePeriods({
    ...input,
    monthsPerPeriod: 12,
  });
}

export const contractCadenceMonthlyBoundaryGenerator: ICadenceBoundaryGenerator = {
  owner: 'contract',
  generate: (input) => {
    if (!input.anchorDate) {
      throw new Error('Contract cadence generation requires anchorDate.');
    }

    return generateMonthlyContractCadenceServicePeriods({
      rangeStart: input.rangeStart,
      rangeEnd: input.rangeEnd,
      sourceObligation: input.sourceObligation,
      duePosition: input.duePosition,
      anchorDate: input.anchorDate,
    });
  },
};
