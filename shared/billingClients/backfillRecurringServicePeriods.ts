import type {
  IRecurringServicePeriodRecord,
  ISO8601String,
  RegeneratedRecurringServicePeriodReasonCode,
} from '@alga-psa/types';
import { regenerateRecurringServicePeriods } from './regenerateRecurringServicePeriods';

export interface BackfillRecurringServicePeriodsInput {
  candidateRecords: IRecurringServicePeriodRecord[];
  backfilledAt: ISO8601String;
  sourceRuleVersion: string;
  sourceRunKey: string;
  existingRecords?: IRecurringServicePeriodRecord[];
  legacyBilledThroughEnd?: ISO8601String | null;
  regenerationReasonCode?: RegeneratedRecurringServicePeriodReasonCode;
  recordIdFactory?: (input: {
    scheduleKey: string;
    periodKey: string;
    revision: number;
  }) => string;
}

export interface IRecurringServicePeriodBackfillPlan {
  historicalBoundaryEnd: ISO8601String | null;
  skippedHistoricalCandidates: IRecurringServicePeriodRecord[];
  retainedRecords: IRecurringServicePeriodRecord[];
  backfilledRecords: IRecurringServicePeriodRecord[];
  realignedRecords: IRecurringServicePeriodRecord[];
  supersededRecords: IRecurringServicePeriodRecord[];
  activeRecords: IRecurringServicePeriodRecord[];
}

function toDateOnly(value: ISO8601String): ISO8601String {
  return `${value.slice(0, 10)}` as ISO8601String;
}

function compareDateOnly(left: ISO8601String, right: ISO8601String) {
  return toDateOnly(left).localeCompare(toDateOnly(right));
}

function sortRecords(records: IRecurringServicePeriodRecord[]) {
  return [...records].sort((left, right) => {
    if (left.servicePeriod.start !== right.servicePeriod.start) {
      return left.servicePeriod.start.localeCompare(right.servicePeriod.start);
    }
    if (left.servicePeriod.end !== right.servicePeriod.end) {
      return left.servicePeriod.end.localeCompare(right.servicePeriod.end);
    }
    if (left.sourceObligation.obligationId !== right.sourceObligation.obligationId) {
      return left.sourceObligation.obligationId.localeCompare(right.sourceObligation.obligationId);
    }
    return left.revision - right.revision;
  });
}

function resolveHistoricalBoundaryEnd(
  records: IRecurringServicePeriodRecord[],
  legacyBilledThroughEnd: ISO8601String | null | undefined,
) {
  let boundary = legacyBilledThroughEnd ? toDateOnly(legacyBilledThroughEnd) : null;

  for (const record of records) {
    const isBilledHistory = record.lifecycleState === 'billed' || record.invoiceLinkage != null;
    if (!isBilledHistory) {
      continue;
    }

    const recordBoundary = toDateOnly(record.servicePeriod.end);
    if (!boundary || compareDateOnly(recordBoundary, boundary) > 0) {
      boundary = recordBoundary;
    }
  }

  return boundary;
}

function normalizeBackfillCandidate(
  candidate: IRecurringServicePeriodRecord,
  input: Pick<BackfillRecurringServicePeriodsInput, 'backfilledAt' | 'sourceRuleVersion' | 'sourceRunKey'>,
): IRecurringServicePeriodRecord {
  return {
    ...candidate,
    lifecycleState: 'generated',
    provenance: {
      kind: 'generated',
      reasonCode: 'backfill_materialization',
      sourceRuleVersion: input.sourceRuleVersion,
      sourceRunKey: input.sourceRunKey,
    },
    invoiceLinkage: null,
    createdAt: input.backfilledAt,
    updatedAt: input.backfilledAt,
  };
}

function overlapsHistoricalBoundary(
  record: IRecurringServicePeriodRecord,
  historicalBoundaryEnd: ISO8601String,
) {
  return (
    compareDateOnly(record.servicePeriod.start, historicalBoundaryEnd) < 0
    && compareDateOnly(record.servicePeriod.end, historicalBoundaryEnd) > 0
  );
}

function buildRecordIdSet(records: IRecurringServicePeriodRecord[]) {
  return new Set(records.map((record) => record.recordId));
}

export function backfillRecurringServicePeriods(
  input: BackfillRecurringServicePeriodsInput,
): IRecurringServicePeriodBackfillPlan {
  const existingRecords = sortRecords(
    (input.existingRecords ?? []).filter(
      (record) => record.lifecycleState !== 'archived' && record.lifecycleState !== 'superseded',
    ),
  );
  const historicalBoundaryEnd = resolveHistoricalBoundaryEnd(
    existingRecords,
    input.legacyBilledThroughEnd,
  );
  const normalizedCandidates = sortRecords(
    input.candidateRecords.map((candidate) =>
      normalizeBackfillCandidate(candidate, {
        backfilledAt: input.backfilledAt,
        sourceRuleVersion: input.sourceRuleVersion,
        sourceRunKey: input.sourceRunKey,
      })),
  );

  const skippedHistoricalCandidates: IRecurringServicePeriodRecord[] = [];
  const futureCandidates: IRecurringServicePeriodRecord[] = [];

  for (const candidate of normalizedCandidates) {
    if (!historicalBoundaryEnd) {
      futureCandidates.push(candidate);
      continue;
    }

    if (overlapsHistoricalBoundary(candidate, historicalBoundaryEnd)) {
      throw new Error(
        `Backfill candidate ${candidate.periodKey} overlaps billed-history boundary ${historicalBoundaryEnd}.`,
      );
    }

    if (compareDateOnly(candidate.servicePeriod.end, historicalBoundaryEnd) <= 0) {
      skippedHistoricalCandidates.push(candidate);
      continue;
    }

    futureCandidates.push(candidate);
  }

  const retainedHistoricalRecords = sortRecords(
    historicalBoundaryEnd
      ? existingRecords.filter(
          (record) => compareDateOnly(record.servicePeriod.end, historicalBoundaryEnd) <= 0,
        )
      : [],
  );
  const futureScopeExistingRecords = historicalBoundaryEnd
    ? existingRecords.filter(
        (record) => compareDateOnly(record.servicePeriod.end, historicalBoundaryEnd) > 0,
      )
    : existingRecords;

  const regenerationPlan = regenerateRecurringServicePeriods({
    existingRecords: futureScopeExistingRecords,
    candidateRecords: futureCandidates,
    regeneratedAt: input.backfilledAt,
    sourceRuleVersion: input.sourceRuleVersion,
    sourceRunKey: input.sourceRunKey,
    regenerationReasonCode: input.regenerationReasonCode ?? 'backfill_realignment',
    recordIdFactory: input.recordIdFactory,
  });

  const createdRecordIds = buildRecordIdSet([
    ...regenerationPlan.newRecords,
    ...regenerationPlan.regeneratedRecords,
  ]);
  const retainedRecords = sortRecords([
    ...retainedHistoricalRecords,
    ...regenerationPlan.activeRecords.filter((record) => !createdRecordIds.has(record.recordId)),
  ]);
  const activeRecords = sortRecords([
    ...retainedHistoricalRecords,
    ...regenerationPlan.activeRecords,
  ]);

  return {
    historicalBoundaryEnd,
    skippedHistoricalCandidates,
    retainedRecords,
    backfilledRecords: sortRecords(regenerationPlan.newRecords),
    realignedRecords: sortRecords(regenerationPlan.regeneratedRecords),
    supersededRecords: sortRecords(regenerationPlan.supersededRecords),
    activeRecords,
  };
}
