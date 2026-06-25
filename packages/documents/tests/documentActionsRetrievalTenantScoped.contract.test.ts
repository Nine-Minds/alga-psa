import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(__dirname, '../src/actions/documentActions.ts'), 'utf8');
const retrievalSection = source.slice(
  source.indexOf('// Get single document'),
  source.indexOf('// Get document preview')
);

describe('document action retrieval tenant-scoped query contract', () => {
  it('uses structural tenant scoping for document and association retrieval roots', () => {
    expect(retrievalSection).toContain("tenantScopedTable(trx, 'documents', tenant)");
    expect(retrievalSection).toContain("tenantScopedTable(trx, 'document_associations', tenant)");
    expect(retrievalSection).toContain(".andOn('documents.tenant', '=', 'document_associations.tenant')");
    expect(retrievalSection).not.toContain("trx('documents')");
    expect(retrievalSection).not.toContain("trx('document_associations')");
    expect(retrievalSection).not.toContain("'documents.tenant': tenant");
    expect(retrievalSection).not.toContain("'document_associations.tenant': tenant");
    expect(retrievalSection).not.toContain('association_id: associationId,\n          tenant,');
  });
});
