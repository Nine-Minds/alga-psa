import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(__dirname, '../src/actions/documentActions.ts'), 'utf8');
const folderVisibilitySection = source.slice(
  source.indexOf('export const toggleFolderVisibility = withAuth(async ('),
  source.indexOf('/**\n * Ensure entity-scoped folders are initialized.')
);

describe('document folder visibility tenant-scoped query contract', () => {
  it('uses structural tenant scoping for folder visibility updates and cascades', () => {
    expect(folderVisibilitySection).toContain("tenantScopedTable(knex, 'document_folders', tenant)");
    expect(folderVisibilitySection).toContain("tenantScopedTable(knex, 'documents as d', tenant)");
    expect(folderVisibilitySection).toContain("tenantScopedTable(knex, 'document_associations as da', tenant)");
    expect(folderVisibilitySection).not.toContain("knex('document_folders')");
    expect(folderVisibilitySection).not.toContain("knex('documents as d')");
    expect(folderVisibilitySection).not.toContain(".from('document_associations as da')");
    expect(folderVisibilitySection).not.toContain(".where('tenant', tenant)");
    expect(folderVisibilitySection).not.toContain(".where('d.tenant', tenant)");
    expect(folderVisibilitySection).not.toContain(".andWhere('da.tenant', tenant)");
  });
});
