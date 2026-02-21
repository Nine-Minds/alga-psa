import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  new URL('../src/components/billing-dashboard/reports/ContractReports.tsx', import.meta.url),
  'utf8'
);

describe('ContractReports expiration copy wiring', () => {
  it('references renewal decision language alongside expiration language', () => {
    expect(source).toContain('Contract Expiration and Renewal Decisions');
    expect(source).toContain('Track upcoming contract expirations and renewal decision due dates.');
    expect(source).toContain('No upcoming contract expirations or renewal decisions in the near term');
  });
});
