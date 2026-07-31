import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const source = readFileSync(resolve(__dirname, 'projectTaskActions.ts'), 'utf8');
const section = source.slice(
  source.indexOf('export const addTaskDependency'),
  source.indexOf('export const getAllProjectTasksForListView')
);

describe('project task dependency action tenant-scoped query contract', () => {
  it('uses structural tenant scoping for dependency action roots', () => {
    expect(section).toContain("tenantScopedTable(trx, 'project_tasks', tenant)");
    expect(section).toContain("tenantScopedTable(trx, 'project_task_dependencies', tenant)");
    expect(section).not.toContain("trx('project_tasks').where({ task_id: actualPredecessorId, tenant })");
    expect(section).not.toContain("trx('project_tasks').where({ task_id: actualSuccessorId, tenant })");
    expect(section).not.toContain("trx('project_task_dependencies')");
    expect(section).not.toContain(".where({ dependency_id: dependencyId, tenant })");
    expect(section).not.toContain("'project_tasks.tenant': tenant");
  });
});
