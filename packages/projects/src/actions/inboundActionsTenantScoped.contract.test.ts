import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const source = readFileSync(resolve(__dirname, 'inboundActions.ts'), 'utf8');

describe('project inbound actions tenant-scoped query contract', () => {
  it('uses structural tenant scoping for validation and lookup roots', () => {
    expect(source).toContain("tenantScopedTable(trx, 'projects', ctx.tenant)");
    expect(source).toContain("tenantScopedTable(trx, 'project_tasks as pt', ctx.tenant)");
    expect(source).toContain("tenantScopedTable(trx, 'project_phases', tenant)");
    expect(source).toContain("tenantScopedTable(trx, 'project_status_mappings', tenant)");
    expect(source).toContain(".andOn('pt.tenant', '=', 'pp.tenant')");
    expect(source).not.toContain('.where({ tenant: ctx.tenant, project_id: projectId })');
    expect(source).not.toContain("'pt.tenant': ctx.tenant");
    expect(source).not.toContain('.where({ tenant, project_id: projectId, phase_id: phaseId })');
    expect(source).not.toContain('.where({ tenant, project_status_mapping_id: statusMappingId })');
  });
});
