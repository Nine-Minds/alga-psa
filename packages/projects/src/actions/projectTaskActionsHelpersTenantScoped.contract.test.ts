import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const source = readFileSync(resolve(__dirname, 'projectTaskActions.ts'), 'utf8');

describe('project task action helper tenant-scoped query contract', () => {
  it('uses structural tenant scoping for shared status, authorization, assignee, and id-resolution helpers', () => {
    expect(source).toContain("tenantScopedTable(trx, 'project_status_mappings as psm', tenant)");
    expect(source).toContain("tenantScopedTable(trx, 'user_roles', tenant)");
    expect(source).toContain("tenantScopedTable(trx, 'team_members', tenant)");
    expect(source).toContain("tenantScopedTable(trx, 'users', tenant)");
    expect(source).toContain("tenantScopedTable(trx, 'tickets', tenant)");
    expect(source).toContain("tenantScopedTable(trx, 'ticket_resources', tenant)");
    expect(source).toContain("tenantScopedTable(trx, 'project_tasks', tenant)");
    expect(source).toContain("tenantScopedTable(trx, 'task_resources', tenant)");
    expect(source).toContain("tenantScopedTable(trx, 'project_phases', tenant)");
    expect(source).toContain("tenantScopedTable(trx, 'project_tasks as pt', tenant)");
    expect(source).toContain("tenantScopedTable(trx, 'task_checklist_items as tci', tenant)");
    expect(source).toContain("tenantScopedTable(trx, 'task_resources as tr', tenant)");
    expect(source).toContain("tenantScopedTable(trx, 'project_ticket_links', tenant)");
    expect(source).toContain("tenantDb(trx, tenant).tenantJoin(query, 'project_phases as pp', 'pt.phase_id', 'pp.phase_id')");
    expect(source).not.toContain(".where({ 'psm.project_status_mapping_id': projectStatusMappingId, 'psm.tenant': tenant })");
    expect(source).not.toContain(".where({ tenant, user_id: user.user_id })");
    expect(source).not.toContain(".where({ tenant, phase_id: phaseId })");
    expect(source).not.toContain(".where({ 'pt.tenant': tenant, 'pt.task_id': taskId })");
    expect(source).not.toContain(".where({ 'tci.tenant': tenant, 'tci.checklist_item_id': checklistItemId })");
    expect(source).not.toContain(".where({ 'tr.tenant': tenant, 'tr.assignment_id': assignmentId })");
    expect(source).not.toContain(".where({ tenant, link_id: linkId })");
    expect(source).not.toContain(".where({ tenant, ticket_id: ticketId })");
  });
});
