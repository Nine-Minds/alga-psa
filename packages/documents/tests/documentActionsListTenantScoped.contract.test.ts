import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(__dirname, '../src/actions/documentActions.ts'), 'utf8');
const listSection = source.slice(
  source.indexOf('export const getDocumentCountsForEntities = withAuth(async ('),
  source.indexOf('export const searchDocumentAssociationEntities = withAuth(async (')
);

describe('document action list/count tenant-scoped query contract', () => {
  it('uses structural tenant scoping for count, entity list, and all-document roots', () => {
    expect(listSection).toContain("tenantScopedTable(trx, 'document_associations as da', tenant)");
    expect(listSection).toContain("tenantScopedTable(trx, 'documents', tenant)");
    expect(listSection).toContain("tenantScopedTable(trx, 'document_associations', tenant)");
    expect(listSection).toContain("tenantScopedTable(trx, 'document_associations as filter_da', tenant)");
    expect(listSection).toContain(".andOn('documents.tenant', '=', 'document_associations.tenant')");
    expect(listSection).not.toContain("trx('document_associations as da')");
    expect(listSection).not.toContain("trx('documents')");
    expect(listSection).not.toContain(".where('da.tenant', tenant)");
    expect(listSection).not.toContain(".where('documents.tenant', tenant)");
    expect(listSection).not.toContain(".andWhere('document_associations.tenant', tenant)");
    expect(listSection).not.toContain(".andWhere('filter_da.tenant', tenant)");
  });
});
