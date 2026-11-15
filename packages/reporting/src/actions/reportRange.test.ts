import { describe, expect, it } from 'vitest';
import {
  checkReportDateRange,
  clampReportRangeToToday,
  dayRangeConditionSql,
  inclusiveDayCount,
  rangeConditionSql,
  REPORT_RANGE_PROBLEMS,
  ReportRangeError,
  resolveReportRange,
  type ReportRangeProblem,
} from './reportRange';

function problemOf(run: () => unknown): ReportRangeProblem | null {
  try {
    run();
    return null;
  } catch (error) {
    expect(error).toBeInstanceOf(ReportRangeError);
    return (error as ReportRangeError).problem;
  }
}

describe('resolveReportRange', () => {
  it('keeps the rolling presets and defaults everything else to 30 days', () => {
    expect(resolveReportRange(7)).toEqual({ rangeDays: 7, range: null });
    expect(resolveReportRange(30)).toEqual({ rangeDays: 30, range: null });
    expect(resolveReportRange(90)).toEqual({ rangeDays: 90, range: null });
    expect(resolveReportRange()).toEqual({ rangeDays: 30, range: null });
    expect(resolveReportRange(null as any)).toEqual({ rangeDays: 30, range: null });
    // A day count nobody offers is not a window we promise to support.
    expect(resolveReportRange(45)).toEqual({ rangeDays: 30, range: null });
  });

  it('accepts a custom window and counts its days inclusively', () => {
    expect(resolveReportRange({ from: '2026-03-01', to: '2026-03-31' })).toEqual({
      rangeDays: 31,
      range: { from: '2026-03-01', to: '2026-03-31' },
    });
    // A single day is a legal window, not an empty one.
    expect(resolveReportRange({ from: '2026-03-01', to: '2026-03-01' })).toEqual({
      rangeDays: 1,
      range: { from: '2026-03-01', to: '2026-03-01' },
    });
  });

  it('counts a window that crosses a DST boundary in whole days', () => {
    // 2026-03-08 is a US spring-forward date; the window is still 10 days.
    expect(resolveReportRange({ from: '2026-03-05', to: '2026-03-14' }).rangeDays).toBe(10);
  });

  it('refuses a custom window it cannot read instead of reporting on 30 days', () => {
    expect(problemOf(() => resolveReportRange({ from: '03/01/2026', to: '2026-03-31' } as any))).toBe('malformed');
    expect(problemOf(() => resolveReportRange({ from: '2026-3-1', to: '2026-03-31' } as any))).toBe('malformed');
    expect(problemOf(() => resolveReportRange({ from: '2026-02-31', to: '2026-03-31' } as any))).toBe('malformed');
    expect(problemOf(() => resolveReportRange({ from: '2026-03-01', to: '' } as any))).toBe('malformed');
    expect(problemOf(() => resolveReportRange({ from: null, to: undefined } as any))).toBe('malformed');
    expect(
      problemOf(() => resolveReportRange({ from: "2026-03-01'; DROP TABLE tickets --", to: '2026-03-31' } as any)),
    ).toBe('malformed');
  });

  it('refuses a backwards window', () => {
    expect(problemOf(() => resolveReportRange({ from: '2026-03-31', to: '2026-03-01' }))).toBe('backwards');
  });

  it('refuses a window longer than a leap year', () => {
    // 366 days is the cap: 2024-01-01..2024-12-31 inclusive.
    expect(resolveReportRange({ from: '2024-01-01', to: '2024-12-31' })).toEqual({
      rangeDays: 366,
      range: { from: '2024-01-01', to: '2024-12-31' },
    });
    expect(problemOf(() => resolveReportRange({ from: '2024-01-01', to: '2025-01-01' }))).toBe('tooLong');
  });

  it('carries a catalogued message for every refusal', () => {
    const error = new ReportRangeError('tooLong');
    expect(error.message).toBe('A custom date range can cover at most 366 days.');
    expect(REPORT_RANGE_PROBLEMS.tooLong.template).toContain('{{maxDays}}');
    expect(REPORT_RANGE_PROBLEMS.tooLong.params).toEqual({ maxDays: 366 });
    for (const entry of Object.values(REPORT_RANGE_PROBLEMS)) {
      expect(entry.key).toMatch(/^errors\.report\.range\./);
    }
  });
});

describe('checkReportDateRange', () => {
  it('passes a valid window and names what is wrong with an invalid one', () => {
    expect(checkReportDateRange({ from: '2026-03-01', to: '2026-03-31' })).toBeNull();
    expect(checkReportDateRange({ from: '2026-03-31', to: '2026-03-01' })).toBe('backwards');
    expect(checkReportDateRange({ from: '2024-01-01', to: '2025-01-01' })).toBe('tooLong');
    expect(checkReportDateRange({ from: 'x', to: '2026-03-01' })).toBe('malformed');
  });

  it('checks for a future start only when told what today is', () => {
    expect(checkReportDateRange({ from: '2026-12-01', to: '2026-12-31' })).toBeNull();
    expect(checkReportDateRange({ from: '2026-12-01', to: '2026-12-31' }, '2026-11-13')).toBe('startsInFuture');
    // Starting today is fine, and so is ending in the future (it gets clamped).
    expect(checkReportDateRange({ from: '2026-11-13', to: '2026-12-31' }, '2026-11-13')).toBeNull();
  });
});

describe('clampReportRangeToToday', () => {
  it('leaves presets and past windows alone', () => {
    const preset = { rangeDays: 30, range: null };
    expect(clampReportRangeToToday(preset, '2026-11-13')).toBe(preset);
    const past = { rangeDays: 31, range: { from: '2026-03-01', to: '2026-03-31' } };
    expect(clampReportRangeToToday(past, '2026-11-13')).toBe(past);
  });

  it('cuts a future end back to today and recounts the days', () => {
    expect(
      clampReportRangeToToday({ rangeDays: 30, range: { from: '2026-11-01', to: '2026-11-30' } }, '2026-11-13'),
    ).toEqual({ rangeDays: 13, range: { from: '2026-11-01', to: '2026-11-13' } });
  });

  it('refuses a window that starts after today rather than reporting zero days', () => {
    expect(
      problemOf(() =>
        clampReportRangeToToday({ rangeDays: 30, range: { from: '2026-12-01', to: '2026-12-30' } }, '2026-11-13'),
      ),
    ).toBe('startsInFuture');
  });
});

describe('inclusiveDayCount', () => {
  it('counts both endpoints', () => {
    expect(inclusiveDayCount('2026-03-01', '2026-03-01')).toBe(1);
    expect(inclusiveDayCount('2026-03-01', '2026-03-31')).toBe(31);
  });

  it('is zero for an empty or unreadable window', () => {
    expect(inclusiveDayCount('2026-03-31', '2026-03-01')).toBe(0);
    expect(inclusiveDayCount('2026-03-01', 'tomorrow')).toBe(0);
  });
});

describe('rangeConditionSql', () => {
  it('keeps the rolling preset semantics, with the day count bound', () => {
    expect(rangeConditionSql('t.entered_at', { rangeDays: 90, range: null })).toEqual({
      sql: "(t.entered_at >= NOW() - (?::int * INTERVAL '1 day'))",
      bindings: [90],
    });
  });

  it('bounds a custom window by midnights in the viewer timezone', () => {
    const condition = rangeConditionSql(
      't.entered_at',
      { rangeDays: 31, range: { from: '2026-03-01', to: '2026-03-31' } },
      'America/New_York',
    );

    // Parenthesised, so dropping it beside an OR cannot change what it means.
    expect(condition.sql).toBe(
      '(t.entered_at >= ((?::date)::timestamp AT TIME ZONE ?) AND t.entered_at < ((?::date + 1)::timestamp AT TIME ZONE ?))',
    );
    expect(condition.bindings).toEqual(['2026-03-01', 'America/New_York', '2026-03-31', 'America/New_York']);
    // The dates and the zone never reach the SQL text.
    expect(condition.sql).not.toContain('2026-03-01');
    expect(condition.sql).not.toContain('New_York');
  });

  it('defaults to UTC days when no timezone is given', () => {
    const condition = rangeConditionSql('t.entered_at', { rangeDays: 1, range: { from: '2026-03-01', to: '2026-03-01' } });
    expect(condition.bindings).toEqual(['2026-03-01', 'UTC', '2026-03-01', 'UTC']);
  });
});

describe('dayRangeConditionSql', () => {
  it('compares calendar days directly for a custom window', () => {
    expect(
      dayRangeConditionSql('te.work_date', 'te.start_time', {
        rangeDays: 31,
        range: { from: '2026-03-01', to: '2026-03-31' },
      }),
    ).toEqual({
      sql: '(te.work_date >= ?::date AND te.work_date <= ?::date)',
      bindings: ['2026-03-01', '2026-03-31'],
    });
  });

  it('falls back to the rolling timestamp window for a preset', () => {
    expect(dayRangeConditionSql('te.work_date', 'te.start_time', { rangeDays: 7, range: null })).toEqual({
      sql: "(te.start_time >= NOW() - (?::int * INTERVAL '1 day'))",
      bindings: [7],
    });
  });
});
