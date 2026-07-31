import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(__dirname, '../src/actions/kbArticleActions.ts'), 'utf8');

function sourceBetween(start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex);

  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);

  return source.slice(startIndex, endIndex);
}

describe('KB article list/search tenant-scoped query contract', () => {
  it('uses structural tenant scoping for category, article list, orphan reconciliation, and article reads', () => {
    const listSection = sourceBetween(
      'export const getKnowledgeBaseCategories',
      '/**\n * Increments the view count',
    );

    expect(listSection).toContain("tenantScopedTable(knex, 'categories as c', tenant)");
    expect(listSection).toContain("tenantScopedTable(knex, 'kb_articles as ka', tenant)");
    expect(listSection).toContain("tenantScopedTable(knex, 'documents as d', tenant)");
    expect(listSection).toContain("tenantScopedTable(knex, 'kb_articles', tenant)");
    expect(listSection).toContain("tenantScopedTable(knex, 'tag_mappings as tm', tenant)");
    expect(listSection).not.toContain(".where('c.tenant', tenant)");
    expect(listSection).not.toContain(".where('ka.tenant', tenant)");
    expect(listSection).not.toContain(".where('d.tenant', tenant)");
    expect(listSection).not.toContain(".where('tm.tenant', tenant)");
    expect(listSection).not.toContain(".where('tenant', tenant)");
  });
});
