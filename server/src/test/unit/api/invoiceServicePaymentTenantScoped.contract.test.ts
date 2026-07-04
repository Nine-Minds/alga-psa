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

describe('invoice service payment tenant-scoped query contract', () => {
  it('uses structural tenant scoping for record-payment reads and updates', () => {
    const paymentSection = sectionBetween('async recordPayment', 'async applyCredit');

    expect(paymentSection).toContain('tenantDb(');
    expect(paymentSection).toContain(".table('invoices')");
    expect(paymentSection).toContain(".table('invoice_payments')");
    expect(paymentSection).toContain("await tenantDb(trx, context.tenant).table('invoice_payments').insert(paymentData)");

    expect(paymentSection).not.toMatch(/trx\('invoices'\)\s*\.(?:where|update|first)/);
    expect(paymentSection).not.toMatch(/trx\('invoice_payments'\)\s*\.(?:where|sum|first)/);
    expect(paymentSection).not.toMatch(/\.where\(\{\s*invoice_id: data\.invoice_id,\s*tenant: context\.tenant\s*\}\)/);
  });
});
