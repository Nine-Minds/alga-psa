import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(
  path.resolve(__dirname, '../src/entityImageService.ts'),
  'utf8',
);

describe('entity image service tenant facade migration contract', () => {
  it('uses tenantDb for tenant-owned document image roots', () => {
    expect(source).toContain("import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';");
    expect(source).toContain("tenantScopedTable(trx, 'document_folders', tenant)");
    expect(source).toContain("tenantScopedTable(knexOrTrx, 'document_types', tenant)");
    expect(source).toContain("tenantScopedTable(knex, 'documents', tenant)");
    expect(source).toContain("tenantScopedTable(trx, 'document_associations', tenant)");
    expect(source).toContain("tenantScopedTable(knex, 'document_associations', tenant)");
    expect(source).toContain("db.table('shared_document_types')");
    expect(source).not.toContain("knexOrTrx('shared_document_types')");
    expect(source).not.toContain("trx('document_folders')");
    expect(source).not.toContain("knex('documents')");
    expect(source).not.toContain("trx('document_associations')");
  });

  it('can re-crop from an explicit source document instead of a variant association', () => {
    expect(source).toContain('sourceDocumentId?: string;');
    expect(source).toContain('let sourceId = sourceDocumentId;');
    expect(source).toContain('if (!sourceId) {');
    expect(source).toContain('.where({ document_id: sourceId })');
  });

  it('fills a variant from an existing tenant document without touching it', () => {
    expect(source).toContain('export async function linkEntityImageFromDocument(');
    // Tenant-scoped lookup, image-only, and no delete of the source document.
    expect(source).toContain("tenantScopedTable(knex, 'documents', tenant)");
    expect(source).toContain("mimeType?.startsWith('image/')");
    expect(source).toContain("processing: logoVariant === 'favicon' ? { isFavicon: true } : { isEntityLogo: true }");
  });

  it('reports the stored document so callers can record provenance', () => {
    expect(source).toContain('documentId?: string;');
    expect(source).toContain('fileName?: string;');
    expect(source).toContain('return { success: true, imageUrl, sourceImageUrl, documentId, fileName: storedBytes.name };');
  });
});
