import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(__dirname, '../src/actions/documentActions.ts'), 'utf8');
const folderStatsCrudSection = source.slice(
  source.indexOf('export const getFolderStats = withAuth(async ('),
  source.indexOf('// Helper functions')
);

describe('document folder stats/create/delete tenant-scoped query contract', () => {
  it('uses structural tenant scoping for folder stats and folder CRUD roots', () => {
    expect(folderStatsCrudSection).toContain("tenantScopedTable(trx, 'documents', tenant)");
    expect(folderStatsCrudSection).toContain("tenantScopedTable(knex, 'document_folders', tenant)");
    expect(folderStatsCrudSection).toContain("tenantScopedTable(knex, 'documents', tenant)");
    expect(folderStatsCrudSection).not.toContain("trx('documents')");
    expect(folderStatsCrudSection).not.toContain("knex('document_folders')\n      .where('tenant', tenant)");
    expect(folderStatsCrudSection).not.toContain("knex('documents')");
    expect(folderStatsCrudSection).not.toContain(".where('tenant', tenant)");
  });
});
