import { describe, expect, it } from 'vitest';

import { editRecurringServicePeriodBoundaries } from '@alga-psa/shared/billingClients/editRecurringServicePeriodBoundaries';
import { buildRecurringServicePeriodRecord } from '../../test-utils/recurringTimingFixtures';

describe('recurring service period edit validation', () => {
  it('T298: user edits that create overlaps, gaps, or invalid continuity are rejected with clear validation', () => {
    const previousRecord = buildRecurringServicePeriodRecord({
      recordId: 'rsp_prev',
      periodKey: 'period:2026-04-10:2026-05-10',
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
    });
    const currentRecord = buildRecurringServicePeriodRecord({
      recordId: 'rsp_current',
      periodKey: 'period:2026-05-10:2026-06-10',
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
    const nextRecord = buildRecurringServicePeriodRecord({
      recordId: 'rsp_next',
      periodKey: 'period:2026-06-10:2026-07-10',
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
    });

    expect(() =>
      editRecurringServicePeriodBoundaries({
        record: currentRecord,
        siblingRecords: [previousRecord, currentRecord, nextRecord],
        editedAt: '2026-03-18T17:00:00.000Z',
        sourceRuleVersion: 'contract-line-1:v2',
        updatedServicePeriod: {
          start: '2026-05-12',
          end: '2026-06-10',
          semantics: 'half_open',
        },
        updatedActivityWindow: {
          start: '2026-05-12',
          end: '2026-06-10',
          semantics: 'half_open',
        },
      }),
    ).toThrow('Edit would create a service-period gap before period:2026-05-10:2026-06-10');

    expect(() =>
      editRecurringServicePeriodBoundaries({
        record: currentRecord,
        siblingRecords: [previousRecord, currentRecord, nextRecord],
        editedAt: '2026-03-18T17:05:00.000Z',
        sourceRuleVersion: 'contract-line-1:v2',
        updatedServicePeriod: {
          start: '2026-05-08',
          end: '2026-06-12',
          semantics: 'half_open',
        },
        updatedActivityWindow: {
          start: '2026-05-08',
          end: '2026-06-12',
          semantics: 'half_open',
        },
      }),
    ).toThrow('Edit would create a service-period overlap before period:2026-05-10:2026-06-10');

    expect(() =>
      editRecurringServicePeriodBoundaries({
        record: currentRecord,
        siblingRecords: [previousRecord, currentRecord, nextRecord],
        editedAt: '2026-03-18T17:10:00.000Z',
        sourceRuleVersion: 'contract-line-1:v2',
        updatedServicePeriod: {
          start: '2026-05-10',
          end: '2026-06-08',
          semantics: 'half_open',
        },
        updatedActivityWindow: {
          start: '2026-05-10',
          end: '2026-06-08',
          semantics: 'half_open',
        },
      }),
    ).toThrow('Edit would create a service-period gap after period:2026-05-10:2026-06-10');
  });
});
