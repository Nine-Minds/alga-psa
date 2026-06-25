// @vitest-environment node

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../../../..');

describe('KB article API service tenant-scoped query contract', () => {
  it('uses structural tenant scoping for KB article service roots', () => {
    const source = fs.readFileSync(
      path.join(repoRoot, 'server/src/lib/api/services/KbArticleService.ts'),
      'utf8'
    );

    expect(source).toContain('this.buildTenantScopedQuery(knex, context)');
    expect(source).toContain('createTenantScopedQuery(knex, {');
    for (const table of [
      'kb_articles as ka',
      'documents',
      'document_block_content',
      'kb_article_templates',
      'tickets',
    ]) {
      expect(source).toContain(`table: '${table}'`);
    }

    expect(source).not.toMatch(/knex\('kb_articles(?: as ka)?'\)\s*\.(?:where|select|leftJoin)/);
    expect(source).not.toMatch(/knex\('documents'\)\s*\.where/);
    expect(source).not.toMatch(/knex\('document_block_content'\)\s*\.where/);
    expect(source).not.toMatch(/knex\('kb_article_templates'\)\s*\.where/);
    expect(source).not.toMatch(/knex\('tickets'\)\s*\.where/);
    expect(source).not.toMatch(/\.where\('ka\.tenant', context\.tenant\)/);
  });
});
