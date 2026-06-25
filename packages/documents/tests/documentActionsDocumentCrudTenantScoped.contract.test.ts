import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(__dirname, '../src/actions/documentActions.ts'), 'utf8');
const section = source.slice(
  source.indexOf('export async function getAuthorizedDocumentByFileId'),
  source.indexOf('// Delete document')
);

describe('document action document CRUD tenant-scoped query contract', () => {
  it('uses structural tenant scoping for authorized lookups and update roots', () => {
    expect(section).toContain("tenantScopedTable(trx, 'documents', tenant)");
    expect(section).not.toContain("trx('documents')\n    .where({ tenant");
    expect(section).not.toContain(".where({ tenant, file_id: fileId })");
    expect(section).not.toContain(".where({ tenant, document_id: documentId })");
    expect(section).not.toContain(".where({ document_id: documentId, tenant })");
  });
});
