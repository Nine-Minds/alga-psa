import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const source = readFileSync(resolve(__dirname, 'projectTemplateActions.ts'), 'utf8');

function section(start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

describe('project template create-from-project tenant-scoped query contract', () => {
  it('uses structural tenant scoping for template status mapping helper roots', () => {
    const helperSource = section(
      'async function getScopedTemplateStatusMappings',
      '/**\n * Create a template from an existing project'
    );

    expect(helperSource).toContain("tenantScopedTable(trx, 'project_template_status_mappings', tenant)");
    expect(helperSource).not.toContain(".where({ tenant, template_id: templateId })");
  });

  it('uses structural tenant scoping for createTemplateFromProject read roots', () => {
    const actionSource = section(
      'export const createTemplateFromProject',
      '/**\n * Apply a template to create a new project'
    );

    expect(actionSource).toContain("tenantScopedTable(trx, 'projects', tenant)");
    expect(actionSource).toContain("tenantScopedTable(trx, 'project_phases', tenant)");
    expect(actionSource).toContain("tenantScopedTable(trx, 'project_status_mappings', tenant)");
    expect(actionSource).toContain("tenantScopedTable(trx, 'project_tasks', tenant)");
    expect(actionSource).toContain("tenantScopedTable(trx, 'task_resources', tenant)");
    expect(actionSource).toContain("tenantScopedTable(trx, 'project_task_dependencies', tenant)");
    expect(actionSource).toContain("tenantScopedTable(trx, 'task_checklist_items', tenant)");
    expect(actionSource).not.toContain('.where({ project_id: projectId, tenant })');
    expect(actionSource).not.toContain(".where('tenant', tenant)");
    expect(actionSource).not.toContain('.where({ task_id: task.task_id, tenant })');
  });
});
