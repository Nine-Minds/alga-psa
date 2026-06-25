// @vitest-environment node

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../../../..');

describe('category API service tenant-scoped query contract', () => {
  it('uses structural tenant scoping for custom category roots', () => {
    const source = fs.readFileSync(
      path.join(repoRoot, 'server/src/lib/api/services/CategoryService.ts'),
      'utf8'
    );

    expect(source).toContain('createTenantScopedQuery(trx, {');
    expect(source).toContain('createTenantScopedQuery(knex, {');
    expect(source).toContain('this.buildTenantScopedQuery(trx, context)');
    expect(source).toContain("table: 'service_categories'");
    expect(source).toContain("table: 'service_items'");
    expect(source).toContain("table: 'service_request_definitions'");
    expect(source).toContain("table: 'tickets'");
    expect(source).toContain('table: tableName');
    expect(source).toContain('table: `${tableName} as c`');
    expect(source).not.toMatch(/(?:knex|trx)\('service_categories'\)[\s\S]*?\.where\('tenant', context\.tenant\)/);
    expect(source).not.toMatch(/trx\('service_items'\)[\s\S]*?\.where\('tenant', context\.tenant\)/);
    expect(source).not.toMatch(/trx\('service_request_definitions'\)[\s\S]*?tenant: context\.tenant/);
    expect(source).not.toMatch(/trx\('categories'\)[\s\S]*?\.where\('tenant', context\.tenant\)/);
    expect(source).not.toMatch(/trx\('tickets'\)[\s\S]*?\.where\('tenant', context\.tenant\)/);
    expect(source).not.toMatch(/trx\(tableName\)[\s\S]*?\.where\('tenant', context\.tenant\)/);
    expect(source).not.toMatch(/trx\(`\$\{tableName\} as c`\)[\s\S]*?\.where\('c\.tenant', context\.tenant\)/);
  });
});
