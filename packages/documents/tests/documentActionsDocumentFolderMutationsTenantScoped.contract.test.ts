import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(__dirname, '../src/actions/documentActions.ts'), 'utf8');
const documentFolderMutationSection = source.slice(
  source.indexOf('export const moveDocumentsToFolder = withAuth(async ('),
  source.indexOf('/**\n * Toggle client visibility for a folder')
);

describe('document folder mutation tenant-scoped query contract', () => {
  it('uses structural tenant scoping for document folder move and visibility updates', () => {
    expect(documentFolderMutationSection).toContain("tenantScopedTable(trx, 'documents', tenant)");
    expect(documentFolderMutationSection).not.toContain("trx('documents')");
    expect(documentFolderMutationSection).not.toContain(".andWhere('tenant', tenant)");
    expect(documentFolderMutationSection).not.toContain(".where('tenant', tenant)");
  });
});
