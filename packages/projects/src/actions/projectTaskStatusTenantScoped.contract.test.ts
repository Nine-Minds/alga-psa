import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const source = readFileSync(resolve(__dirname, 'projectTaskStatusActions.ts'), 'utf8');

describe('project task status tenant-scoped query contract', () => {
  it('uses structural tenant scoping for project status mapping and status library roots', () => {
    expect(source).toContain("tenantScopedTable(trx, 'project_status_mappings as psm', tenant)");
    expect(source).toContain("tenantScopedTable(trx, 'statuses', tenant)");
    expect(source).toContain("tenantScopedTable(trx, 'user_roles', tenant)");
    expect(source).toContain("tenantScopedTable(trx, 'team_members', tenant)");
    expect(source).toContain("tenantScopedTable(trx, 'users', tenant)");
    expect(source).toContain("tenantScopedTable(trx, 'project_status_mappings', tenant)");
    expect(source).toContain("tenantScopedTable(trx, 'project_phases', tenant)");
    expect(source).toContain("tenantScopedTable(trx, 'project_tasks', tenant)");
    expect(source).toContain("tenantScopedTable(knex, 'project_tasks', tenant)");
    expect(source).toContain("tenantScopedTable(knex, 'statuses', tenant)");
    expect(source).toContain("knex('standard_statuses')");
    expect(source).toContain(".andOn('psm.tenant', '=', 'p.tenant')");
    expect(source).not.toContain(".where({ tenant,");
    expect(source).not.toContain(".where({ project_status_mapping_id: mappingId, tenant })");
    expect(source).not.toContain(".where({ project_status_mapping_id: mappingId, tenant })");
    expect(source).not.toContain(".where({ tenant, status_type: 'project_task' })");
    expect(source).not.toContain(".where({ status_id: statusId, tenant, status_type: 'project_task' })");
  });
});
