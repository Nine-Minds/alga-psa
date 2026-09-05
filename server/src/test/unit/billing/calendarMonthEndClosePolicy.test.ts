import { describe, expect, it } from 'vitest';
import {
  evaluateCalendarMonthEndEarlyCloseEligibility,
} from '@alga-psa/shared/billingClients/calendarMonthEndClosePolicy';

const JUNE_2026 = {
  duePosition: 'arrears' as const,
  cadenceSource: 'client_schedule' as const,
  servicePeriodStart: '2026-06-01',
  servicePeriodEnd: '2026-07-01',
  invoiceWindowStart: '2026-07-01',
};

describe('evaluateCalendarMonthEndEarlyCloseEligibility', () => {
  it('is eligible on the final calendar day of the service period', () => {
    const result = evaluateCalendarMonthEndEarlyCloseEligibility({
      ...JUNE_2026,
      asOfDate: '2026-06-30',
    });
    expect(result).toEqual({
      eligible: true,
      reason: 'eligible',
      finalCalendarDay: '2026-06-30',
    });
  });

  it('rejects the day before the final calendar day', () => {
    const result = evaluateCalendarMonthEndEarlyCloseEligibility({
      ...JUNE_2026,
      asOfDate: '2026-06-29',
    });
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('not_final_calendar_day');
  });

  it('rejects after the final day (normal window path applies)', () => {
    // 2026-07-01 is when the June period's invoice window normally opens.
    const result = evaluateCalendarMonthEndEarlyCloseEligibility({
      ...JUNE_2026,
      asOfDate: '2026-07-01',
    });
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('not_final_calendar_day');
  });

  it('never applies to advance-billed periods', () => {
    const result = evaluateCalendarMonthEndEarlyCloseEligibility({
      ...JUNE_2026,
      duePosition: 'advance',
      asOfDate: '2026-06-30',
    });
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('not_arrears');
  });

  it('never applies to contract-anniversary (non-client-cadence) periods', () => {
    const result = evaluateCalendarMonthEndEarlyCloseEligibility({
      ...JUNE_2026,
      cadenceSource: 'contract_anniversary',
      asOfDate: '2026-06-30',
    });
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('not_client_cadence');
  });

  it('rejects anchored (non-calendar-month) service periods even on their last day', () => {
    const result = evaluateCalendarMonthEndEarlyCloseEligibility({
      duePosition: 'arrears',
      cadenceSource: 'client_schedule',
      servicePeriodStart: '2026-01-10',
      servicePeriodEnd: '2026-02-10',
      invoiceWindowStart: '2026-02-10',
      asOfDate: '2026-02-09',
    });
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('not_calendar_month_period');
  });

  it('rejects a period whose invoice window does not open the day after it ends', () => {
    const result = evaluateCalendarMonthEndEarlyCloseEligibility({
      ...JUNE_2026,
      invoiceWindowStart: '2026-07-05',
      asOfDate: '2026-06-30',
    });
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('window_does_not_open_next_day');
  });

  it('handles February in a non-leap year (final day is the 28th)', () => {
    const result = evaluateCalendarMonthEndEarlyCloseEligibility({
      duePosition: 'arrears',
      cadenceSource: 'client_schedule',
      servicePeriodStart: '2026-02-01',
      servicePeriodEnd: '2026-03-01',
      invoiceWindowStart: '2026-03-01',
      asOfDate: '2026-02-28',
    });
    expect(result.eligible).toBe(true);

    const tooEarly = evaluateCalendarMonthEndEarlyCloseEligibility({
      duePosition: 'arrears',
      cadenceSource: 'client_schedule',
      servicePeriodStart: '2026-02-01',
      servicePeriodEnd: '2026-03-01',
      invoiceWindowStart: '2026-03-01',
      asOfDate: '2026-02-27',
    });
    expect(tooEarly.eligible).toBe(false);
    expect(tooEarly.reason).toBe('not_final_calendar_day');
  });

  it('handles February in a leap year (final day is the 29th)', () => {
    const result = evaluateCalendarMonthEndEarlyCloseEligibility({
      duePosition: 'arrears',
      cadenceSource: 'client_schedule',
      servicePeriodStart: '2024-02-01',
      servicePeriodEnd: '2024-03-01',
      invoiceWindowStart: '2024-03-01',
      asOfDate: '2024-02-29',
    });
    expect(result.eligible).toBe(true);
    expect(result.finalCalendarDay).toBe('2024-02-29');
  });

  it('handles 30-day months (April) and 31-day months (March)', () => {
    const april = evaluateCalendarMonthEndEarlyCloseEligibility({
      duePosition: 'arrears',
      cadenceSource: 'client_schedule',
      servicePeriodStart: '2026-04-01',
      servicePeriodEnd: '2026-05-01',
      invoiceWindowStart: '2026-05-01',
      asOfDate: '2026-04-30',
    });
    expect(april.eligible).toBe(true);

    const mayFirst = evaluateCalendarMonthEndEarlyCloseEligibility({
      duePosition: 'arrears',
      cadenceSource: 'client_schedule',
      servicePeriodStart: '2026-04-01',
      servicePeriodEnd: '2026-05-01',
      invoiceWindowStart: '2026-05-01',
      asOfDate: '2026-05-01',
    });
    expect(mayFirst.eligible).toBe(false);

    const march = evaluateCalendarMonthEndEarlyCloseEligibility({
      duePosition: 'arrears',
      cadenceSource: 'client_schedule',
      servicePeriodStart: '2026-03-01',
      servicePeriodEnd: '2026-04-01',
      invoiceWindowStart: '2026-04-01',
      asOfDate: '2026-03-31',
    });
    expect(march.eligible).toBe(true);
  });

  it('resolves the local calendar date from an instant in the effective timezone', () => {
    // 2026-06-30T22:30Z is already 2026-07-01 in Europe/Berlin (UTC+2) but still
    // 2026-06-30 in Pacific/Honolulu (UTC-10). The naive UTC calendar would call
    // this June 30 and wrongly allow the close; the billing timezone decides.
    const instant = '2026-06-30T22:30:00.000Z';

    const berlin = evaluateCalendarMonthEndEarlyCloseEligibility({
      ...JUNE_2026,
      asOf: instant,
      timeZone: 'Europe/Berlin',
    });
    expect(berlin.eligible).toBe(false);
    expect(berlin.reason).toBe('not_final_calendar_day');

    const honolulu = evaluateCalendarMonthEndEarlyCloseEligibility({
      ...JUNE_2026,
      asOf: instant,
      timeZone: 'Pacific/Honolulu',
    });
    expect(honolulu.eligible).toBe(true);
  });

  it('is month-end in Australia/Sydney while UTC still reads the day before', () => {
    // Australia/Sydney in June is UTC+10 (AEST): 2026-06-29T15:00Z is already
    // 2026-06-30T01:00 in Sydney — the final calendar day of the June period —
    // but still 2026-06-29 in UTC. A host-UTC "today" would wrongly refuse the
    // close a Sydney tenant is entitled to.
    const instant = '2026-06-29T15:00:00.000Z';

    const sydney = evaluateCalendarMonthEndEarlyCloseEligibility({
      ...JUNE_2026,
      asOf: instant,
      timeZone: 'Australia/Sydney',
    });
    expect(sydney.eligible).toBe(true);

    const utc = evaluateCalendarMonthEndEarlyCloseEligibility({
      ...JUNE_2026,
      asOf: instant,
      timeZone: 'UTC',
    });
    expect(utc.eligible).toBe(false);
    expect(utc.reason).toBe('not_final_calendar_day');
  });

  it('is NOT month-end in Australia/Sydney once UTC has reached the final day', () => {
    // 2026-06-30T15:00Z is 2026-07-01T01:00 in Sydney — the window has opened
    // there, so the manual close is refused — while UTC still reads June 30 and
    // a naive UTC calendar would wrongly offer it.
    const instant = '2026-06-30T15:00:00.000Z';

    const sydney = evaluateCalendarMonthEndEarlyCloseEligibility({
      ...JUNE_2026,
      asOf: instant,
      timeZone: 'Australia/Sydney',
    });
    expect(sydney.eligible).toBe(false);
    expect(sydney.reason).toBe('not_final_calendar_day');

    // Same instant resolved to UTC is the final calendar day (eligible on the
    // naive clock) — demonstrating why the billing timezone must decide.
    const utc = evaluateCalendarMonthEndEarlyCloseEligibility({
      ...JUNE_2026,
      asOf: instant,
      timeZone: 'UTC',
    });
    expect(utc.eligible).toBe(true);
  });

  it('falls back to UTC when no instant is provided and no asOfDate is set', () => {
    const result = evaluateCalendarMonthEndEarlyCloseEligibility({ ...JUNE_2026 });
    expect(result.eligible).toBe(false);
    expect(result.reason).toBe('not_final_calendar_day');
  });
});
