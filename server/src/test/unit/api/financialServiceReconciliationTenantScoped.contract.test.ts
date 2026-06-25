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

describe('financial service reconciliation tenant-scoped query contract', () => {
  it('uses structural tenant scoping for reconciliation resolve roots', () => {
    const reconciliationSection = sectionBetween('async resolveReconciliationReport', '// BULK OPERATIONS');

    expect(reconciliationSection).toContain('createTenantScopedQuery(trx, {');
    expect(reconciliationSection).toContain("table: 'credit_reconciliation_reports'");
    expect(reconciliationSection).toContain("table: 'clients'");
    expect(reconciliationSection).toContain('const tenant = context?.tenant || defaultTenant;');

    expect(reconciliationSection).not.toMatch(/trx\('(?:credit_reconciliation_reports|clients)'\)\s*\.(?:where|first|update|delete)/);
    expect(reconciliationSection).not.toMatch(/where\(\{\s*[^}]*tenant\s*[,}]/);
  });
});
