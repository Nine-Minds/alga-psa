import { describe, expect, it } from 'vitest';

import { skipOrDeferRecurringServicePeriod } from '@alga-psa/shared/billingClients/skipOrDeferRecurringServicePeriod';
import { buildRecurringServicePeriodRecord } from '../../test-utils/recurringTimingFixtures';

describe('recurring service period skip and defer', () => {
  it('T346: skip and defer create explicit user-edited revisions without mutating the prior row in place', () => {
    const record = buildRecurringServicePeriodRecord({
      recordId: 'rsp_sched',
      periodKey: 'period:2026-05-10:2026-06-10',
      revision: 1,
      lifecycleState: 'generated',
      servicePeriod: {
        start: '2026-05-10',
        end: '2026-06-10',
        semantics: 'half_open',
      },
      invoiceWindow: {
        start: '2026-05-10',
        end: '2026-06-10',
        semantics: 'half_open',
      },
    });

    const skipped = skipOrDeferRecurringServicePeriod({
      record,
      operation: 'skip',
      editedAt: '2026-03-18T16:00:00.000Z',
      sourceRuleVersion: 'contract-line-1:v2',
      sourceRunKey: 'skip-2026-03-18',
    });
    const deferred = skipOrDeferRecurringServicePeriod({
      record,
      operation: 'defer',
      editedAt: '2026-03-18T16:05:00.000Z',
      sourceRuleVersion: 'contract-line-1:v2',
      sourceRunKey: 'defer-2026-03-18',
      deferredInvoiceWindow: {
        start: '2026-06-10',
        end: '2026-07-10',
        semantics: 'half_open',
      },
    });

    expect(skipped.supersededRecord).toMatchObject({
      recordId: 'rsp_sched',
      lifecycleState: 'superseded',
    });
    expect(skipped.editedRecord).toMatchObject({
      revision: 2,
      lifecycleState: 'skipped',
      provenance: {
        kind: 'user_edited',
        reasonCode: 'skip',
        supersedesRecordId: 'rsp_sched',
      },
    });
    expect(deferred.editedRecord).toMatchObject({
      revision: 2,
      lifecycleState: 'edited',
      servicePeriod: {
        start: '2026-05-10',
        end: '2026-06-10',
      },
      invoiceWindow: {
        start: '2026-06-10',
        end: '2026-07-10',
      },
      provenance: {
        kind: 'user_edited',
        reasonCode: 'defer',
        supersedesRecordId: 'rsp_sched',
      },
    });
  });

  it('rejects immutable rows and missing or no-op defer targets', () => {
    expect(() =>
      skipOrDeferRecurringServicePeriod({
        record: buildRecurringServicePeriodRecord({
          recordId: 'rsp_locked',
          lifecycleState: 'locked',
        }),
        operation: 'skip',
        editedAt: '2026-03-18T16:00:00.000Z',
        sourceRuleVersion: 'contract-line-1:v2',
      }),
    ).toThrow('Locked or billed service periods cannot be edited, skipped, deferred, or regenerated in place.');

    expect(() =>
      skipOrDeferRecurringServicePeriod({
        record: buildRecurringServicePeriodRecord({
          recordId: 'rsp_missing_defer',
        }),
        operation: 'defer',
        editedAt: '2026-03-18T16:00:00.000Z',
        sourceRuleVersion: 'contract-line-1:v2',
      }),
    ).toThrow('requires an explicit deferred invoice window');

    expect(() =>
      skipOrDeferRecurringServicePeriod({
        record: buildRecurringServicePeriodRecord({
          recordId: 'rsp_noop_defer',
          invoiceWindow: {
            start: '2026-05-10',
            end: '2026-06-10',
            semantics: 'half_open',
          },
        }),
        operation: 'defer',
        editedAt: '2026-03-18T16:00:00.000Z',
        sourceRuleVersion: 'contract-line-1:v2',
        deferredInvoiceWindow: {
          start: '2026-05-10',
          end: '2026-06-10',
          semantics: 'half_open',
        },
      }),
    ).toThrow('Defer operation must move the invoice window.');
  });
});
