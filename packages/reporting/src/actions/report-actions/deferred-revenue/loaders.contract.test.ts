import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./loaders.ts', import.meta.url), 'utf8');

describe('deferred revenue loaders tenant-scoped query contract', () => {
  it('scopes every source read through tenantDb', () => {
    expect(source).toContain("tenantDb(conn, tenant)");
    expect(source).toContain(".table('clients')");
    expect(source).toContain(".table('transactions')");
    expect(source).toContain(".table('invoices')");
    expect(source).toContain(".table('bucket_usage as bu')");
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
});
