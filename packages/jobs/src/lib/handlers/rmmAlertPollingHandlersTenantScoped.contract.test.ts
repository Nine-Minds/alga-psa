import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const source = readFileSync(resolve(__dirname, 'rmmAlertPollingHandlers.ts'), 'utf8');

describe('RMM alert polling handlers tenant-scoped query contract', () => {
  it('uses structural tenant scoping for RMM integration and recurring job roots', () => {
    expect(source).toContain('createTenantScopedQuery');
    expect(source).toContain("tenantScopedTable(adminKnex, 'rmm_integrations', data.tenantId)");
    expect(source).toContain("tenantScopedTable(adminKnex, 'jobs', tenantId)");
    expect(source).not.toContain('.where({ tenant: data.tenantId');
    expect(source).not.toContain('.where({ tenant: tenantId })');
  });
});
