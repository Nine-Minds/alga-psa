import type { IRecurringDateRange, ISO8601String } from '@alga-psa/types';

export const DEFAULT_RECURRING_SERVICE_PERIOD_GENERATION_HORIZON_DAYS = 180;
export const DEFAULT_RECURRING_SERVICE_PERIOD_REPLENISHMENT_THRESHOLD_DAYS = 45;

export type RecurringServicePeriodContinuityIssueKind = 'gap' | 'overlap';

export interface IRecurringServicePeriodContinuityIssue {
  kind: RecurringServicePeriodContinuityIssueKind;
  previousEnd: ISO8601String;
  nextStart: ISO8601String;
}

export interface IRecurringServicePeriodGenerationHorizonWindow {
  asOf: ISO8601String;
  targetHorizonEnd: ISO8601String;
  replenishmentThresholdEnd: ISO8601String;
  targetHorizonDays: number;
  replenishmentThresholdDays: number;
}

export interface IRecurringServicePeriodGenerationCoverageStatus
  extends IRecurringServicePeriodGenerationHorizonWindow {
  furthestGeneratedEnd: ISO8601String | null;
  meetsTargetHorizon: boolean;
  needsReplenishment: boolean;
  continuityIssues: IRecurringServicePeriodContinuityIssue[];
}

type ResolveGenerationHorizonInput = {
  asOf: ISO8601String;
  targetHorizonDays?: number;
  replenishmentThresholdDays?: number;
};

type AssessGenerationCoverageInput = ResolveGenerationHorizonInput & {
  futurePeriods: Pick<IRecurringDateRange, 'start' | 'end'>[];
};

const UTC_MIDNIGHT_SUFFIX = 'T00:00:00.000Z';
function addDays(date: ISO8601String, days: number): ISO8601String {
  const next = new Date(`${date}${UTC_MIDNIGHT_SUFFIX}`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

export function resolveRecurringServicePeriodGenerationHorizon(
  input: ResolveGenerationHorizonInput,
): IRecurringServicePeriodGenerationHorizonWindow {
  const targetHorizonDays = Number.isInteger(input.targetHorizonDays)
    && (input.targetHorizonDays as number) > 0
    ? Math.trunc(input.targetHorizonDays as number)
    : DEFAULT_RECURRING_SERVICE_PERIOD_GENERATION_HORIZON_DAYS;
  const replenishmentThresholdDays =
    Number.isInteger(input.replenishmentThresholdDays)
      && (input.replenishmentThresholdDays as number) > 0
      ? Math.trunc(input.replenishmentThresholdDays as number)
      : DEFAULT_RECURRING_SERVICE_PERIOD_REPLENISHMENT_THRESHOLD_DAYS;

  if (replenishmentThresholdDays >= targetHorizonDays) {
    throw new Error(
      'Recurring service-period replenishment threshold must stay below the target horizon',
    );
  }

  return {
    asOf: input.asOf,
    targetHorizonDays,
    replenishmentThresholdDays,
    targetHorizonEnd: addDays(input.asOf, targetHorizonDays),
    replenishmentThresholdEnd: addDays(input.asOf, replenishmentThresholdDays),
  };
}

export function findRecurringServicePeriodContinuityIssues(
  futurePeriods: Pick<IRecurringDateRange, 'start' | 'end'>[],
): IRecurringServicePeriodContinuityIssue[] {
  const sortedPeriods = [...futurePeriods].sort((left, right) =>
    left.start === right.start ? left.end.localeCompare(right.end) : left.start.localeCompare(right.start),
  );

  const issues: IRecurringServicePeriodContinuityIssue[] = [];

  for (let index = 1; index < sortedPeriods.length; index += 1) {
    const previous = sortedPeriods[index - 1];
    const current = sortedPeriods[index];

    if (previous.end < current.start) {
      issues.push({
        kind: 'gap',
        previousEnd: previous.end,
        nextStart: current.start,
      });
      continue;
    }

    if (previous.end > current.start) {
      issues.push({
        kind: 'overlap',
        previousEnd: previous.end,
        nextStart: current.start,
      });
    }
  }

  return issues;
}

export function assessRecurringServicePeriodGenerationCoverage(
  input: AssessGenerationCoverageInput,
): IRecurringServicePeriodGenerationCoverageStatus {
  const horizon = resolveRecurringServicePeriodGenerationHorizon(input);
  const continuityIssues = findRecurringServicePeriodContinuityIssues(input.futurePeriods);
  const furthestGeneratedEnd = input.futurePeriods.length > 0
    ? [...input.futurePeriods]
      .sort((left, right) => left.end.localeCompare(right.end))
      .at(-1)?.end ?? null
    : null;

  return {
    ...horizon,
    furthestGeneratedEnd,
    meetsTargetHorizon: furthestGeneratedEnd != null
      && furthestGeneratedEnd >= horizon.targetHorizonEnd,
    needsReplenishment: furthestGeneratedEnd == null
      || furthestGeneratedEnd <= horizon.replenishmentThresholdEnd,
    continuityIssues,
  };
}
