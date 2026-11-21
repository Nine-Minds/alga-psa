import { describe, expect, it } from 'vitest';
import { formatZonedTime, instantAtZonedTime } from '../timeEntryPeriodSelection';

describe('instantAtZonedTime DST pinning', () => {
  it('moves a spring-forward gap time forward (Sydney 2026-10-04 02:30 -> 03:30 AEDT)', () => {
    const instant = instantAtZonedTime('2026-10-04', '02:30', 'Australia/Sydney');
    // 03:30 AEDT (+11:00) = 16:30Z the previous day.
    expect(instant.toISOString()).toBe('2026-10-03T16:30:00.000Z');
    expect(formatZonedTime(instant, 'Australia/Sydney')).toBe('03:30');
  });

  it('picks the earlier instant in a fall-back overlap (New York 2026-11-01 01:30 -> EDT)', () => {
    const instant = instantAtZonedTime('2026-11-01', '01:30', 'America/New_York');
    // Earlier offset is EDT (-04:00): 05:30Z (the later EST reading would be 06:30Z).
    expect(instant.toISOString()).toBe('2026-11-01T05:30:00.000Z');
  });
});
