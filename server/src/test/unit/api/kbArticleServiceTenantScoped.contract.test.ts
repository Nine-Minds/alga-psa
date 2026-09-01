// @vitest-environment node

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../../../..');

const serviceSource = (): string =>
  fs.readFileSync(path.join(repoRoot, 'server/src/lib/api/services/KbArticleService.ts'), 'utf8');

describe('KB article API markdown conversion contract', () => {
  it('converts REST-submitted markdown with the bounded import parser', () => {
    const source = serviceSource();

    // The legacy converter has no deadline: a pathological body submitted to the
    // API would block the request event loop for minutes, which is exactly what
    // moving the import parse into a job exists to prevent.
    expect(source).not.toContain('convertMarkdownToBlocks');
    expect(source).not.toContain('@shared/lib/utils/markdownToBlocks');
    expect(source).toContain("from '@alga-psa/jobs/handler-utils/kbImportBlocks'");
    expect(source).toContain('markdownToBlocks(content, { maxDurationMs:');
    expect(source).toContain('KbImportParseTimeoutError');
    expect(source).not.toMatch(/blocks = markdownToBlocks\(data\.content\)/);
  });
});

describe('KB article API service tenant-scoped query contract', () => {
  it('uses structural tenant scoping for KB article service roots', () => {
    const source = serviceSource();

    expect(source).toContain('this.buildTenantScopedQuery(knex, context)');
    expect(source).toContain('tenantDb(');
    for (const table of [
      'kb_articles as ka',
      'documents',
      'document_block_content',
      'kb_article_templates',
      'tickets',
    ]) {
      expect(source).toContain(`.table('${table}')`);
    }

    expect(source).not.toMatch(/knex\('kb_articles(?: as ka)?'\)\s*\.(?:where|select|leftJoin)/);
    expect(source).not.toMatch(/knex\('documents'\)\s*\.where/);
    expect(source).not.toMatch(/knex\('document_block_content'\)\s*\.where/);
    expect(source).not.toMatch(/knex\('kb_article_templates'\)\s*\.where/);
    expect(source).not.toMatch(/knex\('tickets'\)\s*\.where/);
    expect(source).not.toMatch(/\.where\('ka\.tenant', context\.tenant\)/);
  });
});
