import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const source = readFileSync(resolve(__dirname, 'projectTask.ts'), 'utf8');

describe('project task model tenant-scoped query contract', () => {
  it('uses structural tenant scoping for task, checklist, resource, and ticket-link roots', () => {
    expect(source).toContain("tenantScopedTable(knexOrTrx, 'project_tasks', tenant)");
    expect(source).toContain("tenantScopedTable(trx, 'project_task_dependencies', tenant)");
    expect(source).toContain("tenantScopedTable(trx, 'project_task_comments', tenant)");
    expect(source).toContain("tenantScopedTable(trx, 'project_task_comment_reactions', tenant)");
    expect(source).toContain("tenantScopedTable(trx, 'task_resources', tenant)");
    expect(source).toContain("tenantScopedTable(trx, 'task_checklist_items', tenant)");
    expect(source).toContain("tenantScopedTable(knexOrTrx, 'task_checklist_items', tenant)");
    expect(source).toContain("tenantScopedTable(knexOrTrx, 'task_resources', tenant)");
    expect(source).toContain("tenantScopedTable(knexOrTrx, 'project_ticket_links', tenant)");
    expect(source).toContain("tenantScopedTable(knexOrTrx, 'project_phases', tenant)");
    expect(source).toContain("db.tenantJoin(tasksQuery, 'project_phases', 'project_tasks.phase_id', 'project_phases.phase_id')");
    expect(source).toContain("db.tenantJoin(linksQuery, 'tickets', 'project_ticket_links.ticket_id', 'tickets.ticket_id', { type: 'left' })");
    expect(source).toContain("db.tenantJoin(linksQuery, 'statuses', 'tickets.status_id', 'statuses.status_id', { type: 'left' })");
    expect(source).toContain("db.tenantJoin(linksQuery, 'standard_statuses as ss', 'psm.standard_status_id', 'ss.standard_status_id', { type: 'left' })");
    expect(source).not.toContain(".andWhere('tenant', tenant)");
    expect(source).not.toContain(".where('tenant', tenant)");
    expect(source).not.toContain(".where({ checklist_item_id: checklistItemId, tenant })");
    expect(source).not.toContain(".where({ phase_id: phaseId, tenant })");
    expect(source).not.toContain(".where({ task_id: taskId, additional_user_id: userId, tenant })");
  });
});
