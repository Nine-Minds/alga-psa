import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const source = readFileSync(resolve(__dirname, 'projectTaskActions.ts'), 'utf8');
const section = source.slice(
  source.indexOf('export const getTaskWithDetails'),
  source.indexOf('export const cleanupOrderKeysForStatus')
);

describe('project task detail and reorder tenant-scoped query contract', () => {
  it('uses structural tenant scoping for task detail and reorder roots', () => {
    expect(section).toContain("tenantScopedTable(trx, 'project_tasks', tenant)");
    expect(section).toContain(".andOn('project_tasks.tenant', '=', 'project_phases.tenant')");
    expect(section).not.toContain(".andWhere('project_tasks.tenant', tenant)");
    expect(section).not.toContain(".where({ task_id: taskId, tenant })");
    expect(section).not.toContain(".where({ task_id: beforeTaskId, tenant })");
    expect(section).not.toContain(".where({ task_id: afterTaskId, tenant })");
    expect(section).not.toContain(".andWhere('tenant', tenant)");
  });
});
