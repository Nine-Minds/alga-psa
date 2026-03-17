import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('billing dashboard recurring copy wiring', () => {
  it('T116: dashboard overview and quick-start copy describe service-period-first recurring semantics', () => {
    const overviewSource = readFileSync(
      resolve(__dirname, '../src/components/billing-dashboard/Overview.tsx'),
      'utf8'
    );
    const quickStartSource = readFileSync(
      resolve(__dirname, '../src/components/billing-dashboard/contracts/QuickStartGuide.tsx'),
      'utf8'
    );
    const billingCyclesSource = readFileSync(
      resolve(__dirname, '../src/components/billing-dashboard/BillingCycles.tsx'),
      'utf8'
    );

    expect(overviewSource).toContain(
      'Manage client billing schedules, cadence defaults, and invoice frequency settings'
    );
    expect(overviewSource).toContain(
      'Review recurring service periods and understand how invoice windows group them'
    );
    expect(quickStartSource).toContain(
      'Use partial-period adjustment when contract dates cover only part of a service period'
    );
    expect(quickStartSource).not.toContain(
      'Enable proration for contracts that start/end mid-month'
    );
    expect(billingCyclesSource).toContain(
      'Configure client billing schedules and preview the invoice windows they create.'
    );
  });
});
