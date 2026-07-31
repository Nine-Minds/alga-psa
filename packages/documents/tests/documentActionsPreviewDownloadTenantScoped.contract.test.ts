import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(__dirname, '../src/actions/documentActions.ts'), 'utf8');
const previewDownloadSection = source.slice(
  source.indexOf('export const getDocumentPreview = withAuth(async ('),
  source.indexOf('// Get documents by entity using the new association table')
);

describe('document action preview/download tenant-scoped query contract', () => {
  it('uses structural tenant scoping for direct preview and download document roots', () => {
    expect(previewDownloadSection).toContain("tenantScopedTable(trx, 'documents', tenant)");
    expect(previewDownloadSection).toContain(".where({ 'documents.document_id': identifier })");
    expect(previewDownloadSection).toContain('this.where({ file_id: documentIdOrFileId })');
    expect(previewDownloadSection).not.toContain("trx('documents')");
    expect(previewDownloadSection).not.toContain("'documents.tenant': tenant");
    expect(previewDownloadSection).not.toContain('.where({ tenant })');
  });
});
