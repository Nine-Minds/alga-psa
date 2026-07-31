import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const source = fs.readFileSync(
  path.resolve(__dirname, '../../lib/eventBus/subscribers/searchIndexSubscriber.ts'),
  'utf8',
);

describe('search index subscriber tenant-scoped query contract', () => {
  it('uses the tenantDb facade for cascade reindex roots', () => {
    expect(source).toContain("import { createTenantKnex, tenantDb } from '@alga-psa/db';");
    expect(source).toContain('function tenantScopedTable<Row extends object>');
    expect(source).toContain('tenantDb(knex, tenant).table<Row>(tableExpression)');
    expect(source).toContain("tenantScopedTable<{ comment_id: string }>(knex, tenant, 'comments')");
    expect(source).toContain("tenantScopedTable<{ task_comment_id: string }>(knex, tenant, 'project_task_comments')");
    expect(source).toContain("tenantScopedTable<{ item_id: string }>(knex, tenant, 'invoice_items')");
    expect(source).toContain("tenantScopedTable<{ annotation_id: string }>(");
    expect(source).toContain("tenantScopedTable<{ phase_id: string }>(knex, tenant, 'project_phases')");
    expect(source).toContain("db.table<{ task_id: string }>('project_tasks as pt')");
    expect(source).toContain("db.table<{ task_comment_id: string }>('project_task_comments as ptc')");
    expect(source).toContain("db.tenantJoin(query, 'project_phases as pp', 'pp.phase_id', 'pt.phase_id')");
    expect(source).toContain("db.tenantJoin(query, 'project_tasks as pt', 'pt.task_id', 'ptc.task_id')");
    expect(source).not.toContain(".where('tenant', tenant)");
    expect(source).not.toContain(".where('pt.tenant', tenant)");
    expect(source).not.toContain(".where('ptc.tenant', tenant)");
  });
});
