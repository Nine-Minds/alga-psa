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

describe('KB article review tenant-scoped query contract', () => {
  it('uses structural tenant scoping for review workflow roots', () => {
    const reviewSection = sourceBetween(
      'export const submitForReview',
      '/**\n * Gets available categories',
    );

    expect(reviewSection).toContain("tenantScopedTable(knex, 'kb_articles', tenant)");
    expect(reviewSection).toContain("tenantScopedTable(knex, 'users', tenant)");
    expect(reviewSection).toContain("tenantScopedTable(knex, 'kb_article_reviewers', tenant)");
    expect(reviewSection).not.toContain('.where({ tenant, article_id: articleId');
    expect(reviewSection).not.toContain(".where('tenant', tenant)");
    expect(reviewSection).not.toContain('tenant,\n        article_id: articleId');
  });
});
