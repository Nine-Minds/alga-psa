import { describe, expect, it } from 'vitest';

import { editRecurringServicePeriodBoundaries } from '@alga-psa/shared/billingClients/editRecurringServicePeriodBoundaries';
import { buildRecurringServicePeriodRecord } from '../../test-utils/recurringTimingFixtures';

describe('recurring service period boundary edits', () => {
  it('T345: boundary adjustment is the minimal v1 edit operation and creates an explicit edited revision', () => {
    const record = buildRecurringServicePeriodRecord({
      recordId: 'rsp_editable',
      periodKey: 'period:2026-04-10:2026-05-10',
      revision: 1,
      lifecycleState: 'generated',
      servicePeriod: {
        start: '2026-04-10',
        end: '2026-05-10',
        semantics: 'half_open',
      },
      invoiceWindow: {
        start: '2026-04-10',
        end: '2026-05-10',
        semantics: 'half_open',
      },
      activityWindow: {
        start: '2026-04-10',
        end: '2026-05-10',
        semantics: 'half_open',
      },
    });

    const result = editRecurringServicePeriodBoundaries({
      record,
      editedAt: '2026-03-18T15:00:00.000Z',
      sourceRuleVersion: 'contract-line-1:v2',
      sourceRunKey: 'edit-2026-03-18',
      updatedServicePeriod: {
        start: '2026-04-12',
        end: '2026-05-10',
        semantics: 'half_open',
      },
      updatedInvoiceWindow: {
        start: '2026-04-12',
        end: '2026-05-10',
        semantics: 'half_open',
      },
      updatedActivityWindow: {
        start: '2026-04-12',
        end: '2026-05-10',
        semantics: 'half_open',
      },
    });

    expect(result.supersededRecord).toMatchObject({
      recordId: 'rsp_editable',
      lifecycleState: 'superseded',
      updatedAt: '2026-03-18T15:00:00.000Z',
    });
    expect(result.editedRecord).toMatchObject({
      revision: 2,
      lifecycleState: 'edited',
      servicePeriod: {
        start: '2026-04-12',
        end: '2026-05-10',
      },
      invoiceWindow: {
        start: '2026-04-12',
        end: '2026-05-10',
      },
      provenance: {
        kind: 'user_edited',
        reasonCode: 'boundary_adjustment',
        sourceRuleVersion: 'contract-line-1:v2',
        sourceRunKey: 'edit-2026-03-18',
        supersedesRecordId: 'rsp_editable',
      },
      createdAt: '2026-03-18T15:00:00.000Z',
      updatedAt: '2026-03-18T15:00:00.000Z',
    });
    expect(result.editedRecord.recordId).toContain(':r2');
  });

  it('rejects immutable billed records and no-op edits', () => {
    expect(() =>
      editRecurringServicePeriodBoundaries({
        record: buildRecurringServicePeriodRecord({
          recordId: 'rsp_billed',
          lifecycleState: 'billed',
        }),
        editedAt: '2026-03-18T15:00:00.000Z',
        sourceRuleVersion: 'contract-line-1:v2',
        updatedServicePeriod: {
          start: '2026-04-12',
          end: '2026-05-10',
          semantics: 'half_open',
        },
      }),
    ).toThrow('Locked or billed service periods cannot be edited');

    expect(() =>
      editRecurringServicePeriodBoundaries({
        record: buildRecurringServicePeriodRecord({
          recordId: 'rsp_noop',
        }),
        editedAt: '2026-03-18T15:00:00.000Z',
        sourceRuleVersion: 'contract-line-1:v2',
      }),
    ).toThrow('Boundary adjustment must change at least one persisted boundary.');
  });
});
