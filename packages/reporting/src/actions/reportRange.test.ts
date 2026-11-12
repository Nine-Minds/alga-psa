import { describe, expect, it } from 'vitest';
import {
  inclusiveDayCount,
  rangeConditionSql,
  resolveReportRange,
} from './reportRange';

describe('resolveReportRange', () => {
  it('keeps the rolling presets and defaults everything else to 30 days', () => {
    expect(resolveReportRange(7)).toEqual({ rangeDays: 7, range: null });
    expect(resolveReportRange(30)).toEqual({ rangeDays: 30, range: null });
    expect(resolveReportRange(90)).toEqual({ rangeDays: 90, range: null });
    expect(resolveReportRange()).toEqual({ rangeDays: 30, range: null });
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

  it('falls back to the preset for anything it cannot read as a window', () => {
    const fallback = { rangeDays: 30, range: null };
    expect(resolveReportRange({ from: '03/01/2026', to: '2026-03-31' } as any)).toEqual(fallback);
    expect(resolveReportRange({ from: '2026-3-1', to: '2026-03-31' } as any)).toEqual(fallback);
    expect(resolveReportRange({ from: '2026-02-31', to: '2026-03-31' } as any)).toEqual(fallback);
    expect(resolveReportRange({ from: '2026-03-01', to: '' } as any)).toEqual(fallback);
    expect(resolveReportRange({ from: null, to: undefined } as any)).toEqual(fallback);
    expect(resolveReportRange({ from: "2026-03-01'; DROP TABLE tickets --", to: '2026-03-31' } as any)).toEqual(fallback);
  });

  it('rejects a backwards window', () => {
    expect(resolveReportRange({ from: '2026-03-31', to: '2026-03-01' })).toEqual({ rangeDays: 30, range: null });
  });

  it('rejects a window longer than a leap year', () => {
    // 366 days is the cap: 2024-01-01..2024-12-31 inclusive.
    expect(resolveReportRange({ from: '2024-01-01', to: '2024-12-31' })).toEqual({
      rangeDays: 366,
      range: { from: '2024-01-01', to: '2024-12-31' },
    });
    expect(resolveReportRange({ from: '2024-01-01', to: '2025-01-01' })).toEqual({ rangeDays: 30, range: null });
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
  it('keeps the rolling preset semantics for a preset window', () => {
    expect(rangeConditionSql('t.entered_at', { rangeDays: 90, range: null })).toEqual({
      sql: "(t.entered_at >= NOW() - INTERVAL '90 days')",
      bindings: [],
    });
  });

  it('binds both bounds of a custom window and ends the day after `to`', () => {
    const condition = rangeConditionSql('t.entered_at', {
      rangeDays: 31,
      range: { from: '2026-03-01', to: '2026-03-31' },
    });

    // Parenthesised, so dropping it beside an OR cannot change what it means.
    expect(condition.sql).toBe(
      "(t.entered_at >= ?::date AND t.entered_at < ?::date + INTERVAL '1 day')",
    );
    expect(condition.bindings).toEqual(['2026-03-01', '2026-03-31']);
    // The dates never reach the SQL text.
    expect(condition.sql).not.toContain('2026-03-01');
  });
});
