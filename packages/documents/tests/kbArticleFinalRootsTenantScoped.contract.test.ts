import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(__dirname, '../src/actions/kbArticleActions.ts'), 'utf8');

function sourceBetween(start: string, end?: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = end ? source.indexOf(end, startIndex) : source.length;

  expect(startIndex).toBeGreaterThanOrEqual(0);
  if (end) {
    expect(endIndex).toBeGreaterThan(startIndex);
  }

  return source.slice(startIndex, endIndex);
}

describe('KB article remaining roots tenant-scoped query contract', () => {
  it('uses structural tenant scoping for available tags, counters, templates, import, and ticket prefill', () => {
    const tagsSection = sourceBetween(
      '// --- available tags for filter sidebar ---',
      'return {',
    );
    const tailSection = sourceBetween('export const recordArticleView');

    expect(tagsSection).toContain("tenantScopedTable(knex, 'tag_definitions as td', tenant)");
    expect(tagsSection).not.toContain('WHERE td.tenant = ?');
    expect(tagsSection).not.toContain('await knex.raw(');
    expect(tailSection).toContain("tenantScopedTable(knex, 'kb_articles', tenant)");
    expect(tailSection).toContain("tenantScopedTable(knex, 'kb_article_templates', tenant)");
    expect(tailSection).toContain("tenantScopedTable(knex, 'tickets', tenant)");
    expect(tailSection).not.toContain('.where({ tenant, article_id: articleId');
    expect(tailSection).not.toContain(".where('tenant', tenant)");
    expect(tailSection).not.toContain('.where({ tenant, slug');
    expect(tailSection).not.toContain('.where({ tenant, ticket_id: ticketId');
  });
});
