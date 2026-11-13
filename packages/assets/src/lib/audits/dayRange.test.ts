/**
 * The audits list asks a calendar question of a timestamp column, so the picked
 * days become instants in the viewer's zone. TZ is pinned in-file because CI
 * runs UTC, where a bug that only shows up at an offset would pass.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dayRangeBounds, endOfDayIso, startOfDayIso } from './dayRange';

const originalTz = process.env.TZ;

beforeAll(() => {
  process.env.TZ = 'America/New_York';
});

afterAll(() => {
  process.env.TZ = originalTz;
});

describe('dayRange', () => {
  it('turns a picked day into its local midnight instant', () => {
    // 1 March 2026 00:00 in New York is 05:00 UTC (EST, UTC-5).
    expect(startOfDayIso(new Date(2026, 2, 1))).toBe('2026-03-01T05:00:00.000Z');
  });

  it('ends the day on its last millisecond, not the next midnight', () => {
    expect(endOfDayIso(new Date(2026, 2, 1))).toBe('2026-03-02T04:59:59.999Z');
  });

  it('resolves the offset per day, so a DST boundary stays a full day', () => {
    // US DST starts 8 March 2026: that local day is 23 hours long.
    const from = startOfDayIso(new Date(2026, 2, 8));
    const to = endOfDayIso(new Date(2026, 2, 8));

    expect(from).toBe('2026-03-08T05:00:00.000Z');
    expect(to).toBe('2026-03-09T03:59:59.999Z');
    expect(new Date(to).getTime() - new Date(from).getTime()).toBe(23 * 3_600_000 - 1);
  });

  it('leaves an open side open rather than inventing a bound', () => {
    expect(dayRangeBounds({ from: new Date(2026, 2, 1) })).toEqual({
      started_from: '2026-03-01T05:00:00.000Z',
    });
    expect(dayRangeBounds({ to: new Date(2026, 2, 1) })).toEqual({
      started_to: '2026-03-02T04:59:59.999Z',
    });
    expect(dayRangeBounds({})).toEqual({});
  });

  it('brackets a range from the first day start to the last day end', () => {
    expect(dayRangeBounds({ from: new Date(2026, 2, 1), to: new Date(2026, 2, 31) })).toEqual({
      started_from: '2026-03-01T05:00:00.000Z',
      started_to: '2026-04-01T03:59:59.999Z',
    });
  });
});
