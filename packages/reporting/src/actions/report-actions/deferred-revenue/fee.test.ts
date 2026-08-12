import { describe, expect, it } from 'vitest';

import { defaultReportMonth, isValidMonth, monthRange, nextMonth, previousMonth } from './month';
import { resolvePeriodFee, type BilledFeeCandidate, type ConfiguredFee } from './fee';
import {
  buildBucketPeriodInputs,
  resolveConfiguredFee,
  resolvePricingScheduleRate,
  type BuildDeferredRevenueInput,
  type RawBucketPeriodRow,
  type RawPricingScheduleRow,
} from './loaders';

describe('month utilities', () => {
  it('validates YYYY-MM strings', () => {
    expect(isValidMonth('2026-02')).toBe(true);
    expect(isValidMonth('2026-13')).toBe(false);
    expect(isValidMonth('2026-00')).toBe(false);
    expect(isValidMonth('2026-2')).toBe(false);
    expect(isValidMonth('garbage')).toBe(false);
  });

  it('computes inclusive/exclusive boundaries in UTC', () => {
    expect(monthRange('2026-02')).toEqual({
      month: '2026-02',
      start: '2026-02-01',
      endExclusive: '2026-03-01',
    });
    expect(monthRange('2026-12').endExclusive).toBe('2027-01-01');
  });

  it('moves between months', () => {
    expect(nextMonth('2026-02')).toBe('2026-03');
    expect(previousMonth('2026-02')).toBe('2026-01');
    expect(previousMonth('2026-01')).toBe('2025-12');
  });

  it('defaults to the previous month for month-end close', () => {
    expect(defaultReportMonth(new Date('2026-03-10T12:00:00.000Z'))).toBe('2026-02');
    expect(defaultReportMonth(new Date('2026-01-02T00:00:00.000Z'))).toBe('2025-12');
  });
});

describe('resolvePeriodFee', () => {
  const billed: BilledFeeCandidate[] = [
    {
      contractLineId: 'line-1',
      serviceId: 'svc-1',
      servicePeriodStart: '2026-02-01',
      servicePeriodEnd: '2026-02-28',
      feeCents: 100000,
    },
    {
      contractLineId: 'line-1',
      serviceId: 'svc-1',
      servicePeriodStart: '2026-02-08',
      servicePeriodEnd: '2026-02-28',
      feeCents: 75000,
    },
    {
      contractLineId: 'line-2',
      serviceId: 'svc-1',
      servicePeriodStart: '2026-02-01',
      servicePeriodEnd: '2026-02-28',
      feeCents: 90000,
    },
  ];
  const configured: ConfiguredFee = { contractLineId: 'line-1', serviceId: 'svc-1', feeCents: 100000 };

  it('prefers the billed fee over the configured fallback', () => {
    const resolved = resolvePeriodFee('2026-02-01', '2026-02-28', 'line-1', 'svc-1', billed, configured.feeCents);
    expect(resolved.feeSource).toBe('billed');
    expect(resolved.feeCents).toBe(100000);
  });

  it('matches the prorated billed detail by longest overlap (exact window wins)', () => {
    // A bucket period Feb 1–28 has two overlapping billed details; the exact
    // window (Feb 1–28) is preferred over the prorated Feb 8–28.
    const resolved = resolvePeriodFee('2026-02-01', '2026-02-28', 'line-1', 'svc-1', billed, null);
    expect(resolved.feeSource).toBe('billed');
    expect(resolved.feeCents).toBe(100000);
  });

  it('falls back to a prorated billed detail when no exact window exists', () => {
    const onlyProrated: BilledFeeCandidate[] = [billed[1]];
    const resolved = resolvePeriodFee('2026-02-01', '2026-02-28', 'line-1', 'svc-1', onlyProrated, null);
    expect(resolved.feeSource).toBe('billed');
    expect(resolved.feeCents).toBe(75000);
  });

  it('falls back to the configured fee when nothing overlaps the period', () => {
    const resolved = resolvePeriodFee('2026-03-01', '2026-03-31', 'line-1', 'svc-1', billed, configured.feeCents);
    expect(resolved.feeSource).toBe('configured');
    expect(resolved.feeCents).toBe(100000);
  });

  it('resolves zero when no billed or configured fee exists', () => {
    const resolved = resolvePeriodFee('2026-03-01', '2026-03-31', 'line-1', 'svc-1', billed, null);
    expect(resolved).toEqual({ feeCents: 0, feeSource: 'configured' });
  });

  it('never matches a different contract line', () => {
    const resolved = resolvePeriodFee('2026-02-01', '2026-02-28', 'line-2', 'svc-1', billed, configured.feeCents);
    expect(resolved.feeSource).toBe('billed');
    expect(resolved.feeCents).toBe(90000);
  });
});

describe('multi-service billed-fee disambiguation (Defect 2)', () => {
  it('values each service bucket at its own billed fee on a shared contract line', () => {
    // One contract line, two Fixed services billed at different finalized fees.
    const billed: BilledFeeCandidate[] = [
      {
        contractLineId: 'line-1',
        serviceId: 'svc-a',
        servicePeriodStart: '2026-02-01',
        servicePeriodEnd: '2026-02-28',
        feeCents: 100000,
      },
      {
        contractLineId: 'line-1',
        serviceId: 'svc-b',
        servicePeriodStart: '2026-02-01',
        servicePeriodEnd: '2026-02-28',
        feeCents: 25000,
      },
    ];
    const configured = 99999;

    const svcA = resolvePeriodFee('2026-02-01', '2026-02-28', 'line-1', 'svc-a', billed, configured);
    const svcB = resolvePeriodFee('2026-02-01', '2026-02-28', 'line-1', 'svc-b', billed, configured);
    // Each service gets its own billed fee — not the other service's, not the
    // configured fallback.
    expect(svcA).toEqual({ feeCents: 100000, feeSource: 'billed' });
    expect(svcB).toEqual({ feeCents: 25000, feeSource: 'billed' });
  });

  it('resolves each service bucket to its own billed fee through the loader path', () => {
    const base: RawBucketPeriodRow = {
      usageId: 'u-a',
      contractLineId: 'line-1',
      contractId: 'contract-1',
      contractLineName: 'Block Hours',
      clientId: 'client-1',
      serviceId: 'svc-a',
      serviceName: 'Engineering',
      periodStart: '2026-02-01',
      periodEnd: '2026-02-28',
      minutesUsed: 0,
      rolledOverMinutes: 0,
      totalMinutes: 6000,
      allowRollover: false,
      currencyCode: 'USD',
      lineCustomRate: 80000,
      catalogDefaultRate: 70000,
    };
    const data: BuildDeferredRevenueInput = {
      clients: [],
      creditTransactions: [],
      creditTracking: [],
      creditInvoices: new Map(),
      bucketPeriods: [base, { ...base, usageId: 'u-b', serviceId: 'svc-b' }],
      billedFees: [
        {
          contractLineId: 'line-1',
          serviceId: 'svc-a',
          servicePeriodStart: '2026-02-01',
          servicePeriodEnd: '2026-02-28',
          feeCents: 100000,
        },
        {
          contractLineId: 'line-1',
          serviceId: 'svc-b',
          servicePeriodStart: '2026-02-01',
          servicePeriodEnd: '2026-02-28',
          feeCents: 25000,
        },
      ],
      fixedConfigBaseRates: new Map<string, number | null>(),
      pricingSchedules: [],
    };

    const inputs = buildBucketPeriodInputs(data);
    const byUsage = new Map(inputs.map((input) => [input.usageId, input]));
    expect(byUsage.get('u-a')!.periodFee).toBe(100000);
    expect(byUsage.get('u-a')!.feeSource).toBe('billed');
    expect(byUsage.get('u-b')!.periodFee).toBe(25000);
    expect(byUsage.get('u-b')!.feeSource).toBe('billed');
  });
});

describe('resolveConfiguredFee fallback chain', () => {
  const period: RawBucketPeriodRow = {
    usageId: 'u1',
    contractLineId: 'line-1',
    contractId: 'contract-1',
    contractLineName: 'Block Hours',
    clientId: 'client-1',
    serviceId: 'svc-1',
    serviceName: 'Engineering',
    periodStart: '2026-02-01',
    periodEnd: '2026-02-28',
    minutesUsed: 0,
    rolledOverMinutes: 0,
    totalMinutes: 6000,
    allowRollover: false,
    currencyCode: 'USD',
    lineCustomRate: 9000,
    catalogDefaultRate: 10000,
  };

  it('prefers a pricing-schedule custom rate over every configured tier', () => {
    expect(resolveConfiguredFee(period, 8000, 12000)).toBe(12000);
  });

  it('falls through pricing schedule → line custom rate → fixed base rate → catalog default', () => {
    expect(resolveConfiguredFee(period, null, null)).toBe(9000);
    expect(resolveConfiguredFee({ ...period, lineCustomRate: null }, 8000, null)).toBe(8000);
    expect(resolveConfiguredFee({ ...period, lineCustomRate: null }, null, null)).toBe(10000);
    expect(resolveConfiguredFee({ ...period, lineCustomRate: null, catalogDefaultRate: null }, null, null)).toBeNull();
  });

  it('resolves the active pricing schedule for the period (engine exclusivity semantics)', () => {
    const schedules: RawPricingScheduleRow[] = [
      { contractId: 'contract-1', effectiveDate: '2026-01-01', endDate: '2026-02-14', customRate: 7000 },
      { contractId: 'contract-1', effectiveDate: '2026-02-15', endDate: null, customRate: 12000 },
      { contractId: 'contract-other', effectiveDate: '2026-01-01', endDate: null, customRate: 99999 },
    ];
    // Feb 1–28 overlaps only the second schedule (effective Feb 15, no end).
    expect(resolvePricingScheduleRate('2026-02-01', '2026-02-28', 'contract-1', schedules)).toBe(12000);
    // A period fully before the first schedule starts resolves null.
    expect(resolvePricingScheduleRate('2025-12-01', '2025-12-31', 'contract-1', schedules)).toBeNull();
    // A period that ends after the first schedule's end_date (exclusive) skips it.
    expect(resolvePricingScheduleRate('2026-02-01', '2026-02-14', 'contract-1', schedules)).toBe(7000);
  });
});
