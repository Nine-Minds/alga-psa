import { Temporal } from '@js-temporal/polyfill';
import type {
  BillingCycleType,
  DuePosition,
  ICadenceBoundaryGenerator,
  IRecurringObligationRef,
  IRecurringServicePeriod,
  ISO8601String,
} from '@alga-psa/types';
import { RECURRING_RANGE_SEMANTICS } from '@alga-psa/types';
import type { BillingCycleAnchorSettingsInput } from './billingCycleAnchors';
import {
  ensureUtcMidnightIsoDate,
  getBillingPeriodForDate,
  normalizeAnchorSettingsForCycle,
} from './billingCycleAnchors';

export interface HistoricalBillingCycleBoundary {
  start: ISO8601String;
  end: ISO8601String;
  billingCycleId?: string;
}

export interface ClientCadenceServicePeriodGenerationInput {
  billingCycle: BillingCycleType;
  rangeStart: ISO8601String;
  rangeEnd: ISO8601String;
  sourceObligation: IRecurringObligationRef;
  duePosition: DuePosition;
  anchorSettings?: BillingCycleAnchorSettingsInput;
  historicalCycles?: HistoricalBillingCycleBoundary[];
}

const compareIsoDates = (left: ISO8601String, right: ISO8601String) =>
  Temporal.PlainDate.compare(
    Temporal.PlainDate.from(left.slice(0, 10)),
    Temporal.PlainDate.from(right.slice(0, 10)),
  );

function isValidHalfOpenRange(start: ISO8601String, end: ISO8601String) {
  return compareIsoDates(end, start) > 0;
}

function toServicePeriod(input: {
  start: ISO8601String;
  end: ISO8601String;
  sourceObligation: IRecurringObligationRef;
  duePosition: DuePosition;
}): IRecurringServicePeriod {
  return {
    kind: 'service_period',
    cadenceOwner: 'client',
    duePosition: input.duePosition,
    sourceObligation: input.sourceObligation,
    start: input.start,
    end: input.end,
    semantics: RECURRING_RANGE_SEMANTICS,
  };
}

function normalizeHistoricalCycles(
  cycles: HistoricalBillingCycleBoundary[] | undefined,
): HistoricalBillingCycleBoundary[] {
  if (!cycles?.length) {
    return [];
  }

  const sorted = cycles
    .map((cycle) => ({
      ...cycle,
      start: ensureUtcMidnightIsoDate(cycle.start),
      end: ensureUtcMidnightIsoDate(cycle.end),
    }))
    .filter((cycle) => isValidHalfOpenRange(cycle.start, cycle.end))
    .sort((left, right) => compareIsoDates(left.start, right.start));

  const normalized: HistoricalBillingCycleBoundary[] = [];
  for (const cycle of sorted) {
    const previous = normalized[normalized.length - 1];
    if (previous && compareIsoDates(cycle.start, previous.end) < 0) {
      continue;
    }
    normalized.push(cycle);
  }

  return normalized;
}

function generateAnchoredPeriodsForGap(input: {
  billingCycle: BillingCycleType;
  gapStart: ISO8601String;
  gapEnd: ISO8601String;
  sourceObligation: IRecurringObligationRef;
  duePosition: DuePosition;
  anchorSettings?: BillingCycleAnchorSettingsInput;
  treatGapStartAsBoundary?: boolean;
}): IRecurringServicePeriod[] {
  if (compareIsoDates(input.gapStart, input.gapEnd) >= 0) {
    return [];
  }

  const anchor = normalizeAnchorSettingsForCycle(input.billingCycle, input.anchorSettings ?? {});
  const generated: IRecurringServicePeriod[] = [];
  const seen = new Set<string>();
  let cursor = input.gapStart;

  if (input.treatGapStartAsBoundary) {
    for (let iterations = 0; iterations < 100; iterations += 1) {
      if (compareIsoDates(cursor, input.gapEnd) >= 0) {
        break;
      }

      const nextBoundary = getBillingPeriodForDate(cursor, input.billingCycle, anchor).periodEndDate;
      const key = `${cursor}:${nextBoundary}`;
      if (!seen.has(key)) {
        generated.push(
          toServicePeriod({
            start: cursor,
            end: nextBoundary,
            sourceObligation: input.sourceObligation,
            duePosition: input.duePosition,
          }),
        );
        seen.add(key);
      }

      if (compareIsoDates(nextBoundary, cursor) <= 0) {
        throw new Error('Client cadence transition generation did not advance to the next boundary.');
      }
      cursor = nextBoundary;
    }

    return generated;
  }

  for (let iterations = 0; iterations < 100; iterations += 1) {
    const period = getBillingPeriodForDate(cursor, input.billingCycle, anchor);
    if (compareIsoDates(period.periodStartDate, input.gapEnd) >= 0) {
      break;
    }

    const key = `${period.periodStartDate}:${period.periodEndDate}`;
    if (!seen.has(key)) {
      generated.push(
        toServicePeriod({
          start: period.periodStartDate,
          end: period.periodEndDate,
          sourceObligation: input.sourceObligation,
          duePosition: input.duePosition,
        }),
      );
      seen.add(key);
    }

    if (compareIsoDates(period.periodEndDate, cursor) <= 0) {
      throw new Error('Client cadence generation did not advance to the next service period.');
    }
    cursor = period.periodEndDate;
  }

  return generated;
}

export function generateClientCadenceServicePeriods(
  input: ClientCadenceServicePeriodGenerationInput,
): IRecurringServicePeriod[] {
  const rangeStart = ensureUtcMidnightIsoDate(input.rangeStart);
  const rangeEnd = ensureUtcMidnightIsoDate(input.rangeEnd);

  if (!isValidHalfOpenRange(rangeStart, rangeEnd)) {
    throw new Error('Client cadence generation requires rangeEnd to be after rangeStart.');
  }

  const normalizedHistorical = normalizeHistoricalCycles(input.historicalCycles);
  const hasHistoricalBoundaryAt = (date: ISO8601String) =>
    normalizedHistorical.some((cycle) => compareIsoDates(cycle.end, date) === 0);
  const periods: IRecurringServicePeriod[] = [];
  let cursor = rangeStart;

  for (const cycle of normalizedHistorical) {
    if (compareIsoDates(cycle.end, cursor) <= 0) {
      continue;
    }
    if (compareIsoDates(cycle.start, rangeEnd) >= 0) {
      break;
    }

    if (compareIsoDates(cycle.start, cursor) > 0) {
      periods.push(
        ...generateAnchoredPeriodsForGap({
          billingCycle: input.billingCycle,
          gapStart: cursor,
          gapEnd: cycle.start,
          sourceObligation: input.sourceObligation,
          duePosition: input.duePosition,
          anchorSettings: input.anchorSettings,
          treatGapStartAsBoundary: periods.length > 0 || hasHistoricalBoundaryAt(cursor),
        }),
      );
    }

    periods.push(
      toServicePeriod({
        start: cycle.start,
        end: cycle.end,
        sourceObligation: input.sourceObligation,
        duePosition: input.duePosition,
      }),
    );
    cursor = cycle.end;
  }

  periods.push(
    ...generateAnchoredPeriodsForGap({
      billingCycle: input.billingCycle,
      gapStart: cursor,
      gapEnd: rangeEnd,
      sourceObligation: input.sourceObligation,
      duePosition: input.duePosition,
      anchorSettings: input.anchorSettings,
      treatGapStartAsBoundary: periods.length > 0 || hasHistoricalBoundaryAt(cursor),
    }),
  );

  return periods;
}

export const clientCadenceBoundaryGenerator: ICadenceBoundaryGenerator = {
  owner: 'client',
  generate: (input) =>
    generateClientCadenceServicePeriods({
      billingCycle: 'monthly',
      rangeStart: input.rangeStart,
      rangeEnd: input.rangeEnd,
      sourceObligation: input.sourceObligation,
      duePosition: input.duePosition,
    }),
};
