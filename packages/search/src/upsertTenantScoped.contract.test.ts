import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const source = fs.readFileSync(path.join(__dirname, 'upsert.ts'), 'utf8');

describe('search upsert tenant-scoped query contract', () => {
  it('uses structural tenant scoping for search-index deletes', () => {
    expect(source).toContain("table: 'app_search_index'");
    expect(source).toContain("knex.raw(");
    expect(source).not.toMatch(/knex\('app_search_index'\)\s*[\r\n]+\s*\.where\(\{[^}]*tenant/);
    expect(source).not.toMatch(/knex\('app_search_index'\)\.where\(\{[^}]*tenant/);
  });
});
