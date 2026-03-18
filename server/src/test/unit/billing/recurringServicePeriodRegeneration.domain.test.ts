import { describe, expect, it } from 'vitest';

import { buildRecurringServicePeriodRecord } from '../../test-utils/recurringTimingFixtures';
import { regenerateRecurringServicePeriods } from '@alga-psa/shared/billingClients/regenerateRecurringServicePeriods';

describe('recurring service-period regeneration', () => {
  it('T288: regeneration refreshes future unedited service periods by superseding the old row and writing a regenerated revision', () => {
    const existingGenerated = buildRecurringServicePeriodRecord({
      recordId: 'rsp-existing-1',
      periodKey: 'slot-1',
      revision: 1,
      servicePeriod: {
        start: '2026-01-01',
        end: '2026-02-01',
        semantics: 'half_open',
      },
      invoiceWindow: {
        start: '2026-01-01',
        end: '2026-02-01',
        semantics: 'half_open',
      },
    });
    const existingSame = buildRecurringServicePeriodRecord({
      recordId: 'rsp-existing-2',
      periodKey: 'slot-2',
      revision: 1,
      servicePeriod: {
        start: '2026-02-01',
        end: '2026-03-01',
        semantics: 'half_open',
      },
      invoiceWindow: {
        start: '2026-02-01',
        end: '2026-03-01',
        semantics: 'half_open',
      },
    });

    const candidateChanged = buildRecurringServicePeriodRecord({
      recordId: 'rsp-candidate-1',
      periodKey: 'candidate-slot-1',
      servicePeriod: {
        start: '2026-01-05',
        end: '2026-02-05',
        semantics: 'half_open',
      },
      invoiceWindow: {
        start: '2026-01-05',
        end: '2026-02-05',
        semantics: 'half_open',
      },
    });
    const candidateSame = buildRecurringServicePeriodRecord({
      recordId: 'rsp-candidate-2',
      periodKey: 'candidate-slot-2',
      servicePeriod: existingSame.servicePeriod,
      invoiceWindow: existingSame.invoiceWindow,
    });

    const regenerationPlan = regenerateRecurringServicePeriods({
      existingRecords: [existingGenerated, existingSame],
      candidateRecords: [candidateChanged, candidateSame],
      regeneratedAt: '2026-01-02T12:00:00.000Z',
      sourceRuleVersion: 'contract-line-1:v2',
      sourceRunKey: 'regenerate-2026-01-02',
    });

    expect(regenerationPlan.regeneratedRecords).toHaveLength(1);
    expect(regenerationPlan.regeneratedRecords[0]).toMatchObject({
      periodKey: 'slot-1',
      revision: 2,
      servicePeriod: {
        start: '2026-01-05',
        end: '2026-02-05',
      },
      provenance: {
        kind: 'regenerated',
        reasonCode: 'source_rule_changed',
        sourceRuleVersion: 'contract-line-1:v2',
        sourceRunKey: 'regenerate-2026-01-02',
        supersedesRecordId: 'rsp-existing-1',
      },
    });
    expect(regenerationPlan.supersededRecords).toContainEqual(
      expect.objectContaining({
        recordId: 'rsp-existing-1',
        lifecycleState: 'superseded',
      }),
    );
    expect(regenerationPlan.activeRecords).toContainEqual(
      expect.objectContaining({
        recordId: 'rsp-existing-2',
        periodKey: 'slot-2',
      }),
    );
  });

  it('T289: regeneration preserves user-edited future service periods instead of silently overwriting them', () => {
    const userEdited = buildRecurringServicePeriodRecord({
      recordId: 'rsp-edited-1',
      periodKey: 'slot-1',
      lifecycleState: 'edited',
      provenance: {
        kind: 'user_edited',
        reasonCode: 'boundary_adjustment',
        sourceRuleVersion: 'contract-line-1:v1',
        supersedesRecordId: 'rsp-original-1',
      },
      servicePeriod: {
        start: '2026-01-03',
        end: '2026-02-03',
        semantics: 'half_open',
      },
      invoiceWindow: {
        start: '2026-01-03',
        end: '2026-02-03',
        semantics: 'half_open',
      },
    });
    const candidateForSameSlot = buildRecurringServicePeriodRecord({
      recordId: 'rsp-candidate-1',
      periodKey: 'candidate-slot-1',
      servicePeriod: {
        start: '2026-01-05',
        end: '2026-02-05',
        semantics: 'half_open',
      },
      invoiceWindow: {
        start: '2026-01-05',
        end: '2026-02-05',
        semantics: 'half_open',
      },
    });

    const regenerationPlan = regenerateRecurringServicePeriods({
      existingRecords: [userEdited],
      candidateRecords: [candidateForSameSlot],
      regeneratedAt: '2026-01-02T12:00:00.000Z',
      sourceRuleVersion: 'contract-line-1:v2',
      sourceRunKey: 'regenerate-2026-01-02',
    });

    expect(regenerationPlan.preservedRecords).toEqual([userEdited]);
    expect(regenerationPlan.regeneratedRecords).toEqual([]);
    expect(regenerationPlan.supersededRecords).toEqual([]);
    expect(regenerationPlan.activeRecords).toEqual([userEdited]);
  });
});
