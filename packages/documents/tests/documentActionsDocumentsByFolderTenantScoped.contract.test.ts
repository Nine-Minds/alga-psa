import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(__dirname, '../src/actions/documentActions.ts'), 'utf8');
const documentsByFolderSection = source.slice(
  source.indexOf('export const getDocumentsByFolder = withAuth(async ('),
  source.indexOf('/**\n * Move documents to a different folder')
);

describe('document by-folder tenant-scoped query contract', () => {
  it('uses structural tenant scoping for folder document roots and association filters', () => {
    expect(documentsByFolderSection).toContain("tenantScopedTable(trx, 'documents as d', tenant)");
    expect(documentsByFolderSection).toContain("tenantScopedTable(trx, 'document_associations as da', tenant)");
    expect(documentsByFolderSection).toContain("tenantScopedTable(trx, 'document_associations as filter_da', tenant)");
    expect(documentsByFolderSection).not.toContain("trx('documents as d')");
    expect(documentsByFolderSection).not.toContain(".from('document_associations as da')");
    expect(documentsByFolderSection).not.toContain(".from('document_associations as filter_da')");
    expect(documentsByFolderSection).not.toContain(".where('d.tenant', tenant)");
    expect(documentsByFolderSection).not.toContain(".andWhere('da.tenant', tenant)");
    expect(documentsByFolderSection).not.toContain(".andWhere('filter_da.tenant', tenant)");
  });
});
