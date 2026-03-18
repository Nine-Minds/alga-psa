import { describe, expect, it } from 'vitest';

import { regenerateRecurringServicePeriods } from '@alga-psa/shared/billingClients/regenerateRecurringServicePeriods';
import { buildRecurringServicePeriodRecord } from '../../test-utils/recurringTimingFixtures';

describe('recurring service period regeneration conflicts', () => {
  it('T299: source-rule changes that conflict with preserved user edits surface explicit conflict records instead of being silently discarded', () => {
    const editedOverride = buildRecurringServicePeriodRecord({
      recordId: 'rsp_override',
      scheduleKey: 'schedule:tenant-1:contract_line:line-1:client:advance',
      periodKey: 'period:2026-06-10:2026-07-10',
      lifecycleState: 'edited',
      servicePeriod: {
        start: '2026-06-12',
        end: '2026-07-10',
        semantics: 'half_open',
      },
      invoiceWindow: {
        start: '2026-06-12',
        end: '2026-07-10',
        semantics: 'half_open',
      },
      provenance: {
        kind: 'user_edited',
        reasonCode: 'boundary_adjustment',
        sourceRuleVersion: 'contract-line-1:v1',
        sourceRunKey: 'edit-1',
        supersedesRecordId: 'rsp_original',
      },
    });

    const missingCandidatePlan = regenerateRecurringServicePeriods({
      existingRecords: [editedOverride],
      candidateRecords: [],
      regeneratedAt: '2026-03-18T18:00:00.000Z',
      sourceRuleVersion: 'contract-line-1:v2',
      sourceRunKey: 'regen-1',
    });

    expect(missingCandidatePlan.preservedRecords).toEqual([editedOverride]);
    expect(missingCandidatePlan.conflicts).toMatchObject([
      {
        kind: 'missing_candidate',
        recordId: 'rsp_override',
        periodKey: 'period:2026-06-10:2026-07-10',
      },
    ]);

    const mismatchedCandidatePlan = regenerateRecurringServicePeriods({
      existingRecords: [editedOverride],
      candidateRecords: [
        buildRecurringServicePeriodRecord({
          recordId: 'rsp_candidate',
          scheduleKey: editedOverride.scheduleKey,
          periodKey: editedOverride.periodKey,
          servicePeriod: {
            start: '2026-06-10',
            end: '2026-07-10',
            semantics: 'half_open',
          },
          invoiceWindow: {
            start: '2026-06-10',
            end: '2026-07-10',
            semantics: 'half_open',
          },
        }),
      ],
      regeneratedAt: '2026-03-18T18:05:00.000Z',
      sourceRuleVersion: 'contract-line-1:v2',
      sourceRunKey: 'regen-2',
    });

    expect(mismatchedCandidatePlan.preservedRecords).toEqual([editedOverride]);
    expect(mismatchedCandidatePlan.conflicts).toMatchObject([
      {
        kind: 'service_period_mismatch',
        recordId: 'rsp_override',
      },
    ]);
  });
});
