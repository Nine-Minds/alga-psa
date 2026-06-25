import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const source = readFileSync(resolve(__dirname, 'taskDependency.ts'), 'utf8');

describe('task dependency tenant-scoped query contract', () => {
  it('uses structural tenant scoping for dependency roots', () => {
    expect(source).toContain("tenantScopedTable(knexOrTrx, 'project_task_dependencies', tenant)");
    expect(source).toContain("tenantScopedTable(knexOrTrx, 'project_task_dependencies as ptd', tenant)");
    expect(source).toContain("tenantScopedTable(db, 'project_task_dependencies', tenant)");
    expect(source).toContain(".andOn('ptd.tenant', '=', 'pt_pred.tenant')");
    expect(source).toContain(".andOn('ptd.tenant', '=', 'pt_succ.tenant')");
    expect(source).not.toContain('tenant,\n                predecessor_task_id');
    expect(source).not.toContain("'ptd.tenant': tenant");
    expect(source).not.toContain('.where({ dependency_id: dependencyId, tenant })');
  });
});
