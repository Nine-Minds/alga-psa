import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(__dirname, '../src/actions/kbArticleActions.ts'), 'utf8');
const modelSource = readFileSync(
  resolve(__dirname, '../../../shared/models/kbArticleModel.ts'),
  'utf8',
);

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
      'export const createArticle = withAuth(',
      '/**\n * Submits an article for review.',
    );

    expect(source).toContain("import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db'");
    expect(source).toContain('function tenantScopedTable(');
    expect(source).not.toContain('createTenantScopedQuery');
    expect(lifecycleSection).toContain("tenantScopedTable(trx, 'kb_articles', tenant)");
    expect(lifecycleSection).toContain("tenantScopedTable(trx, 'documents', tenant)");
    expect(lifecycleSection).toContain("tenantScopedTable(trx, 'tag_mappings', tenant)");
    expect(lifecycleSection).toContain("tenantScopedTable(trx, 'document_block_content', tenant)");
    expect(lifecycleSection).not.toContain('.where({ tenant, slug');
    expect(lifecycleSection).not.toContain('.where({ tenant, article_id: articleId');
    expect(lifecycleSection).not.toContain('.where({ tenant, document_id');
    expect(lifecycleSection).not.toContain(".where({ tenant, tagged_id: articleId, tagged_type: 'knowledge_base_article' })");
  });

  it('delegates article creation to the session-free shared model', () => {
    expect(source).toContain("from '@alga-psa/shared/models/kbArticleModel'");
    expect(source).toContain('createKbArticle(knex, { tenant, userId: user.user_id }');
    expect(source).not.toContain('_createArticleInternal');
  });

  it('keeps the shared creation model tenant-scoped and session-free', () => {
    expect(modelSource).toContain("import { tenantDb } from '@alga-psa/db'");
    expect(modelSource).toContain('function tenantScopedTable(');
    expect(modelSource).toContain("tenantScopedTable(knex, 'kb_articles', tenant)");
    expect(modelSource).toContain("tenantScopedTable(knex, 'documents', tenant)");
    expect(modelSource).toContain("tenantScopedTable(knex, 'document_block_content', tenant)");
    expect(modelSource).toContain("eventType: 'KB_ARTICLE_CREATED'");
    expect(modelSource).toContain('export async function publishKbArticleCreated(');
    // The event belongs after the caller's commit: a job that stages the
    // article inside a transaction must not announce a rolled-back write.
    const creationSource = modelSource.slice(
      modelSource.indexOf('export async function createKbArticle('),
    );
    expect(creationSource).not.toContain('publishKbArticleCreated(');
    expect(source).toContain('await publishKbArticleCreated(tenant, article, user.user_id)');
    expect(modelSource).not.toContain('withAuth');
    expect(modelSource).not.toContain('createTenantKnex');
    expect(modelSource).not.toContain('.where({ tenant,');
  });
});
