import type { IRecurringServicePeriodRecord, ISO8601String } from '@alga-psa/types';

export interface IRecurringServicePeriodEditContinuityValidation {
  valid: boolean;
  errors: string[];
}

function compareDateOnly(left: ISO8601String, right: ISO8601String) {
  return left.slice(0, 10).localeCompare(right.slice(0, 10));
}

function sortRecords(records: IRecurringServicePeriodRecord[]) {
  return [...records].sort((left, right) => {
    if (left.servicePeriod.start !== right.servicePeriod.start) {
      return left.servicePeriod.start.localeCompare(right.servicePeriod.start);
    }
    if (left.servicePeriod.end !== right.servicePeriod.end) {
      return left.servicePeriod.end.localeCompare(right.servicePeriod.end);
    }
    return left.revision - right.revision;
  });
}

export function validateRecurringServicePeriodEditContinuity(input: {
  editedRecord: IRecurringServicePeriodRecord;
  siblingRecords: IRecurringServicePeriodRecord[];
  supersededRecordId?: string;
}): IRecurringServicePeriodEditContinuityValidation {
  const activeSiblingRecords = sortRecords(
    input.siblingRecords.filter((record) =>
      record.scheduleKey === input.editedRecord.scheduleKey
      && record.lifecycleState !== 'archived'
      && record.lifecycleState !== 'superseded'
      && record.recordId !== input.editedRecord.recordId
      && record.recordId !== input.supersededRecordId,
    ),
  );
  const errors: string[] = [];

  const previousRecord = [...activeSiblingRecords]
    .reverse()
    .find((record) => compareDateOnly(record.servicePeriod.start, input.editedRecord.servicePeriod.start) < 0);
  const nextRecord = activeSiblingRecords.find(
    (record) => compareDateOnly(record.servicePeriod.start, input.editedRecord.servicePeriod.start) > 0,
  );

  if (previousRecord) {
    const relation = compareDateOnly(previousRecord.servicePeriod.end, input.editedRecord.servicePeriod.start);
    if (relation < 0) {
      errors.push(
        `Edit would create a service-period gap before ${input.editedRecord.periodKey}: previous period ends ${previousRecord.servicePeriod.end}.`,
      );
    } else if (relation > 0) {
      errors.push(
        `Edit would create a service-period overlap before ${input.editedRecord.periodKey}: previous period ends ${previousRecord.servicePeriod.end}.`,
      );
    }
  }

  if (nextRecord) {
    const relation = compareDateOnly(input.editedRecord.servicePeriod.end, nextRecord.servicePeriod.start);
    if (relation < 0) {
      errors.push(
        `Edit would create a service-period gap after ${input.editedRecord.periodKey}: next period starts ${nextRecord.servicePeriod.start}.`,
      );
    } else if (relation > 0) {
      errors.push(
        `Edit would create a service-period overlap after ${input.editedRecord.periodKey}: next period starts ${nextRecord.servicePeriod.start}.`,
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
