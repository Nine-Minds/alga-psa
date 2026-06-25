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

describe('invoice service refund tenant-scoped query contract', () => {
  it('uses structural tenant scoping for refund reads and updates', () => {
    const refundSection = sectionBetween('async recordRefund', '// Bulk Operations');

    expect(refundSection).toContain('createTenantScopedQuery(trx, {');
    expect(refundSection).toContain("table: 'invoices'");
    expect(refundSection).toContain("table: 'invoice_payments'");
    expect(refundSection).toContain("await trx('invoice_payments').insert(refundData)");

    expect(refundSection).not.toMatch(/trx\('invoices'\)\s*\.(?:where|update|first)/);
    expect(refundSection).not.toMatch(/trx\('invoice_payments'\)\s*\.(?:where|sum|first)/);
    expect(refundSection).not.toMatch(/\.where\(\{\s*invoice_id: data\.invoice_id,\s*tenant: context\.tenant\s*\}\)/);
  });
});
