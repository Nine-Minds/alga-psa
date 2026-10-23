import { describe, expect, it } from 'vitest';
import { adjustForNonBusinessDays } from '../adjustForNonBusinessDays';
import { createBusinessDayCalendar, buildFallbackBusinessDayCalendar } from '../../businessHours/businessDayCalendar';

const calendar = (holidays: Array<{ holiday_date: string; is_recurring?: boolean }> = []) =>
  buildFallbackBusinessDayCalendar(holidays.map((h) => ({ holiday_date: h.holiday_date, is_recurring: !!h.is_recurring })));

describe('adjustForNonBusinessDays', () => {
  it('keep leaves dates untouched', () => {
    // 2026-03-07 is a Saturday
    expect(adjustForNonBusinessDays(['2026-03-07'], 'keep', calendar())).toEqual([
      { nominal: '2026-03-07', due: '2026-03-07' },
    ]);
  });

  it('weekend → previous business day', () => {
    // Sat 03-07 → Fri 03-06, Sun 03-08 → Fri 03-06
    expect(adjustForNonBusinessDays(['2026-03-07'], 'previous', calendar())).toEqual([
      { nominal: '2026-03-07', due: '2026-03-06' },
    ]);
    expect(adjustForNonBusinessDays(['2026-03-08'], 'previous', calendar())).toEqual([
      { nominal: '2026-03-08', due: '2026-03-06' },
    ]);
  });

  it('weekend → next business day', () => {
    expect(adjustForNonBusinessDays(['2026-03-07'], 'next', calendar())).toEqual([
      { nominal: '2026-03-07', due: '2026-03-09' },
    ]);
    expect(adjustForNonBusinessDays(['2026-03-08'], 'next', calendar())).toEqual([
      { nominal: '2026-03-08', due: '2026-03-09' },
    ]);
  });

  it('business days are not moved', () => {
    expect(adjustForNonBusinessDays(['2026-03-04'], 'next', calendar())).toEqual([
      { nominal: '2026-03-04', due: '2026-03-04' },
    ]);
  });

  it('a Monday holiday with the next policy lands on Tuesday', () => {
    // 2026-05-25 is a Monday (Memorial Day)
    expect(
      adjustForNonBusinessDays(['2026-05-25'], 'next', calendar([{ holiday_date: '2026-05-25' }]))
    ).toEqual([{ nominal: '2026-05-25', due: '2026-05-26' }]);
  });

  it('a Monday holiday with the previous policy walks back over the weekend to Friday', () => {
    expect(
      adjustForNonBusinessDays(['2026-05-25'], 'previous', calendar([{ holiday_date: '2026-05-25' }]))
    ).toEqual([{ nominal: '2026-05-25', due: '2026-05-22' }]);
  });

  it('honours a recurring (month-day) holiday in any year', () => {
    // Jan 1 is a recurring holiday stored with a 2020 year; 2027-01-01 is a Friday.
    const cal = calendar([{ holiday_date: '2020-01-01', is_recurring: true }]);
    expect(adjustForNonBusinessDays(['2027-01-01'], 'next', cal)).toEqual([
      { nominal: '2027-01-01', due: '2027-01-04' },
    ]);
    expect(adjustForNonBusinessDays(['2027-01-01'], 'previous', cal)).toEqual([
      { nominal: '2027-01-01', due: '2026-12-31' },
    ]);
  });

  it('consecutive holidays are walked over', () => {
    const cal = calendar([{ holiday_date: '2026-12-24' }, { holiday_date: '2026-12-25' }]);
    // Thu 24th, Fri 25th are holidays; next from the 24th is Mon 28th
    expect(adjustForNonBusinessDays(['2026-12-24'], 'next', cal)).toEqual([
      { nominal: '2026-12-24', due: '2026-12-28' },
    ]);
  });

  it('collisions collapse to the earliest nominal date', () => {
    // Sat 03-07 and Sun 03-08 both move to Mon 03-09 with `next`, and Mon 03-09 itself is nominal too.
    expect(adjustForNonBusinessDays(['2026-03-08', '2026-03-07', '2026-03-09'], 'next', calendar())).toEqual([
      { nominal: '2026-03-07', due: '2026-03-09' },
    ]);
  });

  it('collapse also applies for previous (Sat + Sun → Fri)', () => {
    expect(adjustForNonBusinessDays(['2026-03-07', '2026-03-08'], 'previous', calendar())).toEqual([
      { nominal: '2026-03-07', due: '2026-03-06' },
    ]);
  });

  it('orders results by due date', () => {
    const result = adjustForNonBusinessDays(['2026-03-14', '2026-03-04'], 'next', calendar());
    expect(result.map((r) => r.due)).toEqual(['2026-03-04', '2026-03-16']);
  });

  it('throws when the calendar has no business day', () => {
    const noBusinessDays = createBusinessDayCalendar(
      { is24x7: false, entries: [], holidays: [] },
      { source: 'default_schedule', scheduleName: 'Closed', timezone: 'UTC' }
    );
    expect(() => adjustForNonBusinessDays(['2026-03-07'], 'next', noBusinessDays)).toThrow(/No business day found/);
    expect(() => adjustForNonBusinessDays(['2026-03-07'], 'previous', noBusinessDays)).toThrow(/No business day found/);
    // keep never consults the calendar
    expect(adjustForNonBusinessDays(['2026-03-07'], 'keep', noBusinessDays)).toHaveLength(1);
  });
});
