import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(__dirname, '../src/actions/documentActions.ts'), 'utf8');
const folderTreeSection = source.slice(
  source.indexOf('async function _getFolderTreeInternal('),
  source.indexOf('/**\n * Get documents in a specific folder')
);

describe('document folder tree/list tenant-scoped query contract', () => {
  it('uses structural tenant scoping for explicit and implicit folder roots', () => {
    expect(folderTreeSection).toContain("tenantScopedTable(knex, 'document_folders', tenant)");
    expect(folderTreeSection).toContain("tenantScopedTable(knex, 'documents', tenant)");
    expect(folderTreeSection).toContain("tenantScopedTable(knex, 'document_associations as da', tenant)");
    expect(folderTreeSection).not.toContain("knex('document_folders')");
    expect(folderTreeSection).not.toContain("knex('documents')");
    expect(folderTreeSection).not.toContain(".from('document_associations as da')");
    expect(folderTreeSection).not.toContain(".where('tenant', tenant)");
    expect(folderTreeSection).not.toContain(".andWhere('da.tenant', tenant)");
  });
});
