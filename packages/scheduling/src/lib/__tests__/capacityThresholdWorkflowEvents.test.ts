import { describe, expect, it } from 'vitest';
import {
  didCrossThreshold,
  getOverlapHoursForUtcDate,
  getUtcDatesOverlappedByInterval,
} from '../capacityThresholdMath';

describe('capacityThresholdWorkflowEvents', () => {
  it('detects threshold crossings', () => {
    expect(didCrossThreshold({ capacityLimit: 8, previousBooked: 7.99, currentBooked: 8 })).toBe(true);
    expect(didCrossThreshold({ capacityLimit: 8, previousBooked: 8, currentBooked: 9 })).toBe(false);
    expect(didCrossThreshold({ capacityLimit: 0, previousBooked: 0, currentBooked: 10 })).toBe(false);
  });

  it('computes UTC dates overlapped by an interval', () => {
    const dates = getUtcDatesOverlappedByInterval(
      new Date('2026-01-24T23:00:00.000Z'),
      new Date('2026-01-25T01:00:00.000Z')
    );
    expect(dates).toEqual(['2026-01-24', '2026-01-25']);
  });

  it('computes per-day overlap hours', () => {
    const start = new Date('2026-01-24T23:00:00.000Z');
    const end = new Date('2026-01-25T01:00:00.000Z');
    expect(getOverlapHoursForUtcDate(start, end, '2026-01-24')).toBeCloseTo(1, 6);
    expect(getOverlapHoursForUtcDate(start, end, '2026-01-25')).toBeCloseTo(1, 6);
  });
});
