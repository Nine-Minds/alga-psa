import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const servicePath = resolve(__dirname, '../../../lib/api/services/FinancialService.ts');
const source = readFileSync(servicePath, 'utf8');

function sectionBetween(startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);

  return source.slice(start, end);
}

describe('financial service analytics tenant-scoped query contract', () => {
  it('uses structural tenant scoping for analytics aggregate roots', () => {
    const analyticsSection = sectionBetween('async getFinancialAnalytics', '// BULK OPERATIONS');

    expect(analyticsSection).toContain('tenantDb(');
    expect(analyticsSection).toContain(".table('invoices')");
    expect(analyticsSection).toContain(".table('transactions')");
    // The credit-balance aggregate is derived from credit_tracking now.
    expect(analyticsSection).toContain(".table('credit_tracking')");

    expect(analyticsSection).not.toMatch(/knex\('(?:invoices|transactions|credit_tracking)'\)\s*\./);
    expect(analyticsSection).not.toMatch(/\.where\('tenant', context\.tenant\)/);
  });
});
