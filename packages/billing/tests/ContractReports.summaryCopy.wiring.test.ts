import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  new URL('../src/components/billing-dashboard/reports/ContractReports.tsx', import.meta.url),
  'utf8'
);

describe('ContractReports summary copy wiring', () => {
  it('surfaces renewal decision counts alongside recurring revenue summary cards', () => {
    expect(source).toContain('Renewal Decisions Due');
    expect(source).toContain('summary?.atRiskDecisionCount ?? 0');
    expect(source).toContain('Decision due dates in the next 90 days');
  });

  it('labels assignment-based counts explicitly instead of client-count language', () => {
    expect(source).toContain('Active Contracts');
    expect(source).toContain('Active assignments');
    expect(source).not.toContain('Billable clients');
  });
});
