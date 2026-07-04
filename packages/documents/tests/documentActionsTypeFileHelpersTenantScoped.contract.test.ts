import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(__dirname, '../src/actions/documentActions.ts'), 'utf8');
const helperSection = source.slice(
  source.indexOf('export const getDocumentTypeId = withAuth(async'),
  source.indexOf('// ============================================================================')
);

describe('document type/file helper tenant-scoped query contract', () => {
  it('uses structural tenant scoping for document type, external file, and entity-type roots', () => {
    expect(helperSection).toContain("tenantScopedTable(trx, 'document_types', tenant)");
    expect(helperSection).toContain("tenantScopedTable(trx, 'external_files', tenant)");
    expect(helperSection).toContain("tenantScopedTable(knex, 'external_files', tenant)");
    expect(helperSection).toContain("tenantScopedTable(trx, 'document_associations', tenant)");
    expect(helperSection).not.toContain("trx('document_types')");
    expect(helperSection).not.toContain("trx('external_files')");
    expect(helperSection).not.toContain("knex('external_files')");
    expect(helperSection).not.toContain("trx('document_associations')");
    expect(helperSection).not.toContain('.where({ tenant, type_name:');
    expect(helperSection).not.toContain('.where({ file_id, tenant })');
    expect(helperSection).not.toContain(".where('tenant', tenant)");
  });
});
