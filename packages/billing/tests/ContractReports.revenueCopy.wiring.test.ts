import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  new URL('../src/components/billing-dashboard/reports/ContractReports.tsx', import.meta.url),
  'utf8'
);

describe('ContractReports revenue copy wiring', () => {
  it('explains YTD revenue in service-period terms', () => {
    expect(source).toContain('Year to Date by billed service period');
    expect(source).toContain('Overview of monthly recurring revenue and year-to-date billed service periods by contract.');
  });
});
