// @vitest-environment node

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../../../..');

describe('tag API service tenant-scoped query contract', () => {
  it('uses structural tenant scoping for custom tag mapping roots', () => {
    const source = fs.readFileSync(
      path.join(repoRoot, 'server/src/lib/api/services/TagService.ts'),
      'utf8'
    );

    expect(source).toContain('tenantDb(');
    expect(source).toContain('tenantDb(');
    expect(source).toContain(".table('tag_mappings as tm')");
    expect(source).toContain(".table('tag_mappings')");
    expect(source).not.toMatch(/(?:knex|trx)\('tag_mappings as tm'\)[\s\S]*?\.where\('tm\.tenant', (?:tenant|context\.tenant)\)/);
    expect(source).not.toMatch(/(?:knex|trx)\('tag_mappings'\)[\s\S]*?\.where\('tenant', tenant\)/);
    expect(source).not.toMatch(/(?:knex|trx)\('tag_mappings'\)[\s\S]*?tenant: context\.tenant/);
  });
});
