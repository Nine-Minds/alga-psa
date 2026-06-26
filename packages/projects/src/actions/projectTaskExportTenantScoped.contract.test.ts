import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const source = readFileSync(resolve(__dirname, 'projectTaskExportActions.ts'), 'utf8');

describe('project task export tenant-scoped query contract', () => {
  it('uses structural tenant scoping for export lookup and task roots', () => {
    expect(source).toContain("tenantScopedTable(trx, 'users', tenant)");
    expect(source).toContain("tenantScopedTable(trx, 'teams', tenant)");
    expect(source).toContain("tenantScopedTable(trx, 'project_phases', tenant)");
    expect(source).toContain("tenantScopedTable(trx, 'project_status_mappings as psm', tenant)");
    expect(source).toContain("tenantScopedTable(trx, 'priorities', tenant)");
    expect(source).toContain("tenantScopedTable(trx, 'custom_task_types', tenant)");
    expect(source).toContain("tenantScopedTable(trx, 'project_tasks', tenant)");
    expect(source).toContain("tenantScopedTable(trx, 'task_checklist_items', tenant)");
    expect(source).toContain("tenantDb(trx, tenant).table('standard_task_types')");
    expect(source).not.toContain("trx('standard_task_types')");
    expect(source).toContain(".andOn('psm.tenant', '=', 's.tenant')");
    expect(source).not.toContain(".andWhere('tenant', tenant)");
    expect(source).not.toContain(".andWhere('psm.tenant', tenant)");
    expect(source).not.toContain('.where({ tenant, is_active: true })');
    expect(source).not.toContain('.where({ project_id: projectId, tenant })');
  });
});
