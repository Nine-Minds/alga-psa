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

describe('financial service bulk invoice tenant-scoped query contract', () => {
  it('uses structural tenant scoping for bulk invoice read and update roots', () => {
    const bulkInvoiceSection = sectionBetween('async bulkInvoiceOperation', 'async bulkTransactionOperation');

    expect(bulkInvoiceSection).toContain('tenantDb(');
    expect(bulkInvoiceSection).toContain(".table('invoices')");

    expect(bulkInvoiceSection).not.toMatch(/trx\('invoices'\)\s*\.(?:where|first|update|delete)/);
    expect(bulkInvoiceSection).not.toMatch(/where\(\{\s*[^}]*tenant\s*[,}]/);
  });
});
