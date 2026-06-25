import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../../..');

function read(relativePath: string): string {
  return fs.readFileSync(path.resolve(repoRoot, relativePath), 'utf8');
}

describe('analytics and task inbox tenant facade roots', () => {
  it('routes tenant-owned settings and workflow task/form roots through tenantDb', () => {
    const analyticsSource = read('packages/analytics/src/analyticsSettings.ts');
    const taskInboxSource = read('shared/task-inbox/taskInboxService.ts');

    expect(analyticsSource).toContain("tenantDb(trx, tenant).table('tenant_settings')");
    expect(analyticsSource).not.toContain("trx('tenant_settings')");
    expect(analyticsSource).not.toMatch(/\.where\(\s*\{\s*tenant\s*\}/);

    expect(taskInboxSource).toContain("tenantScopedTable(knex, tenant, 'workflow_task_definitions')");
    expect(taskInboxSource).toContain("tenantScopedTable(trx, tenant, 'workflow_form_definitions')");
    expect(taskInboxSource).toContain("tenantScopedTable(trx, tenant, 'workflow_form_schemas')");
    expect(taskInboxSource).toContain("tenantScopedTable(trx, tenant, 'workflow_tasks')");
    expect(taskInboxSource).not.toMatch(/\.where\(\s*\{\s*tenant:\s*tenant/);
  });

  it('registers workflow task inbox tables in tenant metadata', () => {
    const metadataSource = read('packages/db/src/lib/tenantTableMetadata.ts');

    expect(metadataSource).toContain("workflow_form_definitions: { scope: 'tenant' }");
    expect(metadataSource).toContain("workflow_form_schemas: { scope: 'tenant' }");
    expect(metadataSource).toContain("workflow_task_definitions: { scope: 'tenant' }");
  });
});
