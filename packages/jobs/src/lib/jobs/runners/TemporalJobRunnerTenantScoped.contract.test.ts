import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const source = readFileSync(resolve(__dirname, 'TemporalJobRunner.ts'), 'utf8');

describe('TemporalJobRunner tenant-scoped query contract', () => {
  it('uses structural tenant scoping for tenant-known job and user roots', () => {
    expect(source).toContain('createTenantScopedQuery');
    expect(source).toContain("tenantScopedTable(knex, 'jobs', tenantId)");
    expect(source).toContain("tenantScopedTable(knex, 'users', data.tenantId)");
    expect(source).not.toContain('.where({ job_id: jobId, tenant: tenantId })');
    expect(source).not.toContain('.where({ tenant: data.tenantId })');
  });
});
