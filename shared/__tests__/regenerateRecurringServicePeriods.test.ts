import { describe, expect, it } from 'vitest';
import type { IRecurringServicePeriodRecord } from '@alga-psa/types';
import {
  findUncoveredRecurringServicePeriodCandidates,
  regenerateRecurringServicePeriods,
} from '../billingClients/regenerateRecurringServicePeriods';

function makeRecord(input: {
  recordId: string;
  scheduleKey: string;
  periodKey: string;
  revision: number;
  duePosition: 'advance' | 'arrears';
  servicePeriod?: IRecurringServicePeriodRecord['servicePeriod'];
  invoiceWindow?: IRecurringServicePeriodRecord['invoiceWindow'];
  lifecycleState?: IRecurringServicePeriodRecord['lifecycleState'];
  provenance?: IRecurringServicePeriodRecord['provenance'];
}): IRecurringServicePeriodRecord {
  return {
    kind: 'persisted_service_period_record',
    recordId: input.recordId,
    scheduleKey: input.scheduleKey,
    periodKey: input.periodKey,
    revision: input.revision,
    sourceObligation: {
      tenant: 'tenant-1',
      obligationId: 'line-1',
      obligationType: 'contract_line',
      chargeFamily: 'fixed',
    },
    cadenceOwner: 'contract',
    duePosition: input.duePosition,
    lifecycleState: input.lifecycleState ?? 'generated',
    servicePeriod: input.servicePeriod ?? {
      start: '2026-03-01',
      end: '2026-04-01',
      semantics: 'half_open',
    },
    invoiceWindow: input.invoiceWindow ?? {
      start: input.duePosition === 'advance' ? '2026-03-01' : '2026-04-01',
      end: input.duePosition === 'advance' ? '2026-04-01' : '2026-05-01',
      semantics: 'half_open',
    },
    activityWindow: null,
    provenance: input.provenance ?? {
      kind: 'generated',
      reasonCode: 'initial_materialization',
      sourceRuleVersion: 'rule-v1',
      sourceRunKey: 'run-v1',
    },
    invoiceLinkage: null,
    createdAt: '2026-03-01T00:00:00Z',
    updatedAt: '2026-03-01T00:00:00Z',
  };
}

describe('regenerateRecurringServicePeriods', () => {
  it('rekeys regenerated records when schedule identity changes', () => {
    const existingArrears = makeRecord({
      recordId: 'record-arrears-r1',
      scheduleKey: 'schedule:tenant-1:contract_line:line-1:contract:arrears',
      periodKey: 'period:2026-03-01:2026-04-01',
      revision: 1,
      duePosition: 'arrears',
    });

    const candidateAdvance = makeRecord({
      recordId: 'record-advance-r1',
      scheduleKey: 'schedule:tenant-1:contract_line:line-1:contract:advance',
      periodKey: 'period:2026-03-01:2026-04-01',
      revision: 1,
      duePosition: 'advance',
    });

    const plan = regenerateRecurringServicePeriods({
      existingRecords: [existingArrears],
      candidateRecords: [candidateAdvance],
      regeneratedAt: '2026-03-21T00:00:00Z',
      sourceRuleVersion: 'rule-v2',
      sourceRunKey: 'run-v2',
    });

    expect(plan.supersededRecords).toHaveLength(1);
    expect(plan.regeneratedRecords).toHaveLength(1);
    expect(plan.regeneratedRecords[0]?.scheduleKey).toBe(candidateAdvance.scheduleKey);
    expect(plan.regeneratedRecords[0]?.duePosition).toBe('advance');
    expect(plan.regeneratedRecords[0]?.recordId).toBe(
      'schedule:tenant-1:contract_line:line-1:contract:advance:period:2026-03-01:2026-04-01:r2',
    );
  });

  it('preserves existing records that start at or beyond the generated coverage end', () => {
    const existingInsideCoverage = makeRecord({
      recordId: 'record-june-r1',
      scheduleKey: 'schedule:tenant-1:contract_line:line-1:contract:advance',
      periodKey: 'period:2026-06-01:2026-07-01',
      revision: 1,
      duePosition: 'advance',
      servicePeriod: {
        start: '2026-06-01',
        end: '2026-07-01',
        semantics: 'half_open',
      },
      invoiceWindow: {
        start: '2026-06-01',
        end: '2026-07-01',
        semantics: 'half_open',
      },
    });
    const existingOutsideCoverage = makeRecord({
      recordId: 'record-august-r1',
      scheduleKey: 'schedule:tenant-1:contract_line:line-1:contract:advance',
      periodKey: 'period:2026-08-01:2026-09-01',
      revision: 1,
      duePosition: 'advance',
      servicePeriod: {
        start: '2026-08-01',
        end: '2026-09-01',
        semantics: 'half_open',
      },
      invoiceWindow: {
        start: '2026-08-01',
        end: '2026-09-01',
        semantics: 'half_open',
      },
    });

    const plan = regenerateRecurringServicePeriods({
      existingRecords: [existingInsideCoverage, existingOutsideCoverage],
      candidateRecords: [],
      candidateCoverageEnd: '2026-08-01',
      regeneratedAt: '2026-06-15T00:00:00Z',
      sourceRuleVersion: 'rule-v2',
      sourceRunKey: 'run-v2',
    });

    expect(plan.supersededRecords.map((record) => record.recordId)).toEqual(['record-june-r1']);
    expect(plan.preservedRecords.map((record) => record.recordId)).toEqual(['record-august-r1']);
    expect(plan.activeRecords.map((record) => record.recordId)).toEqual(['record-august-r1']);
  });

  it('treats persisted UTC-midnight date ranges as equivalent to fresh date-only candidates', () => {
    const existing = makeRecord({
      recordId: 'record-june-r1',
      scheduleKey: 'schedule:tenant-1:contract_line:line-1:client:arrears',
      periodKey: 'period:2026-06-01:2026-07-01',
      revision: 1,
      duePosition: 'arrears',
      servicePeriod: {
        start: '2026-06-01T00:00:00Z',
        end: '2026-07-01T00:00:00Z',
        semantics: 'half_open',
      },
      invoiceWindow: {
        start: '2026-07-01T00:00:00Z',
        end: '2026-08-01T00:00:00Z',
        semantics: 'half_open',
      },
    });
    const candidate = makeRecord({
      recordId: 'candidate-june-r1',
      scheduleKey: existing.scheduleKey,
      periodKey: existing.periodKey,
      revision: 1,
      duePosition: 'arrears',
      servicePeriod: {
        start: '2026-06-01',
        end: '2026-07-01',
        semantics: 'half_open',
      },
      invoiceWindow: {
        start: '2026-07-01',
        end: '2026-08-01',
        semantics: 'half_open',
      },
    });

    const plan = regenerateRecurringServicePeriods({
      existingRecords: [existing],
      candidateRecords: [candidate],
      regeneratedAt: '2026-07-06T18:00:00.000Z',
      sourceRuleVersion: 'rule-v1',
      sourceRunKey: 'repair-rerun',
    });

    expect(plan.supersededRecords).toEqual([]);
    expect(plan.regeneratedRecords).toEqual([]);
    expect(plan.newRecords).toEqual([]);
    expect(plan.activeRecords).toEqual([existing]);
  });

  it('fills a gap before a preserved record without duplicating the preserved slot', () => {
    const skipped = makeRecord({
      recordId: 'record-oct-skipped',
      scheduleKey: 'schedule:tenant-1:contract_line:line-1:contract:arrears',
      periodKey: 'period:2026-10-08:2026-11-08',
      revision: 2,
      duePosition: 'arrears',
      lifecycleState: 'skipped',
      provenance: {
        kind: 'user_edited',
        reasonCode: 'skip',
        sourceRuleVersion: 'rule-v1',
        sourceRunKey: 'skip-1',
        supersedesRecordId: 'record-oct-r1',
      },
      servicePeriod: { start: '2026-10-08', end: '2026-11-08', semantics: 'half_open' },
      invoiceWindow: { start: '2026-11-08', end: '2026-12-08', semantics: 'half_open' },
    });

    const candidates = [
      makeRecord({
        recordId: 'c-aug',
        scheduleKey: skipped.scheduleKey,
        periodKey: 'period:2026-08-08:2026-09-08',
        revision: 1,
        duePosition: 'arrears',
        servicePeriod: { start: '2026-08-08', end: '2026-09-08', semantics: 'half_open' },
        invoiceWindow: { start: '2026-09-08', end: '2026-10-08', semantics: 'half_open' },
      }),
      makeRecord({
        recordId: 'c-sep',
        scheduleKey: skipped.scheduleKey,
        periodKey: 'period:2026-09-08:2026-10-08',
        revision: 1,
        duePosition: 'arrears',
        servicePeriod: { start: '2026-09-08', end: '2026-10-08', semantics: 'half_open' },
        invoiceWindow: { start: '2026-10-08', end: '2026-11-08', semantics: 'half_open' },
      }),
      makeRecord({
        recordId: 'c-oct',
        scheduleKey: skipped.scheduleKey,
        periodKey: skipped.periodKey,
        revision: 1,
        duePosition: 'arrears',
        servicePeriod: skipped.servicePeriod,
        invoiceWindow: skipped.invoiceWindow,
      }),
    ];

    const plan = regenerateRecurringServicePeriods({
      existingRecords: [skipped],
      candidateRecords: candidates,
      regeneratedAt: '2026-09-15T00:00:00Z',
      sourceRuleVersion: 'rule-v1',
      sourceRunKey: 'nightly-1',
    });

    expect(plan.preservedRecords.map((record) => record.recordId)).toEqual(['record-oct-skipped']);
    expect(plan.newRecords.map((record) => record.servicePeriod.start).sort()).toEqual([
      '2026-08-08',
      '2026-09-08',
    ]);
    expect(plan.newRecords.some((record) => record.periodKey === skipped.periodKey)).toBe(false);
    expect(plan.supersededRecords).toEqual([]);
    expect(plan.conflicts).toEqual([]);
  });

  it('does not let preserved records consume unrelated later candidates', () => {
    // Quarterly candidate grid anchored 2026-01-08. Two preserved monthly locks
    // sit inside the first quarter; the next quarter (Apr–Jul) is unrelated and
    // must still be generated. The old positional walk consumed one candidate
    // per preserved record and silently swallowed it.
    const scheduleKey = 'schedule:tenant-1:contract_line:line-1:contract:arrears';
    const janLock = makeRecord({
      recordId: 'lock-jan',
      scheduleKey,
      periodKey: 'period:2026-01-08:2026-02-08',
      revision: 1,
      duePosition: 'arrears',
      lifecycleState: 'locked',
      servicePeriod: { start: '2026-01-08', end: '2026-02-08', semantics: 'half_open' },
      invoiceWindow: { start: '2026-02-08', end: '2026-03-08', semantics: 'half_open' },
    });
    const febLock = makeRecord({
      recordId: 'lock-feb',
      scheduleKey,
      periodKey: 'period:2026-02-08:2026-03-08',
      revision: 1,
      duePosition: 'arrears',
      lifecycleState: 'locked',
      servicePeriod: { start: '2026-02-08', end: '2026-03-08', semantics: 'half_open' },
      invoiceWindow: { start: '2026-03-08', end: '2026-04-08', semantics: 'half_open' },
    });
    const quarterlyCandidates = [
      makeRecord({
        recordId: 'c-q1',
        scheduleKey,
        periodKey: 'period:2026-01-08:2026-04-08',
        revision: 1,
        duePosition: 'arrears',
        servicePeriod: { start: '2026-01-08', end: '2026-04-08', semantics: 'half_open' },
        invoiceWindow: { start: '2026-04-08', end: '2026-07-08', semantics: 'half_open' },
      }),
      makeRecord({
        recordId: 'c-q2',
        scheduleKey,
        periodKey: 'period:2026-04-08:2026-07-08',
        revision: 1,
        duePosition: 'arrears',
        servicePeriod: { start: '2026-04-08', end: '2026-07-08', semantics: 'half_open' },
        invoiceWindow: { start: '2026-07-08', end: '2026-10-08', semantics: 'half_open' },
      }),
      makeRecord({
        recordId: 'c-q3',
        scheduleKey,
        periodKey: 'period:2026-07-08:2026-10-08',
        revision: 1,
        duePosition: 'arrears',
        servicePeriod: { start: '2026-07-08', end: '2026-10-08', semantics: 'half_open' },
        invoiceWindow: { start: '2026-10-08', end: '2027-01-08', semantics: 'half_open' },
      }),
    ];

    const plan = regenerateRecurringServicePeriods({
      existingRecords: [janLock, febLock],
      candidateRecords: quarterlyCandidates,
      regeneratedAt: '2026-09-15T00:00:00Z',
      sourceRuleVersion: 'rule-v1',
      sourceRunKey: 'nightly-1',
    });

    expect(plan.preservedRecords.map((record) => record.recordId).sort()).toEqual([
      'lock-feb',
      'lock-jan',
    ]);
    // Q2 and Q3 are generated; Q1 stays suppressed by the two monthly locks.
    expect(plan.newRecords.map((record) => record.servicePeriod.start).sort()).toEqual([
      '2026-04-08',
      '2026-07-08',
    ]);
    expect(plan.supersededRecords).toEqual([]);
  });

  it('reports an uncovered eligible candidate even when later coverage reaches the horizon', () => {
    // Continuity, not the furthest end: the Jan and Feb locks protect the Q1
    // candidate and Q3 is present, but Q2 (Apr 8–Jul 8) is neither held nor
    // protected, so it must be reported even though the ledger extends beyond
    // the horizon.
    const scheduleKey = 'schedule:tenant-1:contract_line:line-1:contract:arrears';
    const janLock = makeRecord({
      recordId: 'lock-jan',
      scheduleKey,
      periodKey: 'period:2026-01-08:2026-02-08',
      revision: 1,
      duePosition: 'arrears',
      lifecycleState: 'locked',
      servicePeriod: { start: '2026-01-08', end: '2026-02-08', semantics: 'half_open' },
      invoiceWindow: { start: '2026-02-08', end: '2026-03-08', semantics: 'half_open' },
    });
    const febLock = makeRecord({
      recordId: 'lock-feb',
      scheduleKey,
      periodKey: 'period:2026-02-08:2026-03-08',
      revision: 1,
      duePosition: 'arrears',
      lifecycleState: 'locked',
      servicePeriod: { start: '2026-02-08', end: '2026-03-08', semantics: 'half_open' },
      invoiceWindow: { start: '2026-03-08', end: '2026-04-08', semantics: 'half_open' },
    });
    const q3Present = makeRecord({
      recordId: 'record-q3',
      scheduleKey,
      periodKey: 'period:2026-07-08:2026-10-08',
      revision: 1,
      duePosition: 'arrears',
      servicePeriod: { start: '2026-07-08', end: '2026-10-08', semantics: 'half_open' },
      invoiceWindow: { start: '2026-10-08', end: '2027-01-08', semantics: 'half_open' },
    });
    const candidates = [
      makeRecord({
        recordId: 'c-q1',
        scheduleKey,
        periodKey: 'period:2026-01-08:2026-04-08',
        revision: 1,
        duePosition: 'arrears',
        servicePeriod: { start: '2026-01-08', end: '2026-04-08', semantics: 'half_open' },
        invoiceWindow: { start: '2026-04-08', end: '2026-07-08', semantics: 'half_open' },
      }),
      makeRecord({
        recordId: 'c-q2',
        scheduleKey,
        periodKey: 'period:2026-04-08:2026-07-08',
        revision: 1,
        duePosition: 'arrears',
        servicePeriod: { start: '2026-04-08', end: '2026-07-08', semantics: 'half_open' },
        invoiceWindow: { start: '2026-07-08', end: '2026-10-08', semantics: 'half_open' },
      }),
      makeRecord({
        recordId: 'c-q3',
        scheduleKey,
        periodKey: 'period:2026-07-08:2026-10-08',
        revision: 1,
        duePosition: 'arrears',
        servicePeriod: { start: '2026-07-08', end: '2026-10-08', semantics: 'half_open' },
        invoiceWindow: { start: '2026-10-08', end: '2027-01-08', semantics: 'half_open' },
      }),
    ];

    const uncovered = findUncoveredRecurringServicePeriodCandidates(
      candidates,
      [janLock, febLock, q3Present],
      null,
    );

    expect(uncovered.map((record) => record.servicePeriod.start)).toEqual(['2026-04-08']);
  });

  it('assigns new records a revision above superseded ledger history', () => {
    const superseded = makeRecord({
      recordId: 'record-june-r1',
      scheduleKey: 'schedule:tenant-1:contract_line:line-1:client:arrears',
      periodKey: 'period:2026-06-01:2026-07-01',
      revision: 1,
      duePosition: 'arrears',
      lifecycleState: 'superseded',
    });
    const candidate = makeRecord({
      recordId: 'candidate-june-r1',
      scheduleKey: superseded.scheduleKey,
      periodKey: superseded.periodKey,
      revision: 1,
      duePosition: 'arrears',
    });

    const plan = regenerateRecurringServicePeriods({
      existingRecords: [superseded],
      candidateRecords: [candidate],
      regeneratedAt: '2026-07-06T18:00:00.000Z',
      sourceRuleVersion: 'rule-v1',
      sourceRunKey: 'repair-after-superseded',
    });

    expect(plan.newRecords).toMatchObject([
      {
        recordId: `${candidate.scheduleKey}:${candidate.periodKey}:r2`,
        revision: 2,
        lifecycleState: 'generated',
      },
    ]);
    expect(plan.supersededRecords).toEqual([]);
  });
});
