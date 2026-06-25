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

describe('financial service create transaction tenant-scoped query contract', () => {
  it('uses structural tenant scoping for balance lookup and client update roots', () => {
    const createTransactionSection = sectionBetween('async createTransaction', 'async getTransaction');

    expect(createTransactionSection).toContain('tenantDb(');
    expect(createTransactionSection).toContain(".table('transactions')");
    expect(createTransactionSection).toContain(".table('clients')");

    expect(createTransactionSection).not.toMatch(/trx\('transactions'\)\s*\.(?:where|first|update|delete)/);
    expect(createTransactionSection).not.toMatch(/trx\('clients'\)\s*\.(?:where|first|update|delete)/);
    expect(createTransactionSection).not.toMatch(/tenant:\s*context\.tenant\s*\}/);
  });
});
