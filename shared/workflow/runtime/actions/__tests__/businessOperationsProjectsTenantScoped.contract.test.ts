import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const source = fs.readFileSync(path.resolve(__dirname, '../businessOperations/projects.ts'), 'utf8');
const helperSection = source.slice(
  source.indexOf('async function ensureProjectExists'),
  source.indexOf('async function ensureProjectDefaultStatusMappings')
);
const assignmentHelperSection = source.slice(
  source.indexOf('async function generateTaskWbsCode'),
  source.indexOf('async function canReadTickets')
);
const tagAuthHelperSection = source.slice(
  source.indexOf('async function ensureTagMappings'),
  source.indexOf('async function createProjectReadAuthorizer')
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

  it('uses structural tenant scoping for task assignment helper roots', () => {
    expect(assignmentHelperSection).toContain("tenantScopedTable(tx, 'project_tasks')");
    expect(assignmentHelperSection).toContain("tenantScopedTable(tx, 'task_resources')");
    expect(assignmentHelperSection).toContain("tenantScopedTable(tx, 'users')");
    expect(assignmentHelperSection).not.toContain("tx.trx('project_tasks')");
    expect(assignmentHelperSection).not.toContain("tx.trx('users')");
    expect(assignmentHelperSection).not.toContain(".where({ tenant: tx.tenantId");
  });

  it('uses structural tenant scoping for tag and authorization helper roots', () => {
    expect(tagAuthHelperSection).toContain("tenantScopedTable(tx, 'tag_definitions')");
    expect(tagAuthHelperSection).toContain("tenantScopedTable(tx, 'tag_mappings')");
    expect(tagAuthHelperSection).toContain("tenantScopedTable(tx, 'users')");
    expect(tagAuthHelperSection).toContain("tenantScopedTable(tx, 'user_roles')");
    expect(tagAuthHelperSection).toContain("tenantScopedTable(tx, 'team_members')");
    expect(tagAuthHelperSection).not.toContain(".where({ tenant: tx.tenantId");
    expect(tagAuthHelperSection).not.toContain("tx.trx('user_roles')");
    expect(tagAuthHelperSection).not.toContain("tx.trx('team_members')");
  });
});
