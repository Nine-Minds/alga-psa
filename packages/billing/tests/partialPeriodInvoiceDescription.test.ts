import { describe, expect, it } from 'vitest';
import { buildPartialPeriodInvoiceDescription } from '../src/lib/billing/partialPeriodInvoiceDescription';
import { resolveSourceDerivedPartialPeriod } from '../src/lib/billing/compute/contractInvoiceAdjustments';

const describeLine = (direction: 'increase' | 'decrease', values: { description: string; units: number; period: string; calculation: string }) =>
  direction === 'increase'
    ? `${values.description} — additional ${values.units} users, ${values.period} — ${values.calculation}`
    : `${values.description} — credit for ${values.units} fewer users, ${values.period} — ${values.calculation}`;

describe('partial-period customer descriptions', () => {
  it('shows source, inclusive affected dates and full proration for an increase without changing the amount', () => {
    const amount = resolveSourceDerivedPartialPeriod({ units: 3, unitPrice: 10_000, effectiveDate: '2026-08-16', servicePeriodStart: '2026-08-01', servicePeriodEnd: '2026-09-01', direction: 'increase' }).amount;
    const description = buildPartialPeriodInvoiceDescription({
      sourceDescription: 'SMOKE Prod Users', direction: 'increase', units: 3,
      start: '2026-08-16', exclusiveEnd: '2026-09-01', unitPrice: 10_000,
      coveredDays: 16, fullPeriodDays: 31, currencyCode: 'USD',
      formatCurrency: (amount) => `$${amount.toFixed(2)}`, describe: describeLine,
    });
    expect(amount).toBe(15_483);
    expect(description).toBe('SMOKE Prod Users — additional 3 users, Aug 16–31, 2026 — 3 × $100.00 × 16/31');
  });

  it('labels a decrease as a credit and keeps the same negative resolved amount', () => {
    const amount = resolveSourceDerivedPartialPeriod({ units: 3, unitPrice: 10_000, effectiveDate: '2026-08-16', servicePeriodStart: '2026-08-01', servicePeriodEnd: '2026-09-01', direction: 'decrease' }).amount;
    const description = buildPartialPeriodInvoiceDescription({
      sourceDescription: 'SMOKE Prod Users', direction: 'decrease', units: 3,
      start: '2026-08-16', exclusiveEnd: '2026-09-01', unitPrice: 10_000,
      coveredDays: 16, fullPeriodDays: 31, currencyCode: 'USD',
      formatCurrency: (amount) => `$${amount.toFixed(2)}`, describe: describeLine,
    });
    expect(amount).toBe(-15_483);
    expect(description).toBe('SMOKE Prod Users — credit for 3 fewer users, Aug 16–31, 2026 — 3 × $100.00 × 16/31');
  });

  it('uses different years and months accurately when the half-open interval crosses boundaries', () => {
    const description = buildPartialPeriodInvoiceDescription({
      sourceDescription: 'Service', direction: 'increase', units: 1,
      start: '2026-12-28', exclusiveEnd: '2027-01-04', unitPrice: 1_000,
      coveredDays: 7, fullPeriodDays: 31, currencyCode: 'USD',
      formatCurrency: (amount) => `$${amount.toFixed(2)}`, describe: describeLine,
    });
    expect(description).toContain('Dec 28, 2026–Jan 3, 2027');
  });
});
