import type {
  IRecurringServicePeriodRecord,
  RegeneratedRecurringServicePeriodReasonCode,
  ISO8601String,
} from '@alga-psa/types';

export interface RegenerateRecurringServicePeriodsInput {
  existingRecords: IRecurringServicePeriodRecord[];
  candidateRecords: IRecurringServicePeriodRecord[];
  regeneratedAt: ISO8601String;
  sourceRuleVersion: string;
  sourceRunKey: string;
  regenerationReasonCode?: RegeneratedRecurringServicePeriodReasonCode;
  recordIdFactory?: (input: {
    scheduleKey: string;
    periodKey: string;
    revision: number;
  }) => string;
}

export interface IRecurringServicePeriodRegenerationPlan {
  activeRecords: IRecurringServicePeriodRecord[];
  preservedRecords: IRecurringServicePeriodRecord[];
  regeneratedRecords: IRecurringServicePeriodRecord[];
  supersededRecords: IRecurringServicePeriodRecord[];
  newRecords: IRecurringServicePeriodRecord[];
}

function defaultRecordIdFactory(input: {
  scheduleKey: string;
  periodKey: string;
  revision: number;
}) {
  return `${input.scheduleKey}:${input.periodKey}:r${input.revision}`;
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

function isPreservedOverrideRecord(record: IRecurringServicePeriodRecord) {
  return (
    record.provenance.kind === 'user_edited'
    || record.provenance.kind === 'repair'
    || record.lifecycleState === 'edited'
    || record.lifecycleState === 'locked'
    || record.lifecycleState === 'billed'
  );
}

function areEquivalentFutureRecords(
  existing: IRecurringServicePeriodRecord,
  candidate: IRecurringServicePeriodRecord,
) {
  return JSON.stringify({
    cadenceOwner: existing.cadenceOwner,
    duePosition: existing.duePosition,
    servicePeriod: existing.servicePeriod,
    invoiceWindow: existing.invoiceWindow,
    activityWindow: existing.activityWindow ?? null,
    timingMetadata: existing.timingMetadata ?? null,
  }) === JSON.stringify({
    cadenceOwner: candidate.cadenceOwner,
    duePosition: candidate.duePosition,
    servicePeriod: candidate.servicePeriod,
    invoiceWindow: candidate.invoiceWindow,
    activityWindow: candidate.activityWindow ?? null,
    timingMetadata: candidate.timingMetadata ?? null,
  });
}

export function regenerateRecurringServicePeriods(
  input: RegenerateRecurringServicePeriodsInput,
): IRecurringServicePeriodRegenerationPlan {
  const existingRecords = sortRecords(
    input.existingRecords.filter((record) => record.lifecycleState !== 'archived' && record.lifecycleState !== 'superseded'),
  );
  const candidateRecords = sortRecords(input.candidateRecords);
  const recordIdFactory = input.recordIdFactory ?? defaultRecordIdFactory;
  const regenerationReasonCode = input.regenerationReasonCode ?? 'source_rule_changed';

  const preservedRecords: IRecurringServicePeriodRecord[] = [];
  const regeneratedRecords: IRecurringServicePeriodRecord[] = [];
  const supersededRecords: IRecurringServicePeriodRecord[] = [];
  const newRecords: IRecurringServicePeriodRecord[] = [];
  const activeRecords: IRecurringServicePeriodRecord[] = [];

  let candidateIndex = 0;

  for (const existing of existingRecords) {
    const candidate = candidateRecords[candidateIndex];

    if (isPreservedOverrideRecord(existing)) {
      preservedRecords.push(existing);
      activeRecords.push(existing);
      if (candidate) {
        candidateIndex += 1;
      }
      continue;
    }

    if (!candidate) {
      supersededRecords.push({
        ...existing,
        lifecycleState: 'superseded',
        updatedAt: input.regeneratedAt,
      });
      continue;
    }

    if (areEquivalentFutureRecords(existing, candidate)) {
      activeRecords.push(existing);
      candidateIndex += 1;
      continue;
    }

    const revision = existing.revision + 1;
    const regeneratedRecord: IRecurringServicePeriodRecord = {
      ...candidate,
      recordId: recordIdFactory({
        scheduleKey: existing.scheduleKey,
        periodKey: existing.periodKey,
        revision,
      }),
      scheduleKey: existing.scheduleKey,
      periodKey: existing.periodKey,
      revision,
      lifecycleState: 'generated',
      provenance: {
        kind: 'regenerated',
        reasonCode: regenerationReasonCode,
        sourceRuleVersion: input.sourceRuleVersion,
        sourceRunKey: input.sourceRunKey,
        supersedesRecordId: existing.recordId,
      },
      createdAt: input.regeneratedAt,
      updatedAt: input.regeneratedAt,
    };

    regeneratedRecords.push(regeneratedRecord);
    supersededRecords.push({
      ...existing,
      lifecycleState: 'superseded',
      updatedAt: input.regeneratedAt,
    });
    activeRecords.push(regeneratedRecord);
    candidateIndex += 1;
  }

  for (const candidate of candidateRecords.slice(candidateIndex)) {
    newRecords.push(candidate);
    activeRecords.push(candidate);
  }

  return {
    activeRecords,
    preservedRecords,
    regeneratedRecords,
    supersededRecords,
    newRecords,
  };
}
