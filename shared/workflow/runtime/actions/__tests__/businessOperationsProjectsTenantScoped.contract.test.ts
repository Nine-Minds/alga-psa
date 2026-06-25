import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const source = fs.readFileSync(path.resolve(__dirname, '../businessOperations/projects.ts'), 'utf8');
const helperSection = source.slice(
  source.indexOf('async function ensureProjectExists'),
  source.indexOf('async function ensureProjectDefaultStatusMappings')
);
const assignmentHelperSection = source.slice(
  source.indexOf('async function generateTaskWbsCode'),
  source.indexOf('async function canReadTickets')
);
const tagAuthHelperSection = source.slice(
  source.indexOf('async function ensureTagMappings'),
  source.indexOf('async function createProjectReadAuthorizer')
);
const createTaskSection = source.slice(
  source.indexOf("id: 'projects.create_task'"),
  source.indexOf("id: 'projects.find'")
);
const projectFindSearchSection = source.slice(
  source.indexOf("id: 'projects.find'"),
  source.indexOf("id: 'projects.find_phase'")
);
const phaseFindSearchSection = source.slice(
  source.indexOf("id: 'projects.find_phase'"),
  source.indexOf("id: 'projects.find_task'")
);
const taskFindSearchSection = source.slice(
  source.indexOf("id: 'projects.find_task'"),
  source.indexOf("id: 'projects.update'")
);
const updateSection = source.slice(
  source.indexOf("id: 'projects.update'"),
  source.indexOf("id: 'projects.move_task'")
);
const moveTaskSection = source.slice(
  source.indexOf("id: 'projects.move_task'"),
  source.indexOf("id: 'projects.assign_task'")
);
const assignTaskSection = source.slice(
  source.indexOf("id: 'projects.assign_task'"),
  source.indexOf("id: 'projects.duplicate_task'")
);
const duplicateTaskSection = source.slice(
  source.indexOf("id: 'projects.duplicate_task'"),
  source.indexOf("id: 'projects.delete_task'")
);
const deleteSection = source.slice(
  source.indexOf("id: 'projects.delete_task'"),
  source.indexOf("id: 'projects.link_ticket_to_task'")
);

describe('project workflow business operations tenant-scoped query contract', () => {
  it('uses structural tenant scoping for shared project helper roots', () => {
    expect(source).toContain("import { createTenantScopedQuery } from '@alga-psa/db'");
    expect(source).toContain('function tenantScopedTable(tx: TenantTxContext, table: string)');
    expect(helperSection).toContain("tenantScopedTable(tx, 'projects')");
    expect(helperSection).toContain("tenantScopedTable(tx, 'project_phases')");
    expect(helperSection).toContain("tenantScopedTable(tx, 'project_tasks as pt')");
    expect(helperSection).toContain("tenantScopedTable(tx, 'tickets')");
    expect(helperSection).toContain("tenantScopedTable(tx, 'project_status_mappings')");
    expect(helperSection).toContain("tenantScopedTable(tx, 'project_status_mappings as psm')");
    expect(helperSection).not.toContain("tx.trx('projects').where({ tenant: tx.tenantId");
    expect(helperSection).not.toContain("tx.trx('project_phases').where({ tenant: tx.tenantId");
    expect(helperSection).not.toContain("tx.trx('project_tasks as pt')");
    expect(helperSection).not.toContain("tx.trx('tickets').where({ tenant: tx.tenantId");
    expect(helperSection).not.toContain("tx.trx('project_status_mappings')");
    expect(helperSection).not.toContain(".where({ 'psm.tenant': tx.tenantId");
    expect(helperSection).not.toContain(".where({ 'pt.tenant': tx.tenantId");
  });

  it('uses structural tenant scoping for task assignment helper roots', () => {
    expect(assignmentHelperSection).toContain("tenantScopedTable(tx, 'project_tasks')");
    expect(assignmentHelperSection).toContain("tenantScopedTable(tx, 'task_resources')");
    expect(assignmentHelperSection).toContain("tenantScopedTable(tx, 'users')");
    expect(assignmentHelperSection).not.toContain("tx.trx('project_tasks')");
    expect(assignmentHelperSection).not.toContain("tx.trx('users')");
    expect(assignmentHelperSection).not.toContain(".where({ tenant: tx.tenantId");
  });

  it('uses structural tenant scoping for tag and authorization helper roots', () => {
    expect(tagAuthHelperSection).toContain("tenantScopedTable(tx, 'tag_definitions')");
    expect(tagAuthHelperSection).toContain("tenantScopedTable(tx, 'tag_mappings')");
    expect(tagAuthHelperSection).toContain("tenantScopedTable(tx, 'users')");
    expect(tagAuthHelperSection).toContain("tenantScopedTable(tx, 'user_roles')");
    expect(tagAuthHelperSection).toContain("tenantScopedTable(tx, 'team_members')");
    expect(tagAuthHelperSection).not.toContain(".where({ tenant: tx.tenantId");
    expect(tagAuthHelperSection).not.toContain("tx.trx('user_roles')");
    expect(tagAuthHelperSection).not.toContain("tx.trx('team_members')");
  });

  it('uses structural tenant scoping for create-task validation roots', () => {
    expect(createTaskSection).toContain("tenantScopedTable(tx, 'projects')");
    expect(createTaskSection).toContain("tenantScopedTable(tx, 'project_phases')");
    expect(createTaskSection).toContain("tenantScopedTable(tx, 'teams')");
    expect(createTaskSection).toContain("tenantScopedTable(tx, 'users')");
    expect(createTaskSection).toContain("tenantScopedTable(tx, 'statuses')");
    expect(createTaskSection).toContain("tenantScopedTable(tx, 'project_tasks')");
    expect(createTaskSection).not.toContain("tx.trx('projects').where({ tenant: tx.tenantId");
    expect(createTaskSection).not.toContain("tx.trx('project_phases')");
    expect(createTaskSection).not.toContain("tx.trx('teams').where({ tenant: tx.tenantId");
    expect(createTaskSection).not.toContain("tx.trx('users').where({ tenant: tx.tenantId");
    expect(createTaskSection).not.toContain("tx.trx('statuses')");
    expect(createTaskSection).not.toContain(".where({ tenant: tx.tenantId");
  });

  it('uses structural tenant scoping for project find/search roots', () => {
    expect(projectFindSearchSection).toContain("tenantScopedTable(tx, 'projects')");
    expect(projectFindSearchSection).toContain("tenantScopedTable(tx, 'projects as p')");
    expect(projectFindSearchSection).not.toContain("tx.trx('projects').where({ tenant: tx.tenantId");
    expect(projectFindSearchSection).not.toContain("tx.trx('projects')");
    expect(projectFindSearchSection).not.toContain("tx.trx('projects as p')");
    expect(projectFindSearchSection).not.toContain(".where({ tenant: tx.tenantId");
    expect(projectFindSearchSection).not.toContain(".where({ 'p.tenant': tx.tenantId");
  });

  it('uses structural tenant scoping for phase find/search roots', () => {
    expect(phaseFindSearchSection).toContain("tenantScopedTable(tx, 'project_phases')");
    expect(phaseFindSearchSection).toContain("tenantScopedTable(tx, 'project_phases as pp')");
    expect(phaseFindSearchSection).not.toContain("tx.trx('project_phases')");
    expect(phaseFindSearchSection).not.toContain(".where({ tenant: tx.tenantId");
    expect(phaseFindSearchSection).not.toContain(".where({ 'pp.tenant': tx.tenantId");
  });

  it('uses structural tenant scoping for task find/search roots', () => {
    expect(taskFindSearchSection).toContain("tenantScopedTable(tx, 'project_tasks as pt')");
    expect(taskFindSearchSection).not.toContain("tx.trx('project_tasks as pt')");
    expect(taskFindSearchSection).not.toContain(".where({ 'pt.tenant': tx.tenantId");
  });

  it('uses structural tenant scoping for project/phase/task update roots', () => {
    expect(updateSection).toContain("tenantScopedTable(tx, 'projects')");
    expect(updateSection).toContain("tenantScopedTable(tx, 'project_phases')");
    expect(updateSection).toContain("tenantScopedTable(tx, 'project_tasks')");
    expect(updateSection).not.toContain("tx.trx('projects')");
    expect(updateSection).not.toContain("tx.trx('project_phases')");
    expect(updateSection).not.toContain("tx.trx('project_tasks')");
    expect(updateSection).not.toContain(".where({ tenant: tx.tenantId");
  });

  it('uses structural tenant scoping for move-task roots', () => {
    expect(moveTaskSection).toContain("tenantScopedTable(tx, 'project_tasks')");
    expect(moveTaskSection).toContain("tenantScopedTable(tx, 'project_ticket_links')");
    expect(moveTaskSection).not.toContain("tx.trx('project_tasks')");
    expect(moveTaskSection).not.toContain("tx.trx('project_ticket_links')");
    expect(moveTaskSection).not.toContain(".where({ tenant: tx.tenantId");
  });

  it('uses structural tenant scoping for assign-task roots', () => {
    expect(assignTaskSection).toContain("tenantScopedTable(tx, 'project_tasks')");
    expect(assignTaskSection).not.toContain("tx.trx('project_tasks')");
    expect(assignTaskSection).not.toContain(".where({ tenant: tx.tenantId");
  });

  it('uses structural tenant scoping for duplicate-task read roots', () => {
    expect(duplicateTaskSection).toContain("tenantScopedTable(tx, 'project_tasks')");
    expect(duplicateTaskSection).toContain("tenantScopedTable(tx, 'task_checklist_items')");
    expect(duplicateTaskSection).toContain("tenantScopedTable(tx, 'task_resources')");
    expect(duplicateTaskSection).toContain("tenantScopedTable(tx, 'project_ticket_links')");
    expect(duplicateTaskSection).toContain("tenantScopedTable(tx, 'tickets')");
    expect(duplicateTaskSection).not.toContain(".where({ tenant: tx.tenantId");
    expect(duplicateTaskSection).not.toContain("tx.trx('tickets').where({ tenant: tx.tenantId");
  });

  it('uses structural tenant scoping for delete workflow roots', () => {
    expect(source).toContain('const query = whereBuilder(tenantScopedTable(tx, tableName));');
    expect(deleteSection).toContain("tenantScopedTable(tx, 'time_entries')");
    expect(deleteSection).toContain("tenantScopedTable(tx, 'project_task_comments')");
    expect(deleteSection).toContain("tenantScopedTable(tx, 'project_tasks')");
    expect(deleteSection).toContain("tenantScopedTable(tx, 'project_phases')");
    expect(deleteSection).toContain("tenantScopedTable(tx, 'projects')");
    expect(deleteSection).not.toContain(".where({ tenant: tx.tenantId");
    expect(deleteSection).not.toContain("query.where({ tenant: tx.tenantId");
    expect(deleteSection).not.toContain("tx.trx('project_tasks')");
    expect(deleteSection).not.toContain("tx.trx('project_phases')");
    expect(deleteSection).not.toContain("tx.trx('projects')");
  });
});
