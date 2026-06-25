import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const source = fs.readFileSync(path.join(__dirname, 'acl.ts'), 'utf8');

describe('search ACL visibility verifier tenant-scoped query contract', () => {
  it('uses the tenantDb facade for tenant-aware verifier roots', () => {
    expect(source).toContain("import { tenantDb } from '@alga-psa/db';");
    expect(source).toContain('function tenantScopedRoot<Row extends object>');
    expect(source).toContain('tenantDb(knex, user.tenant).table<Row>(tableExpression)');
    expect(source).toContain("tenantDb(knex, user.tenant).tenantJoin(query, 'project_phases as pp'");
    expect(source).toContain("db.tenantJoin(query, 'project_tasks as pt'");
    expect(source).toContain("db.tenantJoin(query, 'project_phases as pp'");
    expect(source).not.toContain("query.andWhere('tenant', user.tenant)");
    expect(source).not.toContain("query.andWhere('pt.tenant', user.tenant)");
    expect(source).not.toContain("query.andWhere('ptc.tenant', user.tenant)");
  });
});
