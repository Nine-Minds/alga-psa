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

describe('financial service client credits tenant-scoped query contract', () => {
  it('uses structural tenant scoping for client credit list and validation roots', () => {
    const creditSection = sectionBetween('async listClientCredits', '// BILLING AND INVOICING');

    expect(creditSection).toContain('createTenantScopedQuery(knex, {');
    expect(creditSection).toContain("table: 'credit_tracking'");
    expect(creditSection).toContain("table: 'transactions'");
    expect(creditSection).toContain("table: 'clients'");
    expect(creditSection).toContain(".andOn('credit_tracking.tenant', '=', 'transactions.tenant')");

    expect(creditSection).not.toMatch(/knex\('(?:credit_tracking|transactions|clients)'\)\s*\./);
    expect(creditSection).not.toMatch(/where\(\{\s*[^}]*tenant\s*[,}]/);
  });
});
