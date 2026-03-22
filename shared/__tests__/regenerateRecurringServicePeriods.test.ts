import { describe, expect, it } from 'vitest';
import type { IRecurringServicePeriodRecord } from '@alga-psa/types';
import { regenerateRecurringServicePeriods } from '../billingClients/regenerateRecurringServicePeriods';

function makeRecord(input: {
  recordId: string;
  scheduleKey: string;
  periodKey: string;
  revision: number;
  duePosition: 'advance' | 'arrears';
  lifecycleState?: IRecurringServicePeriodRecord['lifecycleState'];
  provenanceKind?: IRecurringServicePeriodRecord['provenance']['kind'];
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
    servicePeriod: {
      start: '2026-03-01',
      end: '2026-04-01',
      semantics: 'half_open',
    },
    invoiceWindow: {
      start: input.duePosition === 'advance' ? '2026-03-01' : '2026-04-01',
      end: input.duePosition === 'advance' ? '2026-04-01' : '2026-05-01',
      semantics: 'half_open',
    },
    activityWindow: null,
    provenance: {
      kind: input.provenanceKind ?? 'generated',
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
});
