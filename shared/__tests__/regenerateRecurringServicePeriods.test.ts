import { describe, expect, it } from 'vitest';
import type { IRecurringServicePeriodRecord } from '@alga-psa/types';
import { regenerateRecurringServicePeriods } from '../billingClients/regenerateRecurringServicePeriods';

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
