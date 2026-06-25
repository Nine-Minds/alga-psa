import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('job actions tenant-scoped query contract', () => {
  it('uses structural tenant scoping for job action roots', () => {
    const source = readFileSync(resolve(__dirname, 'job-actions.ts'), 'utf8');
    expect(source).toContain('createTenantScopedQuery(conn, {');
    expect(source).toContain("tenantScopedTable(knex, 'jobs', tenant)");
    expect(source).toContain("tenantScopedTable(trx, 'job_details', tenant)");

    expect(source).not.toContain('.where({ tenant })');
    expect(source).not.toContain(".where('tenant', tenant)");
  });

  it('uses structural tenant scoping for job progress aliases', () => {
    const source = readFileSync(resolve(__dirname, 'job-actions/getJobProgressAction.ts'), 'utf8');
    expect(source).toContain("table: 'jobs as j'");
    expect(source).toContain("alias: 'j'");
    expect(source).toContain("table: 'job_details as jd'");
    expect(source).toContain("alias: 'jd'");

    expect(source).not.toContain(".andWhere('j.tenant', tenant)");
    expect(source).not.toContain(".andWhere('jd.tenant', tenant)");
  });
});
