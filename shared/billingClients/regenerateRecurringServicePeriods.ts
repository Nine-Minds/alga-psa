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
  candidateCoverageEnd?: ISO8601String;
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

function toDateOnly(value: ISO8601String) {
  return value.slice(0, 10);
}

function normalizeRangeForComparison(
  range: IRecurringServicePeriodRecord['servicePeriod'] | IRecurringServicePeriodRecord['invoiceWindow'],
) {
  return {
    ...range,
    start: toDateOnly(range.start),
    end: toDateOnly(range.end),
  };
}

function normalizeActivityWindowForComparison(
  range: IRecurringServicePeriodRecord['activityWindow'],
) {
  if (!range) {
    return null;
  }

  return {
    ...range,
    start: range.start ? toDateOnly(range.start) : undefined,
    end: range.end ? toDateOnly(range.end) : undefined,
  };
}

function buildSchedulePeriodKey(record: Pick<IRecurringServicePeriodRecord, 'scheduleKey' | 'periodKey'>) {
  return `${record.scheduleKey}\u0000${record.periodKey}`;
}

function buildMaxRevisionBySchedulePeriod(records: IRecurringServicePeriodRecord[]) {
  const maxRevisionBySchedulePeriod = new Map<string, number>();
  for (const record of records) {
    const key = buildSchedulePeriodKey(record);
    const currentMax = maxRevisionBySchedulePeriod.get(key) ?? 0;
    if (record.revision > currentMax) {
      maxRevisionBySchedulePeriod.set(key, record.revision);
    }
  }
  return maxRevisionBySchedulePeriod;
}

function resolveNextRevision(
  record: Pick<IRecurringServicePeriodRecord, 'scheduleKey' | 'periodKey'>,
  requestedRevision: number,
  maxRevisionBySchedulePeriod: Map<string, number>,
) {
  const existingMaxRevision = maxRevisionBySchedulePeriod.get(buildSchedulePeriodKey(record)) ?? 0;
  return Math.max(requestedRevision, existingMaxRevision + 1);
}

export function isPreservedRecurringServicePeriodRecord(
  record: IRecurringServicePeriodRecord,
) {
  return (
    record.provenance.kind === 'user_edited'
    || record.provenance.kind === 'repair'
    || record.lifecycleState === 'edited'
    || record.lifecycleState === 'locked'
    || record.lifecycleState === 'skipped'
    || record.lifecycleState === 'billed'
    || record.invoiceLinkage != null
  );
}

const isPreservedOverrideRecord = isPreservedRecurringServicePeriodRecord;

/** A protected slot or range excludes regenerated charges on either side of an edit. */
export function findRecurringServicePeriodCandidateProtection(
  candidate: IRecurringServicePeriodRecord,
  protectedRecords: IRecurringServicePeriodRecord[],
): IRecurringServicePeriodRecord | undefined {
  return protectedRecords.find((record) =>
    record.sourceObligation.tenant === candidate.sourceObligation.tenant
    && record.sourceObligation.obligationType === candidate.sourceObligation.obligationType
    && record.sourceObligation.obligationId === candidate.sourceObligation.obligationId
    && (
      buildSchedulePeriodKey(record) === buildSchedulePeriodKey(candidate)
      || (
        toDateOnly(candidate.servicePeriod.start) < toDateOnly(record.servicePeriod.end)
        && toDateOnly(candidate.servicePeriod.end) > toDateOnly(record.servicePeriod.start)
      )
    ),
  );
}

export interface RecurringServicePeriodCoverageIndex {
  identities: Set<string>;
  slotKeys: Set<string>;
  protectedRecords: IRecurringServicePeriodRecord[];
}

/**
 * Coverage view shared by capped continuation and coverage reporting. A
 * candidate is accounted for when the ledger holds its exact period, holds its
 * schedule-slot key (an override retaining the original boundary), or when a
 * preserved override's range overlaps it. Without the slot and override
 * semantics, an intentionally replaced period (for example an edited Jan 8–Mar
 * 8 period keeping the Jan–Feb key) would look permanently missing.
 */
export function buildRecurringServicePeriodCoverageIndex(
  records: IRecurringServicePeriodRecord[],
): RecurringServicePeriodCoverageIndex {
  const identities = new Set<string>();
  const slotKeys = new Set<string>();
  const protectedRecords: IRecurringServicePeriodRecord[] = [];

  for (const record of records) {
    if (record.lifecycleState === 'superseded' || record.lifecycleState === 'archived') {
      continue;
    }
    identities.add(
      `${toDateOnly(record.servicePeriod.start)}|${toDateOnly(record.servicePeriod.end)}`,
    );
    slotKeys.add(buildSchedulePeriodKey(record));
    if (isPreservedRecurringServicePeriodRecord(record)) {
      protectedRecords.push(record);
    }
  }

  return { identities, slotKeys, protectedRecords };
}

export function isRecurringServicePeriodCandidateCovered(
  candidate: IRecurringServicePeriodRecord,
  coverage: RecurringServicePeriodCoverageIndex,
): boolean {
  if (
    coverage.identities.has(
      `${toDateOnly(candidate.servicePeriod.start)}|${toDateOnly(candidate.servicePeriod.end)}`,
    )
  ) {
    return true;
  }
  if (coverage.slotKeys.has(buildSchedulePeriodKey(candidate))) {
    return true;
  }
  return findRecurringServicePeriodCandidateProtection(candidate, coverage.protectedRecords) != null;
}

/**
 * Eligible candidates the active ledger neither holds nor intentionally
 * protects. Candidates ending at or before `coverageFloorEnd` are history and
 * excluded. Callers use this to assert coverage continuity instead of trusting
 * the furthest end date, which can reach the horizon while an interior period
 * is missing.
 */
export function findUncoveredRecurringServicePeriodCandidates(
  candidateRecords: IRecurringServicePeriodRecord[],
  activeRecords: IRecurringServicePeriodRecord[],
  coverageFloorEnd?: ISO8601String | null,
): IRecurringServicePeriodRecord[] {
  const coverage = buildRecurringServicePeriodCoverageIndex(activeRecords);
  const eligible = coverageFloorEnd
    ? candidateRecords.filter(
        (candidate) => toDateOnly(candidate.servicePeriod.end) > toDateOnly(coverageFloorEnd),
      )
    : candidateRecords;
  return eligible.filter((candidate) => !isRecurringServicePeriodCandidateCovered(candidate, coverage));
}

function startsAtOrAfterCoverageEnd(
  record: IRecurringServicePeriodRecord,
  candidateCoverageEnd: ISO8601String | undefined,
) {
  return Boolean(candidateCoverageEnd && toDateOnly(record.servicePeriod.start) >= toDateOnly(candidateCoverageEnd));
}

function areEquivalentFutureRecords(
  existing: IRecurringServicePeriodRecord,
  candidate: IRecurringServicePeriodRecord,
) {
  return JSON.stringify({
    cadenceOwner: existing.cadenceOwner,
    duePosition: existing.duePosition,
    servicePeriod: normalizeRangeForComparison(existing.servicePeriod),
    invoiceWindow: normalizeRangeForComparison(existing.invoiceWindow),
    activityWindow: normalizeActivityWindowForComparison(existing.activityWindow ?? null),
    timingMetadata: existing.timingMetadata ?? null,
  }) === JSON.stringify({
    cadenceOwner: candidate.cadenceOwner,
    duePosition: candidate.duePosition,
    servicePeriod: normalizeRangeForComparison(candidate.servicePeriod),
    invoiceWindow: normalizeRangeForComparison(candidate.invoiceWindow),
    activityWindow: normalizeActivityWindowForComparison(candidate.activityWindow ?? null),
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

  if (
    JSON.stringify(normalizeRangeForComparison(existing.servicePeriod))
    !== JSON.stringify(normalizeRangeForComparison(candidate.servicePeriod))
  ) {
    return {
      kind: 'service_period_mismatch',
      recordId: existing.recordId,
      scheduleKey: existing.scheduleKey,
      periodKey: existing.periodKey,
      reason: 'The regenerated candidate no longer matches the preserved override service-period boundary.',
    };
  }

  if (
    JSON.stringify(normalizeRangeForComparison(existing.invoiceWindow))
    !== JSON.stringify(normalizeRangeForComparison(candidate.invoiceWindow))
  ) {
    return {
      kind: 'invoice_window_mismatch',
      recordId: existing.recordId,
      scheduleKey: existing.scheduleKey,
      periodKey: existing.periodKey,
      reason: 'The regenerated candidate no longer matches the preserved override invoice window.',
    };
  }

  const existingActivityWindow = normalizeActivityWindowForComparison(existing.activityWindow ?? null);
  const candidateActivityWindow = normalizeActivityWindowForComparison(candidate.activityWindow ?? null);
  if (JSON.stringify(existingActivityWindow) !== JSON.stringify(candidateActivityWindow)) {
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
  const maxRevisionBySchedulePeriod = buildMaxRevisionBySchedulePeriod(input.existingRecords);
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
  const protectedRecords = existingRecords.filter(isPreservedOverrideRecord);

  const isProtectedCandidate = (candidate: IRecurringServicePeriodRecord) => {
    const protection = findRecurringServicePeriodCandidateProtection(candidate, protectedRecords);
    if (!protection) return false;
    conflicts.push({
      kind: 'service_period_mismatch',
      recordId: protection.recordId,
      scheduleKey: protection.scheduleKey,
      periodKey: candidate.periodKey,
      reason: 'The candidate overlaps a protected service period or replaces its edited slot; no charge was generated. Review the preserved record before repairing this slot.',
    });
    return true;
  };

  let candidateIndex = 0;

  const buildNewRecord = (
    candidate: IRecurringServicePeriodRecord,
  ): IRecurringServicePeriodRecord => {
    const revision = resolveNextRevision(candidate, candidate.revision, maxRevisionBySchedulePeriod);
    return revision === candidate.revision
      ? candidate
      : {
          ...candidate,
          recordId: recordIdFactory({
            scheduleKey: candidate.scheduleKey,
            periodKey: candidate.periodKey,
            revision,
          }),
          revision,
        };
  };

  const appendNewCandidate = (candidate: IRecurringServicePeriodRecord) => {
    if (isProtectedCandidate(candidate)) return;
    const record = buildNewRecord(candidate);
    newRecords.push(record);
    activeRecords.push(record);
  };

  for (const existing of existingRecords) {
    // Candidates that start before this existing record fill a gap in the
    // ledger. Emitting them as new records first keeps the ordered pairing
    // correct when a preserved/override record follows a missing period; a
    // purely positional walk would otherwise pair that preserved record with
    // the wrong candidate and leave the gap unfilled. A candidate carrying this
    // record's own periodKey is its slot (for example a boundary adjustment
    // that moved the start), so it still pairs and surfaces the mismatch.
    while (
      candidateRecords[candidateIndex]
      && toDateOnly(candidateRecords[candidateIndex].servicePeriod.start)
        < toDateOnly(existing.servicePeriod.start)
      && candidateRecords[candidateIndex].periodKey !== existing.periodKey
    ) {
      appendNewCandidate(candidateRecords[candidateIndex]);
      candidateIndex += 1;
    }

    const candidate = candidateRecords[candidateIndex];

    if (isPreservedOverrideRecord(existing)) {
      // A preserved record owns only the candidate that replaces its slot or
      // overlaps its range. Consuming an unrelated candidate here would drop a
      // period no later iteration can regenerate — for example, two preserved
      // monthly locks on a quarterly schedule would swallow the following
      // quarter. Leave unrelated candidates for later existing records or the
      // trailing reconciliation; `appendNewCandidate` still refuses any
      // candidate that actually overlaps a preserved record.
      const ownedCandidate = candidate
        && findRecurringServicePeriodCandidateProtection(candidate, [existing]) != null
        ? candidate
        : undefined;
      const conflict = buildOverrideConflict(existing, ownedCandidate);
      if (conflict) {
        conflicts.push(conflict);
      }
      preservedRecords.push(existing);
      activeRecords.push(existing);
      if (ownedCandidate) {
        candidateIndex += 1;
      }
      continue;
    }

    if (!candidate) {
      if (startsAtOrAfterCoverageEnd(existing, input.candidateCoverageEnd)) {
        preservedRecords.push(existing);
        activeRecords.push(existing);
        continue;
      }

      supersededRecords.push({
        ...existing,
        lifecycleState: 'superseded',
        updatedAt: input.regeneratedAt,
      });
      continue;
    }

    if (isProtectedCandidate(candidate)) {
      supersededRecords.push({
        ...existing,
        lifecycleState: 'superseded',
        updatedAt: input.regeneratedAt,
      });
      candidateIndex += 1;
      continue;
    }

    if (areEquivalentFutureRecords(existing, candidate)) {
      activeRecords.push(existing);
      candidateIndex += 1;
      continue;
    }

    const revision = resolveNextRevision(candidate, existing.revision + 1, maxRevisionBySchedulePeriod);
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
    appendNewCandidate(candidate);
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
