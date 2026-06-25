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

describe('invoice service list tenant-scoped query contract', () => {
  it('uses structural tenant scoping and tenant-equal joins for invoice listing', () => {
    const listSection = sectionBetween('async list(', 'async getById');
    const baseQuerySection = sectionBetween('protected buildBaseQuery', 'private applyInvoiceFilters');

    expect(baseQuerySection).toContain('tenantDb(');
    expect(baseQuerySection).toContain(".table('invoices')");
    expect(baseQuerySection).not.toMatch(/return trx\('invoices'\)\s*\./);
    expect(baseQuerySection).not.toMatch(/\.where\('invoices\.tenant', context\.tenant\)/);

    expect(listSection).toContain('tenantDb(');
    expect(listSection).toContain(".table('client_locations as cl')");
    expect(listSection).toContain(".andOn('invoices.tenant', '=', 'clients.tenant')");
    expect(listSection).toContain(".andOn('invoices.tenant', '=', 'client_billing_cycles.tenant')");
    expect(listSection).toContain(".andOn('invoices.tenant', '=', 'tax_rates.tenant')");

    expect(listSection).not.toMatch(/trx\('client_locations as cl'\)\s*\./);
    expect(listSection).not.toContain(".leftJoin('clients', 'invoices.client_id', 'clients.client_id')");
    expect(listSection).not.toContain(".leftJoin('client_billing_cycles', 'invoices.billing_cycle_id', 'client_billing_cycles.billing_cycle_id')");
    expect(listSection).not.toContain(".leftJoin('tax_rates', 'invoices.tax_rate_id', 'tax_rates.tax_rate_id')");
  });
});
