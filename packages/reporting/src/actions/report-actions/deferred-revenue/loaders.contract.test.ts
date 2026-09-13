import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { resolveConfiguredFee, type RawBucketPeriodRow } from './loaders';

const source = readFileSync(new URL('./loaders.ts', import.meta.url), 'utf8');

function periodRow(overrides: Partial<RawBucketPeriodRow>): RawBucketPeriodRow {
  return {
    usageId: 'usage-1',
    contractLineId: 'line-1',
    contractId: 'contract-1',
    contractLineName: 'Line',
    clientId: 'client-1',
    serviceId: 'service-1',
    serviceName: 'Service',
    periodStart: '2023-01-01',
    periodEnd: '2023-01-31',
    minutesUsed: 0,
    rolledOverMinutes: 0,
    totalMinutes: 0,
    allowRollover: false,
    currencyCode: 'EUR',
    lineCustomRate: null,
    catalogCurrencyRate: null,
    catalogDefaultRate: null,
    ...overrides,
  };
}

describe('deferred revenue loaders tenant-scoped query contract', () => {
  it('scopes every source read through tenantDb', () => {
    expect(source).toContain("tenantDb(conn, tenant)");
    expect(source).toContain(".table('clients')");
    expect(source).toContain(".table('transactions')");
    expect(source).toContain(".table('invoices')");
    expect(source).toContain(".table('bucket_usage as bu')");
    expect(source).toContain(".table('service_prices')");
    expect(source).toContain(".table('invoice_charge_details as iid')");
    expect(source).toContain(".table('contract_line_service_configuration as clsc')");

    // No un-scoped knex table access leaks into the report reads.
    expect(source).not.toContain("conn.table('transactions')");
    expect(source).not.toContain("conn.table('credit_tracking')");
  });

  it('reads every join through the tenant-aware join helper', () => {
    expect(source).toContain('db.tenantJoin(');
    // The credit_tracking detail read joins the ledger tenant-scoped.
    expect(source).toContain("db.tenantJoin(query, 'transactions as t', 'ct.transaction_id', 't.transaction_id'");
  });

  it('filters billed fees to finalized (non-draft/cancelled/pending) invoices', () => {
    expect(source).toContain("NON_BILLED_INVOICE_STATUSES");
    expect(source).toContain("'draft', 'cancelled', 'pending', 'void'");
  });

  it('prefers the effective service price in the contract currency over the legacy default_rate', () => {
    // A non-USD contract: the untagged default_rate must not win over the
    // currency-tagged service_prices row (correction #5).
    const eur = periodRow({ catalogCurrencyRate: 12000, catalogDefaultRate: 10000 });
    expect(resolveConfiguredFee(eur, null, null)).toBe(12000);

    // The legacy field is still the fallback when no currency price exists.
    const legacyOnly = periodRow({ catalogCurrencyRate: null, catalogDefaultRate: 10000 });
    expect(resolveConfiguredFee(legacyOnly, null, null)).toBe(10000);
  });
});
