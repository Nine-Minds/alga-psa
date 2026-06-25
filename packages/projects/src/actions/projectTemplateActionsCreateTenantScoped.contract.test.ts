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

describe('project template tenant-scoped query contract', () => {
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

  it('uses structural tenant scoping for applyTemplate read and update roots', () => {
    const actionSource = section(
      'export const applyTemplate',
      '/**\n * Get all templates'
    );

    expect(actionSource).toContain("tenantScopedTable(trx, 'project_templates', tenant)");
    expect(actionSource).toContain("tenantScopedTable(trx, 'project_template_status_mappings', tenant)");
    expect(actionSource).toContain("tenantScopedTable(trx, 'projects', tenant)");
    expect(actionSource).toContain("tenantScopedTable(trx, 'project_template_phases', tenant)");
    expect(actionSource).toContain("tenantScopedTable(trx, 'project_phases', tenant)");
    expect(actionSource).toContain("tenantScopedTable(trx, 'statuses', tenant)");
    expect(actionSource).toContain("tenantScopedTable(trx, 'project_template_tasks', tenant)");
    expect(actionSource).toContain("tenantScopedTable(trx, 'project_tasks', tenant)");
    expect(actionSource).toContain("tenantScopedTable(trx, 'project_template_task_resources', tenant)");
    expect(actionSource).toContain("tenantScopedTable(trx, 'users', tenant)");
    expect(actionSource).toContain("tenantScopedTable(trx, 'project_template_dependencies', tenant)");
    expect(actionSource).toContain("tenantScopedTable(trx, 'project_template_checklist_items', tenant)");
    expect(actionSource).not.toContain('.where({ template_id: templateId, tenant })');
    expect(actionSource).not.toContain('.where({ project_id: newProjectId, tenant })');
    expect(actionSource).not.toContain('.where({ phase_id: newPhaseId, tenant })');
    expect(actionSource).not.toContain('.where({ task_id: newTaskId, tenant })');
    expect(actionSource).not.toContain('.where({ user_id: resource.user_id, tenant })');
    expect(actionSource).not.toContain(".where('tenant', tenant)");
    expect(actionSource).not.toContain('.where({ tenant, status_type:');
  });

  it('uses structural tenant scoping for template list and detail read roots', () => {
    const actionSource = section(
      'export const getTemplates',
      '/**\n * Update a template'
    );

    expect(actionSource).toContain("tenantScopedTable(knex, 'project_templates', tenant)");
    expect(actionSource).toContain("tenantScopedTable(knex, 'project_template_phases', tenant)");
    expect(actionSource).toContain("tenantScopedTable(knex, 'project_template_dependencies', tenant)");
    expect(actionSource).toContain("tenantScopedTable(knex, 'project_template_status_mappings', tenant)");
    expect(actionSource).toContain("tenantScopedTable(knex, 'statuses', tenant)");
    expect(actionSource).toContain("tenantScopedTable(knex, 'project_template_tasks', tenant)");
    expect(actionSource).toContain("tenantScopedTable(knex, 'project_template_checklist_items', tenant)");
    expect(actionSource).toContain("tenantScopedTable(knex, 'project_template_task_resources', tenant)");
    expect(actionSource).toContain("knex('standard_statuses')");
    expect(actionSource).not.toContain(".where({ tenant })");
    expect(actionSource).not.toContain('.where({ template_id: templateId, tenant })');
    expect(actionSource).not.toContain('.where({ status_id: mapping.status_id, tenant })');
    expect(actionSource).not.toContain(".where('tenant', tenant)");
  });

  it('uses structural tenant scoping for template update, delete, duplicate, and categories roots', () => {
    const actionSource = section(
      'export const updateTemplate',
      '// ============================================================\n// TEMPLATE DEPENDENCY ACTIONS'
    );

    expect(actionSource).toContain("tenantScopedTable(trx, 'project_templates', tenant)");
    expect(actionSource).toContain("tenantScopedTable(trx, 'project_template_phases', tenant)");
    expect(actionSource).toContain("tenantScopedTable(trx, 'project_template_tasks', tenant)");
    expect(actionSource).toContain("tenantScopedTable(trx, 'project_template_dependencies', tenant)");
    expect(actionSource).toContain("tenantScopedTable(trx, 'project_template_checklist_items', tenant)");
    expect(actionSource).toContain("tenantScopedTable(trx, 'project_template_status_mappings', tenant)");
    expect(actionSource).toContain("tenantScopedTable(knex, 'project_templates', tenant)");
    expect(actionSource).not.toContain(".where({ tenant })");
    expect(actionSource).not.toContain('.where({ template_id: templateId, tenant })');
    expect(actionSource).not.toContain(".where('tenant', tenant)");
  });

  it('uses structural tenant scoping for template dependency action roots', () => {
    const actionSource = section(
      'export const addTemplateDependency',
      '// ============================================================\n// GRANULAR UPDATE ACTIONS FOR TEMPLATE EDITOR'
    );

    expect(actionSource).toContain("tenantScopedTable(trx, 'project_template_tasks', tenant)");
    expect(actionSource).toContain("tenantScopedTable(trx, 'project_template_dependencies', tenant)");
    expect(actionSource).toContain("tenantScopedTable(knex, 'project_template_dependencies', tenant)");
    expect(actionSource).toContain("tenantScopedTable(knex, 'project_template_dependencies as ptd', tenant)");
    expect(actionSource).toContain(".andOn('ptd.tenant', '=', 'ptt.tenant')");
    expect(actionSource).not.toContain(".where('tenant', tenant)");
    expect(actionSource).not.toContain('.where({ template_dependency_id: dependencyId, tenant })');
    expect(actionSource).not.toContain(".where({ template_id: templateId, tenant })");
    expect(actionSource).not.toContain("'ptd.tenant': tenant");
    expect(actionSource).not.toContain("knex('project_template_dependencies as ptd')");
  });

  it('uses structural tenant scoping for template phase editor roots', () => {
    const actionSource = section(
      'export const addTemplatePhase',
      '/**\n * Add a new task to a template phase'
    );

    expect(actionSource).toContain("tenantScopedTable(trx, 'project_templates', tenant)");
    expect(actionSource).toContain("tenantScopedTable(trx, 'project_template_phases', tenant)");
    expect(actionSource).not.toContain('.where({ template_id: templateId, tenant })');
    expect(actionSource).not.toContain('.where({ template_id: updated.template_id, tenant })');
    expect(actionSource).not.toContain('.where({ template_id: phase.template_id, tenant })');
    expect(actionSource).not.toContain('.where({ template_phase_id: phaseId, tenant })');
    expect(actionSource).not.toContain('.where({ template_phase_id: beforePhaseId, tenant })');
    expect(actionSource).not.toContain('.where({ template_phase_id: afterPhaseId, tenant })');
  });
});
