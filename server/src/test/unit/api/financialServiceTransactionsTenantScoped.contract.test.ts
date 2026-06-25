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

describe('financial service transaction tenant-scoped query contract', () => {
  it('uses structural tenant scoping for transaction get/list roots', () => {
    const transactionSection = sectionBetween('async getTransaction', 'async listInvoices');

    expect(transactionSection).toContain('tenantDb(');
    expect(transactionSection).toContain(".table('transactions')");
    expect(transactionSection).toContain(".table('transactions as t')");
    expect(transactionSection).toContain(".andOn('t.tenant', '=', 'c.tenant')");
    expect(transactionSection).toContain(".andOn('t.tenant', '=', 'i.tenant')");

    expect(transactionSection).not.toMatch(/knex\('transactions(?: as t)?'\)\s*\./);
    expect(transactionSection).not.toMatch(/\.where\('(?:t\.)?tenant', context\.tenant\)/);
    expect(transactionSection).not.toMatch(/tenant:\s*context\.tenant\s*\}/);
  });
});
