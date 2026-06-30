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

describe('financial service prepayment tenant-scoped query contract', () => {
  it('uses structural tenant scoping for prepayment read roots', () => {
    const prepaymentSection = sectionBetween('async createPrepaymentInvoice', 'async transferCredit');

    expect(prepaymentSection).toContain('tenantDb(');
    expect(prepaymentSection).toContain('tenantDb(');
    expect(prepaymentSection).toContain(".table('clients')");
    expect(prepaymentSection).toContain(".table('client_billing_settings')");
    expect(prepaymentSection).toContain(".table('default_billing_settings')");
    expect(prepaymentSection).toContain(".table('transactions')");

    expect(prepaymentSection).not.toMatch(/knex\('clients'\)\s*\.(?:where|first)/);
    expect(prepaymentSection).not.toMatch(/trx\('(?:client_billing_settings|default_billing_settings)'\)\s*\.(?:where|first)/);
    expect(prepaymentSection).not.toMatch(/trx\('transactions'\)\s*\.(?:where|first|update|delete)/);
    expect(prepaymentSection).not.toMatch(/where\(\{\s*[^}]*tenant\s*[,}]/);
  });
});
