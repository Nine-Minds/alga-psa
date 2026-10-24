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
  it('uses structural tenant scoping and tenant facade joins for invoice listing', () => {
    const listSection = sectionBetween('async list(', 'async getById');
    const baseQuerySection = sectionBetween('protected buildBaseQuery', 'private applyInvoiceFilters');

    expect(baseQuerySection).toContain('tenantDb(');
    expect(baseQuerySection).toContain(".table('invoices')");
    expect(baseQuerySection).not.toContain('recurring_service_periods');
    expect(baseQuerySection).not.toContain('recurring_invoice_summary');
    expect(baseQuerySection).not.toMatch(/return trx\('invoices'\)\s*\./);
    expect(baseQuerySection).not.toMatch(/\.where\('invoices\.tenant', context\.tenant\)/);

    const billingAddressSection = sectionBetween('protected joinClientBillingAddress', 'protected buildBaseQuery');

    expect(listSection).toContain('tenantDb(');
    expect(listSection).toContain('this.joinClientBillingAddress(trx, context, query)');
    expect(billingAddressSection).toContain(".table('client_locations as cl')");
    expect(billingAddressSection).toContain("db.tenantJoin(query, 'clients', 'invoices.client_id', 'clients.client_id', { type: 'left' })");
    // The billing-address derived table joins on tenant via the facade, not a hand-rolled predicate.
    expect(billingAddressSection).toContain("db.tenantJoinSubquery(query, billingAddressSubquery, 'clients.client_id', 'billing_loc.client_id'");
    expect(listSection).toMatch(/db\.tenantJoin\(\s*query,\s*'client_billing_cycles',\s*'invoices\.billing_cycle_id',\s*'client_billing_cycles\.billing_cycle_id',\s*\{\s*type: 'left'\s*\}\s*\)/);
    expect(listSection).toMatch(/db\.tenantJoin\(\s*query,\s*'tax_rates',\s*'invoices\.tax_rate_id',\s*'tax_rates\.tax_rate_id',\s*\{\s*type: 'left'\s*\}\s*\)/);
    expect(billingAddressSection).not.toContain(".leftJoin(billingAddressSubquery");

    expect(listSection).not.toMatch(/trx\('client_locations as cl'\)\s*\./);
    expect(listSection).not.toMatch(/\.andOn\([^)]*tenant/);
    expect(listSection).not.toContain(".leftJoin('clients', 'invoices.client_id', 'clients.client_id')");
    expect(listSection).not.toContain(".leftJoin('client_billing_cycles', 'invoices.billing_cycle_id', 'client_billing_cycles.billing_cycle_id')");
    expect(listSection).not.toContain(".leftJoin('tax_rates', 'invoices.tax_rate_id', 'tax_rates.tax_rate_id')");
  });
});
