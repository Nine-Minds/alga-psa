import type {
  CadenceOwner,
  DuePosition,
  IRecurringDateRange,
  ISO8601String,
  RecurringObligationType,
} from '@alga-psa/types';

function toDateOnly(value: ISO8601String | Date): ISO8601String {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10) as ISO8601String;
  }

  return `${value.slice(0, 10)}` as ISO8601String;
}

export function buildRecurringServicePeriodScheduleKey(input: {
  tenant: string;
  obligationType: RecurringObligationType;
  obligationId: string;
  cadenceOwner: CadenceOwner;
  duePosition: DuePosition;
}) {
  return `schedule:${input.tenant}:${input.obligationType}:${input.obligationId}:${input.cadenceOwner}:${input.duePosition}`;
}

export function buildRecurringServicePeriodPeriodKey(
  period: Pick<IRecurringDateRange, 'start' | 'end'>,
) {
  return `period:${toDateOnly(period.start)}:${toDateOnly(period.end)}`;
}
