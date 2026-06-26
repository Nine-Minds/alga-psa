import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const source = readFileSync(resolve(__dirname, 'projectTaskActions.ts'), 'utf8');
const section = source.slice(source.indexOf('export const getAllProjectTasksForListView'));

describe('project task list data tenant-scoped query contract', () => {
  it('uses structural tenant scoping for task list/count/tag roots', () => {
    expect(section).toContain("tenantScopedTable(trx, 'project_phases', tenant)");
    expect(section).toContain("tenantScopedTable(trx, 'project_tasks', tenant)");
    expect(section).toContain("tenantScopedTable(trx, 'task_checklist_items', tenant)");
    expect(source).toContain("tenantScopedTable(trx, 'project_task_dependencies as ptd', tenant)");
    expect(section).toContain("projectTaskDependencyTaskQuery(trx, tenant, 'predecessor_task_id')");
    expect(section).toContain("projectTaskDependencyTaskQuery(trx, tenant, 'successor_task_id')");
    expect(section).toContain("tenantScopedTable(trx, 'project_tasks as pt', tenant)");
    expect(section).toContain("tenantScopedTable(knex, 'project_tasks', tenant)");
    expect(section).not.toContain(".where({ project_id: projectId, tenant })");
    expect(section).not.toContain(".where({ 'pp.project_id': projectId, 'pt.tenant': tenant })");
    expect(section).not.toContain(".andWhere('tenant', tenant)");
    expect(section).not.toContain(".andWhere('ptd.tenant', tenant)");
    expect(section).not.toContain(".where('tenant', tenant)");
    expect(section).not.toContain(".where('pt.tenant', tenant)");
  });
});
