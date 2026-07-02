import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const servicePath = resolve(__dirname, '../../../lib/api/services/InvoiceService.ts');
const source = readFileSync(servicePath, 'utf8');

function sectionBetween(startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);

  return source.slice(start, end);
}

describe('invoice service credit tenant-scoped query contract', () => {
  it('uses structural tenant scoping for credit-application reads and updates', () => {
    const creditSection = sectionBetween('async applyCredit', 'async recordRefund');

    expect(creditSection).toContain('tenantDb(');
    expect(creditSection).toContain(".table('invoices')");
    expect(creditSection).toContain(".table('invoice_payments')");
    expect(creditSection).toContain("await tenantDb(trx, context.tenant).table('invoice_credits').insert(creditData)");

    expect(creditSection).not.toMatch(/trx\('invoices'\)\s*\.(?:where|update|first)/);
    expect(creditSection).not.toMatch(/trx\('invoice_payments'\)\s*\.(?:where|sum|first)/);
    expect(creditSection).not.toMatch(/\.where\(\{\s*invoice_id: data\.invoice_id,\s*tenant: context\.tenant\s*\}\)/);
  });
});
