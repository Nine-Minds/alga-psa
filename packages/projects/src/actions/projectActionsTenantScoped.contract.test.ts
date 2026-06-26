import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const source = readFileSync(resolve(__dirname, 'projectActions.ts'), 'utf8');

function sectionBetween(startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);

  return source.slice(start, end);
}

describe('project actions tenant-scoped query contract', () => {
  it('uses structural tenant scoping for project action roots', () => {
    expect(source).toContain("tenantScopedTable(params.knexOrTrx, 'contacts', params.tenant)");
    expect(source).toContain("tenantScopedTable(trx, 'user_roles', tenant)");
    expect(source).toContain("tenantScopedTable(trx, 'team_members', tenant)");
    expect(source).toContain("tenantScopedTable(trx, 'users', tenant)");
    expect(source).toContain("tenantScopedTable(trx, 'project_phases', tenant)");
    expect(source).toContain("tenantScopedTable(trx, 'project_status_mappings', tenant)");
    expect(source).toContain("tenantScopedTable(trx, 'clients', tenant)");
    expect(source).toContain("tenantScopedTable(trx, 'projects', tenant)");
    expect(source).toContain("tenantScopedTable(trx, 'project_status_mappings as psm', tenant)");
    expect(source).toContain("db.tenantJoin(statusMappingsQuery, 'standard_statuses as ss'");
    expect(source).toContain("tenantScopedTable(trx as Knex.Transaction, 'project_tasks', tenantId)");
    expect(source).toContain("tenantScopedTable(trx as Knex.Transaction, 'project_ticket_links', tenantId)");
    expect(source).toContain("tenantScopedTable(trx as Knex.Transaction, 'email_reply_tokens', tenantId)");
    expect(source).toContain("tenantScopedTable(trx as Knex.Transaction, 'user_preferences', tenantId)");
    expect(source).toContain("tenantScopedTable(trx, 'statuses', tenant)");
    expect(source).toContain("tenantDb(trx, tenant).table<IStandardStatus>('standard_statuses')");
    expect(source).not.toContain(".where({ tenant })");
    expect(source).not.toContain(".where('tenant', tenant)");
    expect(source).not.toContain(".andWhere('tenant', tenant)");
    expect(source).not.toContain(".andWhere('tenant', tenantId)");
    expect(source).not.toContain(".where({ phase_id: phaseId, tenant })");
    expect(source).not.toContain(".where({ project_id: projectId, tenant: tenantId })");
  });

  it('uses facade-derived tables for project list indexed search joins', () => {
    const searchSection = sectionBetween('export const searchProjectListIds', 'export const getProjectsWithPhases');

    expect(searchSection).toContain("const searchIndex = tenantScopedDerivedTableSql(trx, tenant, 'app_search_index', 'si');");
    expect(searchSection).toContain("const projectTasks = tenantScopedDerivedTableSql(trx, tenant, 'project_tasks', 'pt');");
    expect(searchSection).toContain("const projectPhases = tenantScopedDerivedTableSql(trx, tenant, 'project_phases', 'ph');");
    expect(searchSection).toContain('pt.tenant = si.tenant');
    expect(searchSection).toContain('ph.tenant = pt.tenant');
    expect(searchSection).not.toContain('FROM app_search_index si');
    expect(searchSection).not.toContain('WHERE si.tenant = ?');
  });
});
