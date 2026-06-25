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

describe('KB article lifecycle tenant-scoped query contract', () => {
  it('uses structural tenant scoping for lifecycle read/update/delete roots', () => {
    const lifecycleSection = sourceBetween(
      'async function _createArticleInternal',
      '/**\n * Submits an article for review.',
    );

    expect(source).toContain("import { createTenantKnex, createTenantScopedQuery, withTransaction } from '@alga-psa/db'");
    expect(source).toContain('function tenantScopedTable(');
    expect(lifecycleSection).toContain("tenantScopedTable(knex, 'kb_articles', tenant)");
    expect(lifecycleSection).toContain("tenantScopedTable(knex, 'documents', tenant)");
    expect(lifecycleSection).toContain("tenantScopedTable(trx, 'kb_articles', tenant)");
    expect(lifecycleSection).toContain("tenantScopedTable(trx, 'documents', tenant)");
    expect(lifecycleSection).toContain("tenantScopedTable(trx, 'tag_mappings', tenant)");
    expect(lifecycleSection).toContain("tenantScopedTable(trx, 'document_block_content', tenant)");
    expect(lifecycleSection).not.toContain('.where({ tenant, slug');
    expect(lifecycleSection).not.toContain('.where({ tenant, article_id: articleId');
    expect(lifecycleSection).not.toContain('.where({ tenant, document_id');
    expect(lifecycleSection).not.toContain(".where({ tenant, tagged_id: articleId, tagged_type: 'knowledge_base_article' })");
  });
});
