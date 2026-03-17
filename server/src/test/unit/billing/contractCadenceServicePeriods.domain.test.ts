import { describe, expect, it } from 'vitest';
import type { IRecurringObligationRef } from '@alga-psa/types';
import {
  contractCadenceMonthlyBoundaryGenerator,
  generateAnnualContractCadenceServicePeriods,
  generateMonthlyContractCadenceServicePeriods,
  generateQuarterlyContractCadenceServicePeriods,
  generateSemiAnnualContractCadenceServicePeriods,
  resolveContractCadenceAnchorDate,
} from '@alga-psa/shared/billingClients/contractCadenceServicePeriods';

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
});
