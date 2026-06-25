import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const source = fs.readFileSync(path.resolve(__dirname, '../businessOperations/projects.ts'), 'utf8');
const helperSection = source.slice(
  source.indexOf('async function ensureProjectExists'),
  source.indexOf('async function ensureProjectDefaultStatusMappings')
);

describe('project workflow business operations tenant-scoped query contract', () => {
  it('uses structural tenant scoping for shared project helper roots', () => {
    expect(source).toContain("import { createTenantScopedQuery } from '@alga-psa/db'");
    expect(source).toContain('function tenantScopedTable(tx: TenantTxContext, table: string)');
    expect(helperSection).toContain("tenantScopedTable(tx, 'projects')");
    expect(helperSection).toContain("tenantScopedTable(tx, 'project_phases')");
    expect(helperSection).toContain("tenantScopedTable(tx, 'project_tasks as pt')");
    expect(helperSection).toContain("tenantScopedTable(tx, 'tickets')");
    expect(helperSection).toContain("tenantScopedTable(tx, 'project_status_mappings')");
    expect(helperSection).toContain("tenantScopedTable(tx, 'project_status_mappings as psm')");
    expect(helperSection).not.toContain("tx.trx('projects').where({ tenant: tx.tenantId");
    expect(helperSection).not.toContain("tx.trx('project_phases').where({ tenant: tx.tenantId");
    expect(helperSection).not.toContain("tx.trx('project_tasks as pt')");
    expect(helperSection).not.toContain("tx.trx('tickets').where({ tenant: tx.tenantId");
    expect(helperSection).not.toContain("tx.trx('project_status_mappings')");
    expect(helperSection).not.toContain(".where({ 'psm.tenant': tx.tenantId");
    expect(helperSection).not.toContain(".where({ 'pt.tenant': tx.tenantId");
  });
});
