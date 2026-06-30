import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  new URL('../src/actions/renewalsQueueActions.ts', import.meta.url),
  'utf8'
);

describe('renewalsQueueActions tenant read scoping', () => {
  it('applies tenant filters to renewal work-item reads by default', () => {
    // The tenant filter is no longer inlined on each query; it is applied by the
    // tenantDb facade. db.table()/db.tenantJoin() scope every read to the tenant,
    // so the wiring is verified by asserting reads flow through the facade.
    expect(source).toContain('const db = tenantDb(knex, tenant);');
    expect(source).toContain('const db = tenantDb(trx, tenant);');
    // List read: tenant-scoped base table + tenant-scoped joins.
    expect(source).toContain("let query = db.table('client_contracts as cc')");
    expect(source).toContain(".where({ 'cc.is_active': true })");
    expect(source).toContain("db.tenantJoin(query, 'contracts as c', 'cc.contract_id', 'c.contract_id', { type: 'left' });");
    expect(source).toContain("db.tenantJoin(query, 'clients as cl', 'cc.client_id', 'cl.client_id', { type: 'left' });");
    // Single-row reads: scoped via the transaction-bound facade, filtered by id (tenant applied by facade).
    expect(source).toContain("client_contract_id: clientContractId,");
    expect(source).toContain(".where({\n        client_contract_id: clientContractId,\n        is_active: true,\n      })");
  });
});
