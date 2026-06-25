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

describe('financial service apply-credit tenant-scoped query contract', () => {
  it('uses structural tenant scoping for apply-credit read and update roots', () => {
    const applyCreditSection = sectionBetween('async applyCreditToInvoice', 'async createPrepaymentInvoice');

    expect(applyCreditSection).toContain('tenantDb(');
    expect(applyCreditSection).toContain(".table('invoices')");
    expect(applyCreditSection).toContain(".table('credit_allocations')");
    expect(applyCreditSection).toContain(".table('clients')");
    expect(applyCreditSection).toContain(".table('credit_tracking')");

    expect(applyCreditSection).not.toMatch(/trx\('(?:invoices|credit_allocations|clients|credit_tracking)'\)\s*\.(?:where|first|update|delete|sum|select)/);
    expect(applyCreditSection).not.toMatch(/where\(\{\s*[^}]*tenant\s*[,}]/);
  });
});
