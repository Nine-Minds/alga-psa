// @vitest-environment node

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../../../..');

describe('contact API service tenant-scoped query contract', () => {
  it('uses structural tenant scoping for custom contact roots', () => {
    const source = fs.readFileSync(
      path.join(repoRoot, 'server/src/lib/api/services/ContactService.ts'),
      'utf8'
    );

    expect(source).toContain('createTenantScopedQuery(knex, {');
    expect(source).toContain('createTenantScopedQuery(trx, {');
    expect(source).toContain("table: 'contacts as c'");
    expect(source).toContain("alias: 'c'");
    expect(source).not.toMatch(/knex\('contacts as c'\)[\s\S]*?\.where\('c\.tenant', context\.tenant\)/);
    expect(source).not.toMatch(/trx\('contacts as c'\)[\s\S]*?'c\.tenant': context\.tenant/);
  });
});
