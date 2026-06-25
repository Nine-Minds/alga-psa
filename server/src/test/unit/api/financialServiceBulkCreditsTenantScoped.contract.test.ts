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

describe('financial service bulk credits tenant-scoped query contract', () => {
  it('uses structural tenant scoping for bulk credit read and update roots', () => {
    const bulkCreditSection = sectionBetween('async bulkCreditOperation', '// UTILITY METHODS');

    expect(bulkCreditSection).toContain('createTenantScopedQuery(knex, {');
    expect(bulkCreditSection).toContain('createTenantScopedQuery(trx, {');
    expect(bulkCreditSection).toContain("table: 'credit_tracking'");
    expect(bulkCreditSection).toContain("table: 'clients'");

    expect(bulkCreditSection).not.toMatch(/knex\('credit_tracking'\)\s*\.(?:where|first|update|delete)/);
    expect(bulkCreditSection).not.toMatch(/trx\('(?:credit_tracking|clients)'\)\s*\.(?:where|first|update|delete|select)/);
    expect(bulkCreditSection).not.toMatch(/where\(\{\s*[^}]*tenant\s*[,}]/);
  });
});
