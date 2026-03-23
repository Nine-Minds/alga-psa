import { describe, expect, it } from 'vitest';
import type { IRecurringObligationRef } from '@alga-psa/types';
import { generateClientCadenceServicePeriods } from '@alga-psa/shared/billingClients/clientCadenceServicePeriods';

const sourceObligation: IRecurringObligationRef = {
  obligationId: 'line-1',
  obligationType: 'contract_line',
  chargeFamily: 'fixed',
};

describe('client cadence service periods', () => {
  it('T021: monthly generation reproduces current anchored periods for a mid-month anchor', () => {
    const periods = generateClientCadenceServicePeriods({
      billingCycle: 'monthly',
      rangeStart: '2026-01-09T00:00:00Z',
      rangeEnd: '2026-03-15T00:00:00Z',
      anchorSettings: { dayOfMonth: 10 },
      sourceObligation,
      duePosition: 'advance',
    });

    expect(periods.slice(0, 3).map(({ start, end }) => ({ start, end }))).toEqual([
      { start: '2025-12-10T00:00:00Z', end: '2026-01-10T00:00:00Z' },
      { start: '2026-01-10T00:00:00Z', end: '2026-02-10T00:00:00Z' },
      { start: '2026-02-10T00:00:00Z', end: '2026-03-10T00:00:00Z' },
    ]);
  });

  it('T022: monthly generation reproduces calendar-boundary periods when no custom anchor exists', () => {
    const periods = generateClientCadenceServicePeriods({
      billingCycle: 'monthly',
      rangeStart: '2026-01-09T00:00:00Z',
      rangeEnd: '2026-02-15T00:00:00Z',
      sourceObligation,
      duePosition: 'advance',
    });

    expect(periods[0]).toMatchObject({
      start: '2026-01-01T00:00:00Z',
      end: '2026-02-01T00:00:00Z',
    });
  });

  it('T023: quarterly generation reproduces current anchor month and day behavior', () => {
    const periods = generateClientCadenceServicePeriods({
      billingCycle: 'quarterly',
      rangeStart: '2026-05-01T00:00:00Z',
      rangeEnd: '2026-08-01T00:00:00Z',
      anchorSettings: { monthOfYear: 1, dayOfMonth: 10 },
      sourceObligation,
      duePosition: 'advance',
    });

    expect(periods[0]).toMatchObject({
      start: '2026-04-10T00:00:00Z',
      end: '2026-07-10T00:00:00Z',
    });
  });

  it('T024: semi-annual generation reproduces current anchor month and day behavior', () => {
    const periods = generateClientCadenceServicePeriods({
      billingCycle: 'semi-annually',
      rangeStart: '2026-05-01T00:00:00Z',
      rangeEnd: '2026-08-01T00:00:00Z',
      anchorSettings: { monthOfYear: 1, dayOfMonth: 10 },
      sourceObligation,
      duePosition: 'advance',
    });

    expect(periods[0]).toMatchObject({
      start: '2026-01-10T00:00:00Z',
      end: '2026-07-10T00:00:00Z',
    });
  });

  it('T025: annual generation reproduces current anchor month and day behavior', () => {
    const periods = generateClientCadenceServicePeriods({
      billingCycle: 'annually',
      rangeStart: '2026-05-01T00:00:00Z',
      rangeEnd: '2027-06-01T00:00:00Z',
      anchorSettings: { monthOfYear: 2, dayOfMonth: 10 },
      sourceObligation,
      duePosition: 'advance',
    });

    expect(periods[0]).toMatchObject({
      start: '2026-02-10T00:00:00Z',
      end: '2027-02-10T00:00:00Z',
    });
  });

  it('T026: weekly generation preserves [start, end) semantics', () => {
    const periods = generateClientCadenceServicePeriods({
      billingCycle: 'weekly',
      rangeStart: '2026-01-07T00:00:00Z',
      rangeEnd: '2026-01-20T00:00:00Z',
      anchorSettings: { dayOfWeek: 1 },
      sourceObligation,
      duePosition: 'advance',
    });

    expect(periods[0]).toMatchObject({
      start: '2026-01-05T00:00:00Z',
      end: '2026-01-12T00:00:00Z',
    });
    expect(periods[1]).toMatchObject({
      start: '2026-01-12T00:00:00Z',
      end: '2026-01-19T00:00:00Z',
    });
  });

  it('T027: bi-weekly generation preserves [start, end) semantics', () => {
    const periods = generateClientCadenceServicePeriods({
      billingCycle: 'bi-weekly',
      rangeStart: '2026-01-20T00:00:00Z',
      rangeEnd: '2026-02-15T00:00:00Z',
      anchorSettings: { referenceDate: '2026-01-02T00:00:00Z' },
      sourceObligation,
      duePosition: 'advance',
    });

    expect(periods[0]).toMatchObject({
      start: '2026-01-16T00:00:00Z',
      end: '2026-01-30T00:00:00Z',
    });
  });

  it('T028: anchor changes preserve current transition-period behavior on future cycles', () => {
    const periods = generateClientCadenceServicePeriods({
      billingCycle: 'monthly',
      rangeStart: '2026-01-01T00:00:00Z',
      rangeEnd: '2026-02-15T00:00:00Z',
      anchorSettings: { dayOfMonth: 10 },
      historicalCycles: [
        { start: '2025-12-01T00:00:00Z', end: '2026-01-01T00:00:00Z' },
      ],
      sourceObligation,
      duePosition: 'advance',
    });

    expect(periods.slice(0, 2).map(({ start, end }) => ({ start, end }))).toEqual([
      { start: '2026-01-01T00:00:00Z', end: '2026-01-10T00:00:00Z' },
      { start: '2026-01-10T00:00:00Z', end: '2026-02-10T00:00:00Z' },
    ]);
  });

  it('T029: historical billing cycles remain deterministic when settings changed later', () => {
    const periods = generateClientCadenceServicePeriods({
      billingCycle: 'monthly',
      rangeStart: '2026-01-15T00:00:00Z',
      rangeEnd: '2026-04-15T00:00:00Z',
      anchorSettings: { dayOfMonth: 10 },
      historicalCycles: [
        { start: '2026-01-01T00:00:00Z', end: '2026-02-01T00:00:00Z' },
        { start: '2026-02-01T00:00:00Z', end: '2026-03-01T00:00:00Z' },
      ],
      sourceObligation,
      duePosition: 'advance',
    });

    expect(periods.map(({ start, end }) => ({ start, end }))).toEqual([
      { start: '2026-01-01T00:00:00Z', end: '2026-02-01T00:00:00Z' },
      { start: '2026-02-01T00:00:00Z', end: '2026-03-01T00:00:00Z' },
      { start: '2026-03-01T00:00:00Z', end: '2026-03-10T00:00:00Z' },
      { start: '2026-03-10T00:00:00Z', end: '2026-04-10T00:00:00Z' },
      { start: '2026-04-10T00:00:00Z', end: '2026-05-10T00:00:00Z' },
    ]);
  });

  it('T030: partial historical cycle data falls back without generating overlaps', () => {
    const periods = generateClientCadenceServicePeriods({
      billingCycle: 'monthly',
      rangeStart: '2026-01-15T00:00:00Z',
      rangeEnd: '2026-04-15T00:00:00Z',
      anchorSettings: { dayOfMonth: 1 },
      historicalCycles: [
        { start: '2026-01-01T00:00:00Z', end: '2026-02-01T00:00:00Z' },
        { start: '2026-01-15T00:00:00Z', end: '2026-02-15T00:00:00Z' },
        { start: '2026-02-15T00:00:00Z', end: '2026-02-15T00:00:00Z' },
      ],
      sourceObligation,
      duePosition: 'advance',
    });

    expect(periods.map(({ start, end }) => ({ start, end }))).toEqual([
      { start: '2026-01-01T00:00:00Z', end: '2026-02-01T00:00:00Z' },
      { start: '2026-02-01T00:00:00Z', end: '2026-03-01T00:00:00Z' },
      { start: '2026-03-01T00:00:00Z', end: '2026-04-01T00:00:00Z' },
      { start: '2026-04-01T00:00:00Z', end: '2026-05-01T00:00:00Z' },
    ]);
  });
});
