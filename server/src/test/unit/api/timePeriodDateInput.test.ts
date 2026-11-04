import { describe, expect, it } from 'vitest';
import {
  createTimePeriodSchema,
  timePeriodDateInputSchema,
  updateTimePeriodSchema,
} from '../../../lib/api/schemas/timeSheet';

describe('timePeriodDateInputSchema', () => {
  it('accepts YYYY-MM-DD unchanged', () => {
    expect(timePeriodDateInputSchema.parse('2026-08-16')).toBe('2026-08-16');
  });

  it('truncates RFC 3339 datetimes textually (not via UTC conversion)', () => {
    expect(timePeriodDateInputSchema.parse('2026-08-16T23:30:00-05:00')).toBe('2026-08-16');
    expect(timePeriodDateInputSchema.parse('2026-08-16T00:00:00Z')).toBe('2026-08-16');
    expect(timePeriodDateInputSchema.parse('2026-08-16T04:00:00.000Z')).toBe('2026-08-16');
  });

  it.each(['garbage', '', '2026-8-16', '20260816', '2026-02-30', '2026-13-01', '2026-08-16 10:00:00', '2026-08-16T10:00:00'])(
    'rejects %j',
    (value) => {
      expect(timePeriodDateInputSchema.safeParse(value).success).toBe(false);
    }
  );

  it('rejects non-strings', () => {
    expect(timePeriodDateInputSchema.safeParse(20260816).success).toBe(false);
    expect(timePeriodDateInputSchema.safeParse(null).success).toBe(false);
  });
});

describe('createTimePeriodSchema', () => {
  it('requires both dates and gives is_current no default', () => {
    expect(createTimePeriodSchema.safeParse({ start_date: '2026-08-16' }).success).toBe(false);
    const parsed = createTimePeriodSchema.parse({ start_date: '2026-08-16', end_date: '2026-08-23' });
    expect(parsed).toEqual({ start_date: '2026-08-16', end_date: '2026-08-23' });
    expect('is_current' in parsed).toBe(false);
  });

  it('accepts and passes through is_current without defaulting it', () => {
    const parsed = createTimePeriodSchema.parse({ start_date: '2026-08-16', end_date: '2026-08-23', is_current: true });
    expect(parsed.is_current).toBe(true);
  });

  it('requires start_date < end_date', () => {
    expect(createTimePeriodSchema.safeParse({ start_date: '2026-08-23', end_date: '2026-08-23' }).success).toBe(false);
    expect(createTimePeriodSchema.safeParse({ start_date: '2026-08-24', end_date: '2026-08-23' }).success).toBe(false);
  });

  it('compares after normalizing datetimes', () => {
    const parsed = createTimePeriodSchema.parse({
      start_date: '2026-08-16T23:30:00-05:00',
      end_date: '2026-08-23T00:00:00Z',
    });
    expect(parsed).toEqual({ start_date: '2026-08-16', end_date: '2026-08-23' });
  });
});

describe('updateTimePeriodSchema', () => {
  it('allows partial bodies and an empty body', () => {
    expect(updateTimePeriodSchema.parse({})).toEqual({});
    expect(updateTimePeriodSchema.parse({ end_date: '2026-08-23' })).toEqual({ end_date: '2026-08-23' });
    expect(updateTimePeriodSchema.parse({ is_current: true })).toEqual({ is_current: true });
  });

  it('only compares dates when both are present', () => {
    expect(updateTimePeriodSchema.safeParse({ start_date: '2026-08-24', end_date: '2026-08-23' }).success).toBe(false);
    expect(updateTimePeriodSchema.safeParse({ start_date: '2026-08-24' }).success).toBe(true);
  });
});
