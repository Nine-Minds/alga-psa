import { describe, expect, it } from 'vitest';

import {
  normalizeContractLineDate,
  resolveEffectiveContractLineWindow,
} from '../src/lib/billing/contractLineWindow';

describe('resolveEffectiveContractLineWindow', () => {
  it('inherits the assignment window when the line has no authored dates', () => {
    expect(
      resolveEffectiveContractLineWindow(
        { start_date: '2026-01-01', end_date: '2026-12-31' },
        {},
      ),
    ).toEqual({ start_date: '2026-01-01', end_date: '2026-12-31' });
  });

  it('keeps an open-ended assignment open when the line has no end', () => {
    expect(
      resolveEffectiveContractLineWindow(
        { start_date: '2026-01-01', end_date: null },
        { start_date: '2026-03-01' },
      ),
    ).toEqual({ start_date: '2026-03-01', end_date: null });
  });

  it('takes the later start and earlier end (line inside assignment)', () => {
    expect(
      resolveEffectiveContractLineWindow(
        { start_date: '2026-01-01', end_date: '2026-12-31' },
        { start_date: '2026-04-01', end_date: '2026-09-30' },
      ),
    ).toEqual({ start_date: '2026-04-01', end_date: '2026-09-30' });
  });

  it('clamps an authored window that extends past the assignment', () => {
    expect(
      resolveEffectiveContractLineWindow(
        { start_date: '2026-03-01', end_date: '2026-09-30' },
        { start_date: '2026-01-01', end_date: '2026-12-31' },
      ),
    ).toEqual({ start_date: '2026-03-01', end_date: '2026-09-30' });
  });

  it('produces an inverted range when the line is entirely outside the assignment', () => {
    const after = resolveEffectiveContractLineWindow(
      { start_date: '2026-01-01', end_date: '2026-03-31' },
      { start_date: '2026-06-01', end_date: '2026-06-30' },
    );
    expect(after.start_date! > after.end_date!).toBe(true);

    const before = resolveEffectiveContractLineWindow(
      { start_date: '2026-06-01', end_date: '2026-12-31' },
      { start_date: '2026-01-01', end_date: '2026-03-31' },
    );
    expect(before.start_date! > before.end_date!).toBe(true);
  });

  it('treats a line ending exactly at the contract end as included', () => {
    expect(
      resolveEffectiveContractLineWindow(
        { start_date: '2026-01-01', end_date: '2026-09-30' },
        { start_date: '2026-01-01', end_date: '2026-09-30' },
      ),
    ).toEqual({ start_date: '2026-01-01', end_date: '2026-09-30' });
  });
});

describe('normalizeContractLineDate', () => {
  it('normalizes timestamps and Date objects to a date-only string', () => {
    expect(normalizeContractLineDate('2026-04-01T00:00:00.000Z')).toBe('2026-04-01');
    expect(normalizeContractLineDate(new Date(Date.UTC(2026, 3, 1)))).toBe('2026-04-01');
    expect(normalizeContractLineDate(null)).toBeNull();
  });
});
