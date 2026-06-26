import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const source = readFileSync(resolve(__dirname, 'phaseTaskImportActions.ts'), 'utf8');

describe('phase task import tenant-scoped query contract', () => {
  it('uses structural tenant scoping for import reference and status roots', () => {
    expect(source).toContain("tenantScopedTable(trx, 'project_status_mappings as psm', tenant)");
    expect(source).toContain("tenantScopedTable(trx, 'users', tenant)");
    expect(source).toContain("tenantScopedTable(trx, 'priorities', tenant)");
    expect(source).toContain("tenantScopedTable(trx, 'service_catalog', tenant)");
    expect(source).toContain("tenantScopedTable(trx, 'statuses', tenant)");
    expect(source).toContain("tenantScopedTable(trx, 'project_status_mappings', tenant)");
    expect(source).toContain("db.tenantJoin(query, 'statuses as s', 'psm.status_id', 's.status_id', { type: 'left' })");
    expect(source).toContain("db.tenantJoin(statusMappingsQuery, 'statuses as s', 'psm.status_id', 's.status_id', { type: 'left' })");
    expect(source).not.toContain("'psm.tenant': tenant");
    expect(source).not.toContain(".where('tenant', tenant)");
    expect(source).not.toContain('.where({ tenant, name: statusName, status_type:');
    expect(source).not.toContain('.where({ tenant, status_type:');
    expect(source).not.toContain('.where({ tenant, project_id: projectId, status_id:');
  });
});
