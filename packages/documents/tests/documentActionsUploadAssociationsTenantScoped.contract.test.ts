import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(__dirname, '../src/actions/documentActions.ts'), 'utf8');
const uploadAssociationSection = source.slice(
  source.indexOf('// Remove document associations'),
  source.indexOf('export const getDocumentTypeId = withAuth(async')
);

describe('document upload and association mutation tenant-scoped query contract', () => {
  it('uses structural tenant scoping for association removal and upload helper roots', () => {
    expect(uploadAssociationSection).toContain("tenantScopedTable(trx, 'document_associations', tenant)");
    expect(uploadAssociationSection).toContain("tenantScopedTable(knex, 'document_folders', tenant)");
    expect(uploadAssociationSection).toContain("tenantScopedTable(knex, 'documents', tenant)");
    expect(uploadAssociationSection).not.toContain("trx('document_associations')");
    expect(uploadAssociationSection).not.toContain("knex('document_folders')");
    expect(uploadAssociationSection).not.toContain("knex('documents')");
    expect(uploadAssociationSection).not.toContain(".andWhere('tenant', tenant)");
    expect(uploadAssociationSection).not.toContain(".where('tenant', tenant)");
    expect(uploadAssociationSection).not.toContain(".where({ document_id: document.document_id, tenant })");
  });
});
