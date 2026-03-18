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

  it('T015: regeneration preserves edited and billed override records while refreshing untouched future rows', () => {
    const editedOverride = buildRecurringServicePeriodRecord({
      recordId: 'rsp-edited-1',
      periodKey: 'slot-1',
      lifecycleState: 'edited',
      provenance: {
        kind: 'user_edited',
        reasonCode: 'boundary_adjustment',
        sourceRuleVersion: 'contract-line-1:v1',
        sourceRunKey: 'edit-1',
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
      activityWindow: {
        start: '2026-01-03',
        end: '2026-02-03',
        semantics: 'half_open',
      },
    });
    const billedOverride = buildRecurringServicePeriodRecord({
      recordId: 'rsp-billed-1',
      periodKey: 'slot-2',
      lifecycleState: 'billed',
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
      activityWindow: {
        start: '2026-02-01',
        end: '2026-03-01',
        semantics: 'half_open',
      },
      invoiceLinkage: {
        invoiceId: 'invoice-1',
        invoiceChargeId: 'charge-1',
        invoiceChargeDetailId: 'detail-1',
        linkedAt: '2026-03-01T12:00:00.000Z',
      },
    });
    const untouchedFuture = buildRecurringServicePeriodRecord({
      recordId: 'rsp-generated-1',
      periodKey: 'slot-3',
      revision: 1,
      servicePeriod: {
        start: '2026-03-01',
        end: '2026-04-01',
        semantics: 'half_open',
      },
      invoiceWindow: {
        start: '2026-03-01',
        end: '2026-04-01',
        semantics: 'half_open',
      },
      activityWindow: {
        start: '2026-03-01',
        end: '2026-04-01',
        semantics: 'half_open',
      },
    });

    const regenerationPlan = regenerateRecurringServicePeriods({
      existingRecords: [editedOverride, billedOverride, untouchedFuture],
      candidateRecords: [
        buildRecurringServicePeriodRecord({
          recordId: 'rsp-candidate-1',
          periodKey: 'candidate-slot-1',
          servicePeriod: editedOverride.servicePeriod,
          invoiceWindow: editedOverride.invoiceWindow,
          activityWindow: editedOverride.activityWindow,
        }),
        buildRecurringServicePeriodRecord({
          recordId: 'rsp-candidate-2',
          periodKey: 'candidate-slot-2',
          servicePeriod: billedOverride.servicePeriod,
          invoiceWindow: billedOverride.invoiceWindow,
          activityWindow: billedOverride.activityWindow,
        }),
        buildRecurringServicePeriodRecord({
          recordId: 'rsp-candidate-3',
          periodKey: 'candidate-slot-3',
          servicePeriod: {
            start: '2026-03-05',
            end: '2026-04-05',
            semantics: 'half_open',
          },
          invoiceWindow: {
            start: '2026-03-05',
            end: '2026-04-05',
            semantics: 'half_open',
          },
          activityWindow: {
            start: '2026-03-05',
            end: '2026-04-05',
            semantics: 'half_open',
          },
        }),
      ],
      regeneratedAt: '2026-01-02T12:00:00.000Z',
      sourceRuleVersion: 'contract-line-1:v2',
      sourceRunKey: 'regenerate-2026-01-02',
    });

    expect(regenerationPlan.conflicts).toEqual([]);
    expect(regenerationPlan.preservedRecords).toEqual([editedOverride, billedOverride]);
    expect(regenerationPlan.regeneratedRecords).toHaveLength(1);
    expect(regenerationPlan.regeneratedRecords[0]).toMatchObject({
      periodKey: 'slot-3',
      revision: 2,
      servicePeriod: {
        start: '2026-03-05',
        end: '2026-04-05',
      },
      provenance: {
        kind: 'regenerated',
        supersedesRecordId: 'rsp-generated-1',
      },
    });
    expect(regenerationPlan.supersededRecords).toContainEqual(
      expect.objectContaining({
        recordId: 'rsp-generated-1',
        lifecycleState: 'superseded',
      }),
    );
    expect(regenerationPlan.activeRecords).toEqual([
      editedOverride,
      billedOverride,
      expect.objectContaining({
        periodKey: 'slot-3',
        revision: 2,
      }),
    ]);
  });
});
