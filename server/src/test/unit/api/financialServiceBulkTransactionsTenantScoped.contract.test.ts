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

describe('financial service bulk transactions tenant-scoped query contract', () => {
  it('uses structural tenant scoping for bulk transaction read and update roots', () => {
    const bulkTransactionSection = sectionBetween('async bulkTransactionOperation', 'async bulkCreditOperation');

    expect(bulkTransactionSection).toContain('createTenantScopedQuery(trx, {');
    expect(bulkTransactionSection).toContain("table: 'transactions'");
    expect(bulkTransactionSection).toContain("table: 'clients'");

    expect(bulkTransactionSection).not.toMatch(/trx\('(?:transactions|clients)'\)\s*\.(?:where|first|update|delete)/);
    expect(bulkTransactionSection).not.toMatch(/where\(\{\s*[^}]*tenant\s*[,}]/);
  });
});
