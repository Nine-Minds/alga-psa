import { describe, expect, it } from 'vitest';
import type { IRecurringObligationRef } from '@alga-psa/types';
import {
  RECURRING_RANGE_SEMANTICS,
  type IRecurringActivityWindow,
} from '@alga-psa/types';
import {
  contractCadenceMonthlyBoundaryGenerator,
  generateAnnualContractCadenceServicePeriods,
  generateMonthlyContractCadenceServicePeriods,
  generateQuarterlyContractCadenceServicePeriods,
  generateSemiAnnualContractCadenceServicePeriods,
  resolveContractCadenceAnchorDate,
  resolveContractCadenceInvoiceWindowForServicePeriod,
} from '@alga-psa/shared/billingClients/contractCadenceServicePeriods';
import {
  resolveRecurringSettlementsForInvoiceWindow,
  selectDueServicePeriodsForInvoiceWindow,
} from '@alga-psa/shared/billingClients/recurringTiming';

const sourceObligation: IRecurringObligationRef = {
  obligationId: 'line-1',
  obligationType: 'contract_line',
  chargeFamily: 'fixed',
};

describe('contract cadence service periods', () => {
  it('T131: monthly contract-cadence generation emits assignment-anniversary service periods for a start date on the 8th', () => {
    const periods = generateMonthlyContractCadenceServicePeriods({
      rangeStart: '2026-01-15T00:00:00Z',
      rangeEnd: '2026-04-20T00:00:00Z',
      anchorDate: '2026-01-08T00:00:00Z',
      sourceObligation,
      duePosition: 'advance',
    });

    expect(periods.map(({ start, end, cadenceOwner, duePosition, timingMetadata }) => ({
      start,
      end,
      cadenceOwner,
      duePosition,
      anchorDate: timingMetadata?.anchorDate,
    }))).toEqual([
      {
        start: '2026-01-08T00:00:00Z',
        end: '2026-02-08T00:00:00Z',
        cadenceOwner: 'contract',
        duePosition: 'advance',
        anchorDate: '2026-01-08T00:00:00Z',
      },
      {
        start: '2026-02-08T00:00:00Z',
        end: '2026-03-08T00:00:00Z',
        cadenceOwner: 'contract',
        duePosition: 'advance',
        anchorDate: '2026-01-08T00:00:00Z',
      },
      {
        start: '2026-03-08T00:00:00Z',
        end: '2026-04-08T00:00:00Z',
        cadenceOwner: 'contract',
        duePosition: 'advance',
        anchorDate: '2026-01-08T00:00:00Z',
      },
      {
        start: '2026-04-08T00:00:00Z',
        end: '2026-05-08T00:00:00Z',
        cadenceOwner: 'contract',
        duePosition: 'advance',
        anchorDate: '2026-01-08T00:00:00Z',
      },
    ]);
  });

  it('requires an assignment-start anchor date for contract cadence generation', () => {
    expect(() =>
      contractCadenceMonthlyBoundaryGenerator.generate({
        cadenceOwner: 'contract',
        duePosition: 'advance',
        rangeStart: '2026-01-15T00:00:00Z',
        rangeEnd: '2026-04-20T00:00:00Z',
        sourceObligation,
      }),
    ).toThrow('Contract cadence generation requires anchorDate.');
  });

  it('T132: quarterly contract-cadence generation emits assignment-anniversary service periods across quarter boundaries', () => {
    const periods = generateQuarterlyContractCadenceServicePeriods({
      rangeStart: '2026-03-15T00:00:00Z',
      rangeEnd: '2026-12-20T00:00:00Z',
      anchorDate: '2026-02-08T00:00:00Z',
      sourceObligation,
      duePosition: 'arrears',
    });

    expect(periods.map(({ start, end }) => ({ start, end }))).toEqual([
      { start: '2026-02-08T00:00:00Z', end: '2026-05-08T00:00:00Z' },
      { start: '2026-05-08T00:00:00Z', end: '2026-08-08T00:00:00Z' },
      { start: '2026-08-08T00:00:00Z', end: '2026-11-08T00:00:00Z' },
      { start: '2026-11-08T00:00:00Z', end: '2027-02-08T00:00:00Z' },
    ]);
  });

  it('T133: semi-annual contract-cadence generation emits assignment-anniversary service periods across six-month boundaries', () => {
    const periods = generateSemiAnnualContractCadenceServicePeriods({
      rangeStart: '2026-06-10T00:00:00Z',
      rangeEnd: '2027-09-01T00:00:00Z',
      anchorDate: '2026-04-08T00:00:00Z',
      sourceObligation,
      duePosition: 'advance',
    });

    expect(periods.map(({ start, end }) => ({ start, end }))).toEqual([
      { start: '2026-04-08T00:00:00Z', end: '2026-10-08T00:00:00Z' },
      { start: '2026-10-08T00:00:00Z', end: '2027-04-08T00:00:00Z' },
      { start: '2027-04-08T00:00:00Z', end: '2027-10-08T00:00:00Z' },
    ]);
  });

  it('T134: annual contract-cadence generation emits assignment-anniversary service periods across yearly boundaries', () => {
    const periods = generateAnnualContractCadenceServicePeriods({
      rangeStart: '2027-03-01T00:00:00Z',
      rangeEnd: '2029-07-01T00:00:00Z',
      anchorDate: '2026-08-08T00:00:00Z',
      sourceObligation,
      duePosition: 'advance',
    });

    expect(periods.map(({ start, end }) => ({ start, end }))).toEqual([
      { start: '2026-08-08T00:00:00Z', end: '2027-08-08T00:00:00Z' },
      { start: '2027-08-08T00:00:00Z', end: '2028-08-08T00:00:00Z' },
      { start: '2028-08-08T00:00:00Z', end: '2029-08-08T00:00:00Z' },
    ]);
  });

  it('T135: future-start assignments under contract cadence do not emit service periods before the assignment starts', () => {
    const periods = generateMonthlyContractCadenceServicePeriods({
      rangeStart: '2026-01-01T00:00:00Z',
      rangeEnd: '2026-03-20T00:00:00Z',
      anchorDate: '2026-02-08T00:00:00Z',
      sourceObligation,
      duePosition: 'advance',
    });

    expect(periods.map(({ start, end }) => ({ start, end }))).toEqual([
      { start: '2026-02-08T00:00:00Z', end: '2026-03-08T00:00:00Z' },
      { start: '2026-03-08T00:00:00Z', end: '2026-04-08T00:00:00Z' },
    ]);
  });

  it('T136: renew-in-place preserves the prior anniversary anchor while renewed contracts reset to the new assignment start', () => {
    const preservedAnchor = resolveContractCadenceAnchorDate({
      assignmentStartDate: '2027-02-01T00:00:00Z',
      lifecycleMode: 'renew_in_place',
      previousAnchorDate: '2026-01-08T00:00:00Z',
    });
    const resetAnchor = resolveContractCadenceAnchorDate({
      assignmentStartDate: '2027-02-01T00:00:00Z',
      lifecycleMode: 'renewed_contract',
      previousAnchorDate: '2026-01-08T00:00:00Z',
    });

    expect(preservedAnchor).toBe('2026-01-08T00:00:00Z');
    expect(resetAnchor).toBe('2027-02-01T00:00:00Z');

    expect(
      generateMonthlyContractCadenceServicePeriods({
        rangeStart: '2027-02-10T00:00:00Z',
        rangeEnd: '2027-04-15T00:00:00Z',
        anchorDate: preservedAnchor,
        sourceObligation,
        duePosition: 'arrears',
      }).map(({ start, end }) => ({ start, end })),
    ).toEqual([
      { start: '2027-02-08T00:00:00Z', end: '2027-03-08T00:00:00Z' },
      { start: '2027-03-08T00:00:00Z', end: '2027-04-08T00:00:00Z' },
      { start: '2027-04-08T00:00:00Z', end: '2027-05-08T00:00:00Z' },
    ]);

    expect(
      generateMonthlyContractCadenceServicePeriods({
        rangeStart: '2027-02-10T00:00:00Z',
        rangeEnd: '2027-04-15T00:00:00Z',
        anchorDate: resetAnchor,
        sourceObligation,
        duePosition: 'arrears',
      }).map(({ start, end }) => ({ start, end })),
    ).toEqual([
      { start: '2027-02-01T00:00:00Z', end: '2027-03-01T00:00:00Z' },
      { start: '2027-03-01T00:00:00Z', end: '2027-04-01T00:00:00Z' },
      { start: '2027-04-01T00:00:00Z', end: '2027-05-01T00:00:00Z' },
    ]);
  });

  it('T137: first invoice behavior for contract-cadence lines starting mid-client-cycle stays on the contract anniversary window, not the client billing cycle', () => {
    const anchorDate = '2026-02-08T00:00:00Z';
    const advancePeriods = generateMonthlyContractCadenceServicePeriods({
      rangeStart: '2026-02-01T00:00:00Z',
      rangeEnd: '2026-05-01T00:00:00Z',
      anchorDate,
      sourceObligation,
      duePosition: 'advance',
    });
    const firstAdvancePeriod = advancePeriods[0]!;
    const firstAdvanceInvoiceWindow = resolveContractCadenceInvoiceWindowForServicePeriod({
      servicePeriod: firstAdvancePeriod,
      anchorDate,
      monthsPerPeriod: 1,
      windowId: 'contract-advance-feb-8',
    });

    expect(firstAdvanceInvoiceWindow).toMatchObject({
      cadenceOwner: 'contract',
      duePosition: 'advance',
      start: '2026-02-08T00:00:00Z',
      end: '2026-03-08T00:00:00Z',
      windowId: 'contract-advance-feb-8',
    });
    expect(firstAdvanceInvoiceWindow.start).not.toBe('2026-02-01T00:00:00Z');

    expect(
      selectDueServicePeriodsForInvoiceWindow(advancePeriods, {
        duePosition: 'advance',
        invoiceWindow: firstAdvanceInvoiceWindow,
      }).map(({ servicePeriod, invoiceWindow }) => ({
        servicePeriodStart: servicePeriod.start,
        servicePeriodEnd: servicePeriod.end,
        invoiceWindowStart: invoiceWindow.start,
        invoiceWindowEnd: invoiceWindow.end,
      })),
    ).toEqual([
      {
        servicePeriodStart: '2026-02-08T00:00:00Z',
        servicePeriodEnd: '2026-03-08T00:00:00Z',
        invoiceWindowStart: '2026-02-08T00:00:00Z',
        invoiceWindowEnd: '2026-03-08T00:00:00Z',
      },
    ]);

    const arrearsPeriods = generateMonthlyContractCadenceServicePeriods({
      rangeStart: '2026-02-01T00:00:00Z',
      rangeEnd: '2026-05-01T00:00:00Z',
      anchorDate,
      sourceObligation,
      duePosition: 'arrears',
    });
    const firstArrearsInvoiceWindow = resolveContractCadenceInvoiceWindowForServicePeriod({
      servicePeriod: arrearsPeriods[0]!,
      anchorDate,
      monthsPerPeriod: 1,
      windowId: 'contract-arrears-mar-8',
    });

    expect(firstArrearsInvoiceWindow).toMatchObject({
      cadenceOwner: 'contract',
      duePosition: 'arrears',
      start: '2026-03-08T00:00:00Z',
      end: '2026-04-08T00:00:00Z',
      windowId: 'contract-arrears-mar-8',
    });

    expect(
      selectDueServicePeriodsForInvoiceWindow(arrearsPeriods, {
        duePosition: 'arrears',
        invoiceWindow: firstArrearsInvoiceWindow,
      }).map(({ servicePeriod }) => ({
        start: servicePeriod.start,
        end: servicePeriod.end,
      })),
    ).toEqual([
      {
        start: '2026-02-08T00:00:00Z',
        end: '2026-03-08T00:00:00Z',
      },
    ]);
  });

  it('T138: final invoice behavior for contract-cadence lines ending mid-period stays on the contract-owned due window and settles partial coverage there', () => {
    const anchorDate = '2026-02-08T00:00:00Z';
    const activityWindow: IRecurringActivityWindow = {
      start: '2026-02-08T00:00:00Z',
      end: '2026-04-20T00:00:00Z',
      semantics: RECURRING_RANGE_SEMANTICS,
    };

    const advancePeriods = generateMonthlyContractCadenceServicePeriods({
      rangeStart: '2026-02-01T00:00:00Z',
      rangeEnd: '2026-06-15T00:00:00Z',
      anchorDate,
      sourceObligation,
      duePosition: 'advance',
    });
    const advanceFinalPeriod = advancePeriods.find(
      (period) => period.start === '2026-04-08T00:00:00Z',
    )!;
    const advanceFinalInvoiceWindow = resolveContractCadenceInvoiceWindowForServicePeriod({
      servicePeriod: advanceFinalPeriod,
      anchorDate,
      monthsPerPeriod: 1,
      windowId: 'contract-advance-apr-8',
    });

    expect(
      resolveRecurringSettlementsForInvoiceWindow({
        servicePeriods: advancePeriods,
        invoiceWindow: advanceFinalInvoiceWindow,
        activityWindow,
        duePosition: 'advance',
      }).map(({ servicePeriod, coveredServicePeriod, invoiceWindow }) => ({
        servicePeriodStart: servicePeriod.start,
        servicePeriodEnd: servicePeriod.end,
        coveredStart: coveredServicePeriod.start,
        coveredEnd: coveredServicePeriod.end,
        invoiceWindowStart: invoiceWindow.start,
        invoiceWindowEnd: invoiceWindow.end,
      })),
    ).toEqual([
      {
        servicePeriodStart: '2026-04-08T00:00:00Z',
        servicePeriodEnd: '2026-05-08T00:00:00Z',
        coveredStart: '2026-04-08T00:00:00Z',
        coveredEnd: '2026-04-20T00:00:00Z',
        invoiceWindowStart: '2026-04-08T00:00:00Z',
        invoiceWindowEnd: '2026-05-08T00:00:00Z',
      },
    ]);

    const arrearsPeriods = generateMonthlyContractCadenceServicePeriods({
      rangeStart: '2026-02-01T00:00:00Z',
      rangeEnd: '2026-06-15T00:00:00Z',
      anchorDate,
      sourceObligation,
      duePosition: 'arrears',
    });
    const arrearsFinalPeriod = arrearsPeriods.find(
      (period) => period.start === '2026-04-08T00:00:00Z',
    )!;
    const arrearsFinalInvoiceWindow = resolveContractCadenceInvoiceWindowForServicePeriod({
      servicePeriod: arrearsFinalPeriod,
      anchorDate,
      monthsPerPeriod: 1,
      windowId: 'contract-arrears-may-8',
    });

    expect(
      resolveRecurringSettlementsForInvoiceWindow({
        servicePeriods: arrearsPeriods,
        invoiceWindow: arrearsFinalInvoiceWindow,
        activityWindow,
        duePosition: 'arrears',
      }).map(({ servicePeriod, coveredServicePeriod, invoiceWindow }) => ({
        servicePeriodStart: servicePeriod.start,
        servicePeriodEnd: servicePeriod.end,
        coveredStart: coveredServicePeriod.start,
        coveredEnd: coveredServicePeriod.end,
        invoiceWindowStart: invoiceWindow.start,
        invoiceWindowEnd: invoiceWindow.end,
      })),
    ).toEqual([
      {
        servicePeriodStart: '2026-04-08T00:00:00Z',
        servicePeriodEnd: '2026-05-08T00:00:00Z',
        coveredStart: '2026-04-08T00:00:00Z',
        coveredEnd: '2026-04-20T00:00:00Z',
        invoiceWindowStart: '2026-05-08T00:00:00Z',
        invoiceWindowEnd: '2026-06-08T00:00:00Z',
      },
    ]);
  });
});
