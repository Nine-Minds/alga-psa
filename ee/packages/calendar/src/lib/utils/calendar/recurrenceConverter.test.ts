import { describe, expect, it } from 'vitest';
import {
  convertRecurrenceLinesToPattern,
  convertRecurrencePatternToRRULE,
  convertRRULEToRecurrencePattern,
  isUnsupportedRecurrence,
} from './recurrenceConverter';

const START = new Date('2026-10-01T14:15:00Z');

function pattern(lines: string[] | string, timeZone?: string) {
  const conversion = convertRecurrenceLinesToPattern(lines, START, timeZone);
  if (!conversion || conversion.unsupported) {
    throw new Error(`Expected a supported pattern, got ${JSON.stringify(conversion)}`);
  }
  return conversion.pattern;
}

describe('convertRecurrenceLinesToPattern', () => {
  it('parses the production monthly first-Thursday series and round-trips it', () => {
    const parsed = pattern(['RRULE:FREQ=MONTHLY;BYDAY=1TH']);
    expect(parsed.frequency).toBe('monthly');
    expect(parsed.interval).toBe(1);
    // Monday = 0, so Thursday = 3.
    expect(parsed.daysOfWeek).toEqual([3]);
    expect(parsed.weekOfMonth).toBe(1);
    expect(convertRecurrencePatternToRRULE(parsed)).toBe('FREQ=MONTHLY;BYDAY=1TH');
  });

  it('parses a last-Friday series and round-trips the negative ordinal', () => {
    const parsed = pattern(['RRULE:FREQ=MONTHLY;BYDAY=-1FR']);
    expect(parsed.daysOfWeek).toEqual([4]);
    expect(parsed.weekOfMonth).toBe(-1);
    expect(convertRecurrencePatternToRRULE(parsed)).toBe('FREQ=MONTHLY;BYDAY=-1FR');
  });

  it('treats BYSETPOS=1;BYDAY=TH as the same nth-weekday rule', () => {
    const parsed = pattern(['RRULE:FREQ=MONTHLY;BYSETPOS=1;BYDAY=TH']);
    expect(parsed.daysOfWeek).toEqual([3]);
    expect(parsed.weekOfMonth).toBe(1);
  });

  it('parses a fortnightly Monday/Wednesday series with Monday = 0 numbering', () => {
    const parsed = pattern(['RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE']);
    expect(parsed.interval).toBe(2);
    expect(parsed.daysOfWeek).toEqual([0, 2]);
    expect(parsed.weekOfMonth).toBeUndefined();
    expect(parsed.workdaysOnly).toBeUndefined();
    expect(convertRecurrencePatternToRRULE(parsed)).toBe('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE');
  });

  it('parses COUNT', () => {
    expect(pattern(['RRULE:FREQ=DAILY;COUNT=5']).count).toBe(5);
  });

  it('parses UNTIL in both date and date-time forms', () => {
    expect(pattern(['RRULE:FREQ=WEEKLY;UNTIL=20270101']).endDate?.toISOString()).toBe(
      '2027-01-01T00:00:00.000Z'
    );
    expect(pattern(['RRULE:FREQ=WEEKLY;UNTIL=20270101T045959Z']).endDate?.toISOString()).toBe(
      '2027-01-01T04:59:59.000Z'
    );
  });

  it('parses BYMONTHDAY', () => {
    const parsed = pattern(['RRULE:FREQ=MONTHLY;BYMONTHDAY=15']);
    expect(parsed.dayOfMonth).toBe(15);
    expect(convertRecurrencePatternToRRULE(parsed)).toBe('FREQ=MONTHLY;BYMONTHDAY=15');
  });

  it('parses a yearly series on a fixed month and day', () => {
    const parsed = pattern(['RRULE:FREQ=YEARLY;BYMONTH=3;BYMONTHDAY=1']);
    expect(parsed.frequency).toBe('yearly');
    expect(parsed.monthOfYear).toBe(3);
    expect(parsed.dayOfMonth).toBe(1);
    expect(convertRecurrencePatternToRRULE(parsed)).toBe('FREQ=YEARLY;BYMONTHDAY=1;BYMONTH=3');
  });

  it('marks a full weekday series as workdaysOnly and round-trips it', () => {
    const parsed = pattern(['RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR']);
    expect(parsed.daysOfWeek).toEqual([0, 1, 2, 3, 4]);
    expect(parsed.workdaysOnly).toBe(true);
    expect(convertRecurrencePatternToRRULE(parsed)).toBe('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR');
  });

  it('collects EXDATE lines as exceptions', () => {
    const parsed = pattern([
      'RRULE:FREQ=MONTHLY;BYDAY=1TH',
      'EXDATE;TZID=America/New_York:20261203T101500',
      'EXDATE:20270107T151500Z',
    ]);
    expect(parsed.exceptions?.map((date) => date.toISOString())).toEqual([
      '2026-12-03T10:15:00.000Z',
      '2027-01-07T15:15:00.000Z',
    ]);
  });

  it('keeps reading the legacy inline EXDATE component Alga itself emits', () => {
    const parsed = pattern(['FREQ=MONTHLY;BYDAY=1TH;EXDATE=20261203T151500Z']);
    expect(parsed.exceptions?.map((date) => date.toISOString())).toEqual([
      '2026-12-03T15:15:00.000Z',
    ]);
  });

  it('records the series time zone when the provider supplies one', () => {
    expect(pattern(['RRULE:FREQ=MONTHLY;BYDAY=1TH'], 'America/New_York').timeZone).toBe(
      'America/New_York'
    );
  });

  it('ignores WKST', () => {
    const parsed = pattern(['RRULE:FREQ=WEEKLY;BYDAY=TU;WKST=SU']);
    expect(parsed.daysOfWeek).toEqual([1]);
  });

  it('returns null when there is no recurrence at all', () => {
    expect(convertRecurrenceLinesToPattern([], START)).toBeNull();
    expect(convertRecurrenceLinesToPattern(undefined, START)).toBeNull();
    expect(convertRecurrenceLinesToPattern(['EXDATE:20270107T151500Z'], START)).toBeNull();
  });

  describe('explicitly unsupported rules', () => {
    const cases: Array<[string, string[]]> = [
      ['RDATE', ['RRULE:FREQ=MONTHLY;BYDAY=1TH', 'RDATE:20270210T151500Z']],
      ['multiple RRULEs', ['RRULE:FREQ=MONTHLY;BYDAY=1TH', 'RRULE:FREQ=WEEKLY;BYDAY=MO']],
      ['hourly', ['RRULE:FREQ=HOURLY;INTERVAL=6']],
      ['minutely', ['RRULE:FREQ=MINUTELY;INTERVAL=30']],
      ['secondly', ['RRULE:FREQ=SECONDLY']],
      ['mixed ordinals', ['RRULE:FREQ=MONTHLY;BYDAY=1TH,2FR']],
      ['out-of-range ordinal', ['RRULE:FREQ=MONTHLY;BYDAY=-2FR']],
      ['multiple BYSETPOS', ['RRULE:FREQ=MONTHLY;BYSETPOS=1,3;BYDAY=TH']],
      ['BYSETPOS without BYDAY', ['RRULE:FREQ=MONTHLY;BYSETPOS=1']],
      ['multiple BYMONTHDAY', ['RRULE:FREQ=MONTHLY;BYMONTHDAY=1,15']],
      ['BYHOUR', ['RRULE:FREQ=DAILY;BYHOUR=9,17']],
    ];

    for (const [label, lines] of cases) {
      it(`reports ${label} as unsupported instead of an empty pattern`, () => {
        const conversion = convertRecurrenceLinesToPattern(lines, START);
        expect(isUnsupportedRecurrence(conversion)).toBe(true);
        expect((conversion as { reason: string }).reason).toBeTruthy();
        // Never a mangled pattern with an empty daysOfWeek.
        expect(conversion).not.toHaveProperty('pattern');
      });
    }

    it('resolves to null through the back-compatible single-RRULE helper', () => {
      expect(convertRRULEToRecurrencePattern('FREQ=HOURLY', START)).toBeNull();
      expect(convertRRULEToRecurrencePattern('', START)).toBeNull();
    });
  });

  it('never produces an empty daysOfWeek for an ordinal BYDAY (regression)', () => {
    const parsed = convertRRULEToRecurrencePattern('FREQ=MONTHLY;BYDAY=1TH', START);
    expect(parsed?.daysOfWeek).toEqual([3]);
  });
});
