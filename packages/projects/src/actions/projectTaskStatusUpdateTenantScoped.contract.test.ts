import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const source = readFileSync(resolve(__dirname, 'projectTaskActions.ts'), 'utf8');
const section = source.slice(
  source.indexOf('export const updateTaskStatus'),
  source.indexOf('export const addChecklistItemToTask')
);

describe('project task status update tenant-scoped query contract', () => {
  it('uses structural tenant scoping for status update task/status roots', () => {
    expect(section).toContain("tenantScopedTable(trx, 'project_tasks', tenant)");
    expect(section).toContain("tenantScopedTable(trx, 'project_status_mappings', tenant)");
    expect(section).not.toContain(".andWhere('tenant', tenant)");
    expect(section).not.toContain(".where({ task_id: beforeTaskId, tenant })");
    expect(section).not.toContain(".where({ task_id: afterTaskId, tenant })");
    expect(section).not.toContain('project_status_mapping_id: projectStatusMappingId,\n                        tenant');
  });
});
