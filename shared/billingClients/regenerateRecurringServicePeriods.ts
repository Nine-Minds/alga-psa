import type {
  IRecurringServicePeriodRecord,
  RegeneratedRecurringServicePeriodReasonCode,
  ISO8601String,
} from '@alga-psa/types';

export type RecurringServicePeriodRegenerationConflictKind =
  | 'missing_candidate'
  | 'service_period_mismatch'
  | 'invoice_window_mismatch'
  | 'activity_window_mismatch';

export interface IRecurringServicePeriodRegenerationConflict {
  kind: RecurringServicePeriodRegenerationConflictKind;
  recordId: string;
  scheduleKey: string;
  periodKey: string;
  reason: string;
}

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
  conflicts: IRecurringServicePeriodRegenerationConflict[];
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

function buildOverrideConflict(
  existing: IRecurringServicePeriodRecord,
  candidate: IRecurringServicePeriodRecord | undefined,
): IRecurringServicePeriodRegenerationConflict | null {
  if (!candidate) {
    return {
      kind: 'missing_candidate',
      recordId: existing.recordId,
      scheduleKey: existing.scheduleKey,
      periodKey: existing.periodKey,
      reason: 'No regenerated candidate remains for this preserved override slot.',
    };
  }

  if (JSON.stringify(existing.servicePeriod) !== JSON.stringify(candidate.servicePeriod)) {
    return {
      kind: 'service_period_mismatch',
      recordId: existing.recordId,
      scheduleKey: existing.scheduleKey,
      periodKey: existing.periodKey,
      reason: 'The regenerated candidate no longer matches the preserved override service-period boundary.',
    };
  }

  if (JSON.stringify(existing.invoiceWindow) !== JSON.stringify(candidate.invoiceWindow)) {
    return {
      kind: 'invoice_window_mismatch',
      recordId: existing.recordId,
      scheduleKey: existing.scheduleKey,
      periodKey: existing.periodKey,
      reason: 'The regenerated candidate no longer matches the preserved override invoice window.',
    };
  }

  if (JSON.stringify(existing.activityWindow ?? null) !== JSON.stringify(candidate.activityWindow ?? null)) {
    return {
      kind: 'activity_window_mismatch',
      recordId: existing.recordId,
      scheduleKey: existing.scheduleKey,
      periodKey: existing.periodKey,
      reason: 'The regenerated candidate no longer matches the preserved override activity window.',
    };
  }

  return null;
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
  const conflicts: IRecurringServicePeriodRegenerationConflict[] = [];

  let candidateIndex = 0;

  for (const existing of existingRecords) {
    const candidate = candidateRecords[candidateIndex];

    if (isPreservedOverrideRecord(existing)) {
      const conflict = buildOverrideConflict(existing, candidate);
      if (conflict) {
        conflicts.push(conflict);
      }
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
        scheduleKey: candidate.scheduleKey,
        periodKey: candidate.periodKey,
        revision,
      }),
      scheduleKey: candidate.scheduleKey,
      periodKey: candidate.periodKey,
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
    conflicts,
  };
}
