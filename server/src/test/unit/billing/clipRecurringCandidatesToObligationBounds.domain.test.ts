import { describe, expect, it } from 'vitest';

import { clipRecurringCandidatesToObligationBounds } from '@alga-psa/shared/billingClients/clipRecurringCandidatesToObligationBounds';
import { buildRecurringServicePeriodRecord } from '../../test-utils/recurringTimingFixtures';

const buildRecord = (start: string, end: string, recordId = `${start}:${end}`) =>
  buildRecurringServicePeriodRecord({
    recordId,
    periodKey: `period:${start}:${end}`,
    servicePeriod: {
      start,
      end,
      semantics: 'half_open',
    },
    invoiceWindow: {
      start,
      end,
      semantics: 'half_open',
    },
    activityWindow: null,
  });

describe('clip recurring candidates to obligation bounds', () => {
  it('drops candidates wholly outside the half-open obligation range', () => {
    const before = buildRecord('2026-01-01', '2026-02-01', 'before');
    const overlapping = buildRecord('2026-02-01', '2026-03-01', 'overlapping');
    const startsAtEnd = buildRecord('2026-04-01', '2026-05-01', 'starts-at-end');
    const after = buildRecord('2026-05-01', '2026-06-01', 'after');

    const result = clipRecurringCandidatesToObligationBounds(
      [before, overlapping, startsAtEnd, after],
      '2026-02-01',
      '2026-04-01',
    );

    expect(result.map((record) => record.recordId)).toEqual(['overlapping']);
  });

  it('clips candidates that straddle the start, end, or both obligation bounds', () => {
    const startResult = clipRecurringCandidatesToObligationBounds(
      [buildRecord('2026-02-01', '2026-03-01')],
      '2026-02-10',
      null,
    );
    expect(startResult[0]?.activityWindow).toEqual({
      start: '2026-02-10',
      end: '2026-03-01',
      semantics: 'half_open',
    });

    const endResult = clipRecurringCandidatesToObligationBounds(
      [buildRecord('2026-02-01', '2026-03-01')],
      '2026-01-01',
      '2026-02-20',
    );
    expect(endResult[0]?.activityWindow).toEqual({
      start: '2026-02-01',
      end: '2026-02-20',
      semantics: 'half_open',
    });

    const bothResult = clipRecurringCandidatesToObligationBounds(
      [buildRecord('2026-02-01', '2026-03-01')],
      '2026-02-10',
      '2026-02-20',
    );
    expect(bothResult[0]?.activityWindow).toEqual({
      start: '2026-02-10',
      end: '2026-02-20',
      semantics: 'half_open',
    });
  });

  it('applies only the start bound when the obligation has no end', () => {
    const before = buildRecord('2026-01-01', '2026-02-01', 'before');
    const straddling = buildRecord('2026-02-01', '2026-03-01', 'straddling');
    const after = buildRecord('2026-03-01', '2026-04-01', 'after');

    const result = clipRecurringCandidatesToObligationBounds(
      [before, straddling, after],
      '2026-02-10',
      null,
    );

    expect(result.map((record) => record.recordId)).toEqual(['straddling', 'after']);
    expect(result[0]?.activityWindow?.start).toBe('2026-02-10');
    expect(result[1]).toBe(after);
    expect(result[1]?.activityWindow).toBeNull();
  });

  it('preserves untouched records and never emits an inverted activity window', () => {
    const untouched = buildRecord('2026-03-01', '2026-04-01', 'untouched');
    const straddlingEnd = buildRecord('2026-04-01', '2026-05-01', 'straddling-end');
    const whollyAfter = buildRecord('2026-05-01', '2026-06-01', 'wholly-after');

    const result = clipRecurringCandidatesToObligationBounds(
      [untouched, straddlingEnd, whollyAfter],
      '2026-02-01',
      '2026-04-15',
    );

    expect(result[0]).toBe(untouched);
    expect(result[0]?.activityWindow).toBeNull();
    expect(result).toHaveLength(2);
    for (const record of result) {
      if (record.activityWindow) {
        expect(record.activityWindow.start < record.activityWindow.end).toBe(true);
      }
    }
  });
});
