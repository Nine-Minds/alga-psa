import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const source = readFileSync(resolve(__dirname, 'processRenewalQueueHandler.ts'), 'utf8');

describe('process renewal queue handler tenant-scoped query contract', () => {
  it('uses structural tenant scoping for renewal read and update roots', () => {
    expect(source).toContain('tenantDb(conn, tenant).table(table)');
    expect(source).not.toContain('createTenantScopedQuery');
    expect(source).toContain("tenantScopedTable(knex, 'client_contracts as cc', tenantId)");
    expect(source).toContain("tenantScopedTable(knex, 'workflow_runs', tenantId)");
    expect(source).toContain("tenantScopedTable(knex, 'tickets', tenantId)");
    expect(source).toContain("tenantScopedTable(knex, 'client_contracts', tenantId)");
    expect(source).not.toContain("'cc.tenant': tenantId");
    expect(source).not.toContain('.where({ tenant: tenantId');
  });
});
