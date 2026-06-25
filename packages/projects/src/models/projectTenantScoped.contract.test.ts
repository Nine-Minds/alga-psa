import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const source = readFileSync(resolve(__dirname, 'project.ts'), 'utf8');

describe('project model tenant-scoped query contract', () => {
  it('uses structural tenant scoping for project and phase model roots', () => {
    expect(source).toContain("tenantScopedTable(knexOrTrx, 'projects', tenant)");
    expect(source).toContain("tenantScopedTable(knexOrTrx, 'project_phases', tenant)");
    expect(source).toContain("tenantScopedTable(knexOrTrx, 'project_status_mappings', tenant)");
    expect(source).toContain("tenantScopedTable(knexOrTrx, 'statuses', tenant)");
    expect(source).toContain("tenantScopedTable(trx, 'project_phases', tenant)");
    expect(source).toContain("tenantScopedTable(trx, 'project_tasks', tenant)");
    expect(source).toContain("tenantScopedTable(trx, 'time_entries', tenant)");
    expect(source).toContain("tenantScopedTable(trx, 'project_task_dependencies', tenant)");
    expect(source).toContain("tenantScopedTable(trx, 'project_task_comments', tenant)");
    expect(source).toContain("tenantScopedTable(trx, 'project_task_comment_reactions', tenant)");
    expect(source).toContain("tenantScopedTable(trx, 'task_resources', tenant)");
    expect(source).toContain("tenantScopedTable(trx, 'task_checklist_items', tenant)");
    expect(source).toContain("tenantScopedTable(trx, 'project_ticket_links', tenant)");
    expect(source).toContain("tenantScopedTable(trx, 'projects', tenant)");
    expect(source).toContain("knexOrTrx<IStandardStatus>('standard_statuses')");
    expect(source).not.toContain(".where('projects.tenant', tenant)");
    expect(source).not.toContain(".andWhere('tenant', tenant)");
    expect(source).not.toContain(".where({ project_id: phaseData.project_id, tenant })");
    expect(source).not.toContain(".where({ client_id: clientId, tenant })");
  });
});
