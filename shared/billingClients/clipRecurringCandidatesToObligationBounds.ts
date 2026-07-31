import type { IRecurringServicePeriodRecord, ISO8601String } from '@alga-psa/types';

function compareIsoDateOnly(left: ISO8601String, right: ISO8601String): number {
  return left.slice(0, 10).localeCompare(right.slice(0, 10));
}

/**
 * A recurring obligation that starts or ends inside a schedule period is only
 * active for part of that period. The invoice engine derives coverage (and
 * proration / canonical detail periods) from the persisted activity window,
 * so candidates must be bounded before they are persisted. Candidates wholly
 * outside the obligation are removed so this helper never creates an inverted
 * activity window.
 */
export function clipRecurringCandidatesToObligationBounds(
  records: IRecurringServicePeriodRecord[],
  obligationStart: ISO8601String,
  obligationEnd: ISO8601String | null,
): IRecurringServicePeriodRecord[] {
  return records.flatMap((record) => {
    if (
      obligationEnd
      && compareIsoDateOnly(record.servicePeriod.start, obligationEnd) >= 0
    ) {
      return [];
    }

    if (compareIsoDateOnly(record.servicePeriod.end, obligationStart) <= 0) {
      return [];
    }

    const clipStart =
      compareIsoDateOnly(obligationStart, record.servicePeriod.start) > 0
        ? obligationStart
        : null;
    const clipEnd =
      obligationEnd && compareIsoDateOnly(obligationEnd, record.servicePeriod.end) < 0
        ? obligationEnd
        : null;

    if (!clipStart && !clipEnd) {
      return [record];
    }

    return [{
      ...record,
      activityWindow: {
        start: clipStart ?? record.servicePeriod.start,
        end: clipEnd ?? record.servicePeriod.end,
        semantics: record.servicePeriod.semantics,
      },
    }];
  });
}
