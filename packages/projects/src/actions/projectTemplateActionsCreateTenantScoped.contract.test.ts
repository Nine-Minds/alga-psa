import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const source = readFileSync(resolve(__dirname, 'projectTemplateActions.ts'), 'utf8');
const applyTemplateSource = readFileSync(
  resolve(__dirname, '../services/applyProjectTemplate.ts'),
  'utf8'
);

function section(start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

function sectionToEnd(start: string): string {
  const startIndex = source.indexOf(start);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  return source.slice(startIndex);
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

    expect(actionSource).toContain('applyProjectTemplate(trx, tenant, templateId, projectData)');
    expect(applyTemplateSource).toContain("tenantScopedTable(trx, 'project_templates', tenant)");
    expect(applyTemplateSource).toContain("tenantScopedTable(trx, 'project_template_status_mappings', tenant)");
    expect(applyTemplateSource).toContain("tenantScopedTable(trx, 'projects', tenant)");
    expect(applyTemplateSource).toContain("tenantScopedTable(trx, 'project_template_phases', tenant)");
    expect(applyTemplateSource).toContain("tenantScopedTable(trx, 'project_phases', tenant)");
    expect(applyTemplateSource).toContain("tenantScopedTable(trx, 'statuses', tenant)");
    expect(applyTemplateSource).toContain("tenantScopedTable(trx, 'project_template_tasks', tenant)");
    expect(applyTemplateSource).toContain("tenantScopedTable(trx, 'project_tasks', tenant)");
    expect(applyTemplateSource).toContain("tenantScopedTable(trx, 'project_template_task_resources', tenant)");
    expect(applyTemplateSource).toContain("tenantScopedTable(trx, 'users', tenant)");
    expect(applyTemplateSource).toContain("tenantScopedTable(trx, 'project_template_dependencies', tenant)");
    expect(applyTemplateSource).toContain("tenantScopedTable(trx, 'project_template_checklist_items', tenant)");
    expect(applyTemplateSource).not.toContain('.where({ template_id: templateId, tenant })');
    expect(applyTemplateSource).not.toContain('.where({ project_id: newProjectId, tenant })');
    expect(applyTemplateSource).not.toContain('.where({ phase_id: newPhaseId, tenant })');
    expect(applyTemplateSource).not.toContain('.where({ task_id: newTaskId, tenant })');
    expect(applyTemplateSource).not.toContain('.where({ user_id: resource.user_id, tenant })');
    expect(applyTemplateSource).not.toContain(".where('tenant', tenant)");
    expect(applyTemplateSource).not.toContain('.where({ tenant, status_type:');
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
    expect(actionSource).toContain("tenantDb(knex, tenant).table('standard_statuses')");
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
    expect(actionSource).toContain("db.tenantJoin(predecessorsQuery, 'project_template_tasks as ptt', 'ptd.predecessor_task_id', 'ptt.template_task_id', { type: 'left' })");
    expect(actionSource).toContain("db.tenantJoin(successorsQuery, 'project_template_tasks as ptt', 'ptd.successor_task_id', 'ptt.template_task_id', { type: 'left' })");
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

  it('uses structural tenant scoping for template task editor roots', () => {
    const actionSource = section(
      'export const addTemplateTask',
      '/**\n * Add a status mapping to a template'
    );

    expect(actionSource).toContain("tenantScopedTable(trx, 'project_template_phases', tenant)");
    expect(actionSource).toContain("tenantScopedTable(trx, 'project_template_tasks', tenant)");
    expect(actionSource).toContain("tenantScopedTable(trx, 'project_templates', tenant)");
    expect(actionSource).not.toContain('.where({ template_phase_id: phaseId, tenant })');
    expect(actionSource).not.toContain('.where({ template_phase_id: updated.template_phase_id, tenant })');
    expect(actionSource).not.toContain('.where({ template_phase_id: task.template_phase_id, tenant })');
    expect(actionSource).not.toContain('.where({ template_phase_id: targetPhaseId, tenant })');
    expect(actionSource).not.toContain('.where({ template_task_id: taskId, tenant })');
    expect(actionSource).not.toContain('.where({ template_task_id: beforeTaskId, tenant })');
    expect(actionSource).not.toContain('.where({ template_task_id: afterTaskId, tenant })');
    expect(actionSource).not.toContain('.where({ template_id: phase.template_id, tenant })');
  });

  it('uses structural tenant scoping for template status mapping roots', () => {
    const actionSource = section(
      'export const addTemplateStatusMapping',
      '// ============================================================\n// TASK RESOURCE (ADDITIONAL AGENTS) ACTIONS'
    );

    expect(actionSource).toContain("tenantScopedTable(trx, 'statuses', tenant)");
    expect(actionSource).toContain("tenantScopedTable(trx, 'project_templates', tenant)");
    expect(actionSource).toContain("tenantScopedTable(trx, 'project_template_status_mappings', tenant)");
    expect(actionSource).toContain("tenantScopedTable(trx, 'project_template_tasks', tenant)");
    expect(actionSource).not.toContain('.where({ status_id: data.status_id, tenant })');
    expect(actionSource).not.toContain('.where({ template_status_mapping_id: mappingId, tenant })');
    expect(actionSource).not.toContain('.where({ template_status_mapping_id: orderedMappingIds[i], tenant })');
    expect(actionSource).not.toContain('.where({ template_id: templateId, tenant })');
    expect(actionSource).not.toContain('.where({ template_id: mapping.template_id, tenant })');
    expect(actionSource).not.toContain('.where({\n        tenant,');
  });

  it('uses structural tenant scoping for template task resource roots', () => {
    const actionSource = section(
      'export const getTaskAdditionalAgents',
      '// ============================================================\n// TEMPLATE CHECKLIST ACTIONS'
    );

    expect(actionSource).toContain("tenantScopedTable(knex, 'project_template_task_resources', tenant)");
    expect(actionSource).toContain("tenantScopedTable(trx, 'project_template_tasks', tenant)");
    expect(actionSource).toContain("tenantScopedTable(trx, 'project_template_task_resources', tenant)");
    expect(actionSource).toContain("tenantScopedTable(trx, 'project_template_phases', tenant)");
    expect(actionSource).toContain("tenantScopedTable(trx, 'project_templates', tenant)");
    expect(actionSource).not.toContain('.where({ template_task_id: taskId, tenant })');
    expect(actionSource).not.toContain('.where({ template_task_id: taskId, user_id: userId, tenant })');
    expect(actionSource).not.toContain('.where({ template_phase_id: task.template_phase_id, tenant })');
    expect(actionSource).not.toContain('.where({ template_id: phase.template_id, tenant })');
  });

  it('uses structural tenant scoping for template checklist roots', () => {
    const actionSource = sectionToEnd('export const getTemplateTaskChecklistItems');

    expect(actionSource).toContain("tenantScopedTable(knex, 'project_template_checklist_items', tenant)");
    expect(actionSource).toContain("tenantScopedTable(trx, 'project_template_tasks', tenant)");
    expect(actionSource).toContain("tenantScopedTable(trx, 'project_template_checklist_items', tenant)");
    expect(actionSource).toContain("tenantScopedTable(trx, 'project_template_phases', tenant)");
    expect(actionSource).toContain("tenantScopedTable(trx, 'project_templates', tenant)");
    expect(actionSource).not.toContain('.where({ template_task_id: taskId, tenant })');
    expect(actionSource).not.toContain('.where({ template_checklist_id: checklistId, tenant })');
    expect(actionSource).not.toContain('.where({ template_task_id: updated.template_task_id, tenant })');
    expect(actionSource).not.toContain('.where({ template_task_id: item.template_task_id, tenant })');
    expect(actionSource).not.toContain('.where({ template_phase_id: task.template_phase_id, tenant })');
    expect(actionSource).not.toContain('.where({ template_id: phase.template_id, tenant })');
    expect(actionSource).not.toContain('.andWhere({ tenant })');
  });
});
