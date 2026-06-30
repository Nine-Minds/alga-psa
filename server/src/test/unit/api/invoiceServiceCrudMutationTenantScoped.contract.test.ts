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

describe('invoice service CRUD mutation tenant-scoped query contract', () => {
  it('uses structural tenant scoping for update and delete roots', () => {
    const updateSection = sectionBetween('async update(', 'async delete(');
    const deleteSection = sectionBetween('async delete(', '// Invoice Operations');

    expect(updateSection).toContain('tenantDb(');
    expect(updateSection).toContain(".table('invoices')");
    expect(updateSection).toContain(".table('invoice_line_items')");
    expect(updateSection).not.toMatch(/trx\('invoices'\)\s*\.(?:where|update|del|delete)/);
    expect(updateSection).not.toMatch(/trx\('invoice_line_items'\)\s*\.(?:where|update|del|delete|pluck)/);
    expect(updateSection).not.toMatch(/\.where\(\{\s*invoice_id: id,\s*tenant: context\.tenant\s*\}\)/);

    expect(deleteSection).toContain('tenantDb(');
    expect(deleteSection).toContain(".table('invoices')");
    expect(deleteSection).toContain(".table('invoice_payments')");
    expect(deleteSection).toContain(".table('invoice_line_items')");
    expect(deleteSection).not.toMatch(/trx\('invoices'\)\s*\.(?:where|update|del|delete)/);
    expect(deleteSection).not.toMatch(/trx\('invoice_payments'\)\s*\.(?:where|first)/);
    expect(deleteSection).not.toMatch(/trx\('invoice_line_items'\)\s*\.(?:where|del|delete)/);
    expect(deleteSection).not.toMatch(/\.where\(\{\s*invoice_id: id,\s*tenant: context\.tenant\s*\}\)/);
  });
});
