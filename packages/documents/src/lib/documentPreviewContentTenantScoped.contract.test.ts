import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const files = [
  '../lib/collabPersistence.ts',
  '../lib/entityImageService.ts',
  '../lib/documentPreviewGenerator.ts',
  '../handlers/BlockNoteDocumentHandler.ts',
  '../handlers/TextDocumentHandler.ts',
  '../handlers/MarkdownDocumentHandler.ts',
  '../handlers/VideoDocumentHandler.ts',
];

const sources = files.map((relativePath) => ({
  relativePath,
  source: readFileSync(resolve(__dirname, relativePath), 'utf8'),
}));

describe('document preview and content tenant-scoped query contract', () => {
  it('uses structural tenant scoping for preview/content helper roots', () => {
    const combined = sources.map(({ source }) => source).join('\n');

    expect(combined).toContain("tenantDb(trx, tenant).table('document_block_content')");
    expect(combined).toContain("tenantDb(trx, tenant).table('document_content')");
    expect(combined).toContain("tenantDb(trx, tenant).table('document_associations')");
    expect(combined).toContain("tenantDb(trx, tenant).table('document_folders')");
    expect(combined).toContain("tenantDb(knex, tenant).table('documents')");
    expect(combined).toContain("tenantDb(knex, tenant).table('external_files')");
    expect(combined).not.toContain('createTenantScopedQuery');

    for (const { relativePath, source } of sources) {
      expect(source, relativePath).not.toMatch(/\b(?:knex|trx)\('(document_block_content|document_content|document_associations|document_folders|documents|external_files)'\)\s*[\r\n]+\s*\.where\(\{[^}]*tenant/);
      expect(source, relativePath).not.toMatch(/\b(?:knex|trx)\('(document_block_content|document_content|document_associations|document_folders|documents|external_files)'\)\.where\(\{[^}]*tenant/);
    }
  });
});
