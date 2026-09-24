import { describe, expect, it } from 'vitest';

import {
  isValidDateOnly,
  normalizeContractLineDate,
  resolveContractLineBillingWindow,
} from '../src/lib/billing/contractLineWindow';
import { clipRecurringCandidatesToObligationBounds } from '@alga-psa/shared/billingClients/clipRecurringCandidatesToObligationBounds';

describe('resolveContractLineBillingWindow', () => {
  it('keeps the assignment window and anchor when the line has no authored dates', () => {
    expect(
      resolveContractLineBillingWindow(
        { start_date: '2026-01-01', end_date: '2026-12-31' },
        {},
      ),
    ).toEqual({
      anchorStart: '2026-01-01',
      coverageStart: '2026-01-01',
      inclusiveEnd: '2026-12-30',
      coverageEndExclusive: '2026-12-31',
    });
  });

  it('keeps an open-ended assignment open when the line has no end', () => {
    expect(
      resolveContractLineBillingWindow(
        { start_date: '2026-01-01', end_date: null },
        { start_date: '2026-03-01' },
      ),
    ).toEqual({
      anchorStart: '2026-01-01',
      coverageStart: '2026-03-01',
      inclusiveEnd: null,
      coverageEndExclusive: null,
    });
  });

  it('anchors on the assignment start even when the line starts later', () => {
    const window = resolveContractLineBillingWindow(
      { start_date: '2026-01-01', end_date: null },
      { start_date: '2026-01-15', end_date: null },
    );
    expect(window.anchorStart).toBe('2026-01-01');
    expect(window.coverageStart).toBe('2026-01-15');
  });

  it('treats an authored line end as half-open (no extra day)', () => {
    expect(
      resolveContractLineBillingWindow(
        { start_date: '2026-01-01', end_date: null },
        { start_date: '2026-01-01', end_date: '2026-01-31' },
      ),
    ).toEqual({
      anchorStart: '2026-01-01',
      coverageStart: '2026-01-01',
      inclusiveEnd: '2026-01-30',
      coverageEndExclusive: '2026-01-31',
    });
  });

  it('intersects both bounds and clamps an authored window past the assignment', () => {
    expect(
      resolveContractLineBillingWindow(
        { start_date: '2026-01-01', end_date: '2026-09-30' },
        { start_date: '2026-03-01', end_date: '2026-12-31' },
      ),
    ).toEqual({
      anchorStart: '2026-01-01',
      coverageStart: '2026-03-01',
      inclusiveEnd: '2026-09-29',
      coverageEndExclusive: '2026-09-30',
    });
  });

  it('produces an empty coverage window when the line is entirely after the assignment', () => {
    const window = resolveContractLineBillingWindow(
      { start_date: '2026-01-01', end_date: '2026-03-31' },
      { start_date: '2026-06-01', end_date: '2026-06-30' },
    );
    expect(window.coverageStart! >= window.coverageEndExclusive!).toBe(true);
  });

  it('agrees with the service-period materializer for a line ending at the contract end', () => {
    const assignment = { start_date: '2026-01-01', end_date: '2026-06-30' };
    const line = { start_date: '2026-01-01', end_date: '2026-06-30' };

    const window = resolveContractLineBillingWindow(assignment, line);
    const clipped = clipRecurringCandidatesToObligationBounds(
      [
        {
          servicePeriod: {
            start: '2026-06-01',
            end: '2026-07-01',
            semantics: 'half_open' as never,
          },
        } as never,
      ],
      window.anchorStart as never,
      window.coverageEndExclusive as never,
    );

    // Both paths stop at the same exclusive boundary and drop a period that
    // starts on it, so an authored line ending at the contract end cannot bill
    // past the line or the contract.
    expect(window.coverageEndExclusive).toBe('2026-06-30');
    expect(clipped).toHaveLength(1);
    expect(clipped[0].activityWindow).toEqual({
      start: '2026-06-01',
      end: '2026-06-30',
      semantics: 'half_open',
    });

    const dropped = clipRecurringCandidatesToObligationBounds(
      [
        {
          servicePeriod: {
            start: '2026-07-01',
            end: '2026-08-01',
            semantics: 'half_open' as never,
          },
        } as never,
      ],
      window.anchorStart as never,
      window.coverageEndExclusive as never,
    );
    expect(dropped).toHaveLength(0);
  });
});

describe('date-only validation', () => {
  it('rejects impossible calendar dates the regex would accept', () => {
    expect(isValidDateOnly('2026-02-30')).toBe(false);
    expect(isValidDateOnly('2026-13-01')).toBe(false);
    expect(isValidDateOnly('2026-00-10')).toBe(false);
    expect(isValidDateOnly('2026-2-3')).toBe(false);
    expect(isValidDateOnly('2026-02-28')).toBe(true);
  });

  it('normalizes timestamps and Date objects but rejects invalid dates', () => {
    expect(normalizeContractLineDate('2026-04-01T00:00:00.000Z')).toBe('2026-04-01');
    expect(normalizeContractLineDate(new Date(Date.UTC(2026, 3, 1)))).toBe('2026-04-01');
    expect(normalizeContractLineDate('2026-02-30')).toBeNull();
    expect(normalizeContractLineDate(null)).toBeNull();
  });
});
