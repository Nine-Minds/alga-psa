import { describe, expect, it } from 'vitest';

import {
  normalizeAndSortAccountingExportRecurringPeriods,
  projectAccountingExportRecurringPeriods,
} from '../../../../../packages/billing/src/services/accountingExportServicePeriods';

const MARCH = {
  service_period_start: '2026-03-01T00:00:00.000Z',
  service_period_end: '2026-04-01T00:00:00.000Z',
  billing_timing: 'advance' as const,
};

describe('accountingExportServicePeriods', () => {
  it('T001: N identical rows yield one period', () => {
    expect(projectAccountingExportRecurringPeriods([MARCH, MARCH, MARCH])).toEqual([MARCH]);
  });

  it('T001: distinct periods stay separate', () => {
    const april = { ...MARCH, service_period_start: '2026-04-01T00:00:00.000Z', service_period_end: '2026-05-01T00:00:00.000Z' };
    expect(projectAccountingExportRecurringPeriods([MARCH, april, MARCH])).toEqual([MARCH, april]);
  });

  it('T001: distinct billing timings stay separate', () => {
    const arrears = { ...MARCH, billing_timing: 'arrears' as const };
    expect(projectAccountingExportRecurringPeriods([MARCH, arrears, MARCH, arrears])).toEqual([MARCH, arrears]);
  });

  it('T001: rows with neither start nor end are skipped', () => {
    expect(
      projectAccountingExportRecurringPeriods([
        { service_period_start: null, service_period_end: null, billing_timing: 'advance' },
        { service_period_start: undefined, service_period_end: undefined, billing_timing: null },
        MARCH,
      ])
    ).toEqual([MARCH]);
    expect(projectAccountingExportRecurringPeriods([])).toEqual([]);
  });

  it('T001: rows with only one bound are kept', () => {
    expect(
      projectAccountingExportRecurringPeriods([
        { service_period_start: '2026-03-01', service_period_end: null, billing_timing: null },
      ])
    ).toEqual([{ service_period_start: '2026-03-01T00:00:00.000Z', service_period_end: null, billing_timing: null }]);
  });

  it('T001: normalizes Date objects and ISO strings with time to calendar dates', () => {
    expect(
      projectAccountingExportRecurringPeriods([
        {
          service_period_start: new Date('2026-03-01T00:00:00.000Z'),
          service_period_end: '2026-04-01T04:00:00.000Z',
          billing_timing: 'advance',
        },
        { service_period_start: '2026-03-01', service_period_end: '2026-04-01T00:00:00Z', billing_timing: 'advance' },
        { ...MARCH, billing_timing: 'bogus' as never },
      ])
    ).toEqual([{ ...MARCH, billing_timing: null }, MARCH]);
  });

  it('T001: sorts by start, then end', () => {
    const rows = [
      { service_period_start: '2026-05-01', service_period_end: '2026-06-01', billing_timing: 'advance' },
      { service_period_start: '2026-03-01', service_period_end: '2026-05-01', billing_timing: 'advance' },
      { service_period_start: '2026-03-01', service_period_end: '2026-04-01', billing_timing: 'advance' },
    ];
    expect(projectAccountingExportRecurringPeriods(rows).map((p) => [p.service_period_start, p.service_period_end])).toEqual([
      ['2026-03-01T00:00:00.000Z', '2026-04-01T00:00:00.000Z'],
      ['2026-03-01T00:00:00.000Z', '2026-05-01T00:00:00.000Z'],
      ['2026-05-01T00:00:00.000Z', '2026-06-01T00:00:00.000Z'],
    ]);
  });

  it('T001: normalize/sort step does not dedupe', () => {
    expect(normalizeAndSortAccountingExportRecurringPeriods([MARCH, MARCH])).toHaveLength(2);
  });
});
