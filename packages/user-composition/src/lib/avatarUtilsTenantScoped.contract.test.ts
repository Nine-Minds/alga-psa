import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const sourcePath = resolve(__dirname, 'avatarUtils.ts');
const source = readFileSync(sourcePath, 'utf8');

describe('avatar utils tenant-scoped query contract', () => {
  it('uses structural tenant scoping for image association, document, and file roots', () => {
    expect(source).toContain('createTenantScopedQuery(trx, {');
    expect(source).toContain("table: 'external_files'");
    expect(source).toContain("table: 'document_associations'");
    expect(source).toContain("table: 'documents'");

    expect(source).not.toMatch(/trx\('external_files'\)\s*[\r\n]+\s*\.select[\s\S]*?\.where\(\{[^}]*tenant/);
    expect(source).not.toMatch(/trx\('document_associations'\)\s*[\r\n]+\s*\.select[\s\S]*?tenant/);
    expect(source).not.toMatch(/trx\('documents'\)\s*[\r\n]+\s*\.select[\s\S]*?tenant/);
    expect(source).not.toContain('.andWhere({ tenant })');
  });
});
