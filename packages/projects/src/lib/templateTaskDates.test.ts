import { describe, expect, it } from 'vitest';

import {
  formatStartOffsetDays,
  parseStartOffsetDays,
  startOffsetDaysFromDates,
  templateTaskDates,
} from './templateTaskDates';

const day = (iso: string) => new Date(`${iso}T00:00:00`);

describe('startOffsetDaysFromDates', () => {
  it('counts days from the phase start, including zero', () => {
    expect(startOffsetDaysFromDates(day('2026-10-08'), day('2026-10-05'))).toBe(3);
    expect(startOffsetDaysFromDates(day('2026-10-05'), day('2026-10-05'))).toBe(0);
  });

  it('is null without both dates or when the task starts before its phase', () => {
    expect(startOffsetDaysFromDates(null, day('2026-10-05'))).toBeNull();
    expect(startOffsetDaysFromDates(day('2026-10-08'), null)).toBeNull();
    expect(startOffsetDaysFromDates(day('2026-10-01'), day('2026-10-05'))).toBeNull();
  });
});

describe('templateTaskDates', () => {
  const phaseStart = day('2026-10-05');

  it('places start and due from the phase start', () => {
    expect(templateTaskDates({ phaseStart, durationDays: 5, startOffsetDays: 2 })).toEqual({
      start_date: day('2026-10-07'),
      due_date: day('2026-10-10'),
    });
  });

  it('treats a zero offset as starting with the phase', () => {
    expect(templateTaskDates({ phaseStart, durationDays: 5, startOffsetDays: 0 }).start_date).toEqual(phaseStart);
  });

  it('leaves the start undated when the template has no offset', () => {
    expect(templateTaskDates({ phaseStart, durationDays: 5, startOffsetDays: null })).toEqual({
      start_date: null,
      due_date: day('2026-10-10'),
    });
  });

  it('keeps a start with no due date', () => {
    expect(templateTaskDates({ phaseStart, durationDays: null, startOffsetDays: 3 })).toEqual({
      start_date: day('2026-10-08'),
      due_date: null,
    });
  });

  it('drops a start that would fall after the due date', () => {
    expect(templateTaskDates({ phaseStart, durationDays: 2, startOffsetDays: 6 }).start_date).toBeNull();
  });

  it('dates nothing when the phase has no start', () => {
    expect(templateTaskDates({ phaseStart: null, durationDays: 5, startOffsetDays: 2 })).toEqual({
      start_date: null,
      due_date: null,
    });
  });

  it('round-trips an offset saved from a project', () => {
    const offset = startOffsetDaysFromDates(day('2026-10-09'), phaseStart);
    expect(templateTaskDates({ phaseStart, durationDays: 10, startOffsetDays: offset }).start_date).toEqual(day('2026-10-09'));
  });
});

describe('start offset form field', () => {
  it('reads blank as no start date and keeps zero as a real offset', () => {
    expect(parseStartOffsetDays('')).toBeNull();
    expect(parseStartOffsetDays('   ')).toBeNull();
    expect(parseStartOffsetDays(undefined)).toBeNull();
    expect(parseStartOffsetDays('0')).toBe(0);
    expect(parseStartOffsetDays('7')).toBe(7);
  });

  it('never stores a negative or non-numeric offset', () => {
    expect(parseStartOffsetDays('-3')).toBe(0);
    expect(parseStartOffsetDays('abc')).toBeNull();
    expect(parseStartOffsetDays('2.9')).toBe(2);
  });

  it('shows a stored zero rather than an empty field, and round-trips', () => {
    expect(formatStartOffsetDays(0)).toBe('0');
    expect(formatStartOffsetDays(null)).toBe('');
    expect(formatStartOffsetDays(undefined)).toBe('');
    for (const value of [0, 1, 14]) expect(parseStartOffsetDays(formatStartOffsetDays(value))).toBe(value);
    expect(parseStartOffsetDays(formatStartOffsetDays(null))).toBeNull();
  });
});
