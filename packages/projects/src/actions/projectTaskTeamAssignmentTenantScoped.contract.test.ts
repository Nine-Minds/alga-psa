import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const source = readFileSync(resolve(__dirname, 'projectTaskActions.ts'), 'utf8');
const section = source.slice(
  source.indexOf('export const addTaskResourcesAction'),
  source.indexOf('export const removeTaskResourceAction')
);

describe('project task team assignment tenant-scoped query contract', () => {
  it('uses structural tenant scoping for resource batch add and team assignment roots', () => {
    expect(section).toContain("tenantScopedTable(trx, 'project_tasks', tenant)");
    expect(section).toContain("tenantScopedTable(trx, 'task_resources', tenant)");
    expect(section).toContain("tenantScopedTable(trx, 'teams', tenant)");
    expect(section).toContain("tenantScopedTable(trx, 'project_phases', tenant)");
    expect(section).toContain("tenantScopedTable(trx, 'team_members', tenant)");
    expect(section).toContain(".andOn('team_members.tenant', 'users.tenant')");
    expect(section).not.toContain(".where({ task_id: taskId, tenant })");
    expect(section).not.toContain(".where({ team_id: teamId, tenant })");
    expect(section).not.toContain(".where({ phase_id: task.phase_id, tenant })");
    expect(section).not.toContain(".where({ 'team_members.team_id': teamId, 'team_members.tenant': tenant })");
    expect(section).not.toContain(".where({ task_id: taskId, tenant, additional_user_id:");
    expect(section).not.toContain(".where({ task_id: taskId, tenant, role: 'team_member' })");
  });
});
