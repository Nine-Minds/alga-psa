import { describe, expect, it } from 'vitest';
import { normalizeAnchorSettingsForCycle } from '@alga-psa/shared/billingClients/billingCycleAnchors';
import type { BillingCycleType } from '@alga-psa/types';
import { resolveFirstInvoiceDate, type FirstInvoiceClientSchedule } from './firstInvoiceDate';

function clientSchedule(
  billingCycle: BillingCycleType,
  anchor: Parameters<typeof normalizeAnchorSettingsForCycle>[1] = {},
): FirstInvoiceClientSchedule {
  return { billingCycle, anchor: normalizeAnchorSettingsForCycle(billingCycle, anchor) };
}

describe('resolveFirstInvoiceDate — contract cadence', () => {
  it('arrears: first invoice opens when the first service period ends', () => {
    expect(
      resolveFirstInvoiceDate({
        cadenceOwner: 'contract',
        billingTiming: 'arrears',
        billingFrequency: 'monthly',
        startDate: '2025-01-15',
      }),
    ).toEqual({
      status: 'date',
      scenario: 'contract_arrears',
      invoiceDate: '2025-02-15',
      servicePeriodStart: '2025-01-15',
      servicePeriodEnd: '2025-02-15',
    });
  });

  it('advance: first invoice opens on the contract start date', () => {
    expect(
      resolveFirstInvoiceDate({
        cadenceOwner: 'contract',
        billingTiming: 'advance',
        billingFrequency: 'monthly',
        startDate: '2025-01-15',
      }),
    ).toEqual({
      status: 'date',
      scenario: 'contract_advance',
      invoiceDate: '2025-01-15',
      servicePeriodStart: '2025-01-15',
      servicePeriodEnd: '2025-02-15',
    });
  });

  it.each([
    ['quarterly', '2025-01-31', '2025-04-30'],
    ['semi-annually', '2025-03-01', '2025-09-01'],
    ['annually', '2025-03-01', '2026-03-01'],
  ])('arrears %s period ends one full period after the start', (billingFrequency, startDate, invoiceDate) => {
    expect(
      resolveFirstInvoiceDate({
        cadenceOwner: 'contract',
        billingTiming: 'arrears',
        billingFrequency,
        startDate,
      }),
    ).toMatchObject({ status: 'date', invoiceDate, servicePeriodStart: startDate, servicePeriodEnd: invoiceDate });
  });

  it('defaults to monthly when no frequency is given', () => {
    expect(
      resolveFirstInvoiceDate({ cadenceOwner: 'contract', billingTiming: 'arrears', startDate: '2025-05-10' }),
    ).toMatchObject({ status: 'date', invoiceDate: '2025-06-10' });
  });

  it.each(['weekly', 'bi-weekly'])('does not guess a date for unsupported %s contract cadence', (billingFrequency) => {
    expect(
      resolveFirstInvoiceDate({
        cadenceOwner: 'contract',
        billingTiming: 'arrears',
        billingFrequency,
        startDate: '2025-01-15',
      }),
    ).toEqual({ status: 'unavailable', scenario: 'contract_arrears', reason: 'unsupported_frequency' });
  });
});

describe('resolveFirstInvoiceDate — client cadence', () => {
  it('arrears: first invoice opens at the end of the client billing period containing the start date', () => {
    expect(
      resolveFirstInvoiceDate({
        cadenceOwner: 'client',
        billingTiming: 'arrears',
        startDate: '2025-01-15',
        clientSchedule: clientSchedule('monthly'),
      }),
    ).toEqual({
      status: 'date',
      scenario: 'client_arrears',
      invoiceDate: '2025-02-01',
      // The covered part is clipped to the contract start.
      servicePeriodStart: '2025-01-15',
      servicePeriodEnd: '2025-02-01',
    });
  });

  it('arrears: a start date on a cycle boundary covers the whole period', () => {
    expect(
      resolveFirstInvoiceDate({
        cadenceOwner: 'client',
        billingTiming: 'arrears',
        startDate: '2025-02-01',
        clientSchedule: clientSchedule('monthly'),
      }),
    ).toMatchObject({ invoiceDate: '2025-03-01', servicePeriodStart: '2025-02-01', servicePeriodEnd: '2025-03-01' });
  });

  it('arrears: honours a non-default client anchor day', () => {
    expect(
      resolveFirstInvoiceDate({
        cadenceOwner: 'client',
        billingTiming: 'arrears',
        startDate: '2025-01-20',
        clientSchedule: clientSchedule('monthly', { dayOfMonth: 10 }),
      }),
    ).toMatchObject({ invoiceDate: '2025-02-10', servicePeriodStart: '2025-01-20', servicePeriodEnd: '2025-02-10' });
  });

  it('arrears: follows the client cycle length, not the line frequency', () => {
    expect(
      resolveFirstInvoiceDate({
        cadenceOwner: 'client',
        billingTiming: 'arrears',
        billingFrequency: 'monthly',
        startDate: '2025-02-10',
        clientSchedule: clientSchedule('quarterly'),
      }),
    ).toMatchObject({ invoiceDate: '2025-04-01', servicePeriodEnd: '2025-04-01' });
  });

  it('advance: the invoice window is the whole client billing period, which can open before the start date', () => {
    expect(
      resolveFirstInvoiceDate({
        cadenceOwner: 'client',
        billingTiming: 'advance',
        startDate: '2025-01-15',
        clientSchedule: clientSchedule('monthly'),
      }),
    ).toEqual({
      status: 'date',
      scenario: 'client_advance',
      invoiceDate: '2025-01-01',
      servicePeriodStart: '2025-01-15',
      servicePeriodEnd: '2025-02-01',
    });
  });

  it('advance: a start date on a cycle boundary invoices on that date', () => {
    expect(
      resolveFirstInvoiceDate({
        cadenceOwner: 'client',
        billingTiming: 'advance',
        startDate: '2025-02-01',
        clientSchedule: clientSchedule('monthly'),
      }),
    ).toMatchObject({ invoiceDate: '2025-02-01', servicePeriodStart: '2025-02-01' });
  });

  it.each([undefined, null])('shows no date while the client schedule is %s', (schedule) => {
    expect(
      resolveFirstInvoiceDate({
        cadenceOwner: 'client',
        billingTiming: 'arrears',
        startDate: '2025-01-15',
        clientSchedule: schedule,
      }),
    ).toEqual({ status: 'unavailable', scenario: 'client_arrears', reason: 'client_schedule_unavailable' });
  });
});

describe('resolveFirstInvoiceDate — inputs', () => {
  it.each(['', undefined, 'not-a-date', '15/01/2025'])('shows no date for start date %j', (startDate) => {
    expect(
      resolveFirstInvoiceDate({
        cadenceOwner: 'contract',
        billingTiming: 'arrears',
        billingFrequency: 'monthly',
        startDate,
      }),
    ).toEqual({ status: 'unavailable', scenario: 'contract_arrears', reason: 'missing_start_date' });
  });

  it('defaults to client cadence and arrears like the wizard does', () => {
    expect(resolveFirstInvoiceDate({ startDate: '2025-01-15', clientSchedule: clientSchedule('monthly') })).toMatchObject({
      scenario: 'client_arrears',
      invoiceDate: '2025-02-01',
    });
  });
});
