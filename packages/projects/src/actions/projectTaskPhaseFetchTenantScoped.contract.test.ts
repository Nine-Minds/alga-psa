import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const source = readFileSync(resolve(__dirname, 'projectTaskActions.ts'), 'utf8');
const section = source.slice(
  source.indexOf('export const getTasksForPhase'),
  source.indexOf('export const addTaskResourceAction')
);

describe('project task phase fetch tenant-scoped query contract', () => {
  it('uses structural tenant scoping for phase task batch lookups', () => {
    expect(section).toContain("tenantScopedTable(trx, 'project_phases', tenant)");
    expect(section).toContain("tenantScopedTable(trx, 'task_checklist_items', tenant)");
    expect(source).toContain("tenantScopedTable(trx, 'project_task_dependencies as ptd', tenant)");
    expect(section).toContain("projectTaskDependencyTaskQuery(trx, tenant, 'predecessor_task_id')");
    expect(section).toContain("projectTaskDependencyTaskQuery(trx, tenant, 'successor_task_id')");
    expect(source).toContain("tenantDb(trx, tenant).tenantJoin(query, 'project_tasks as pt', `ptd.${taskColumn}`, 'pt.task_id', { type: 'left' })");
    expect(section).not.toContain(".andWhere('tenant', tenant)");
    expect(section).not.toContain(".andWhere('ptd.tenant', tenant)");
  });
});
