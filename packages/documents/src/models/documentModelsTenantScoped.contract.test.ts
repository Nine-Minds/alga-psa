import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const associationSource = readFileSync(resolve(__dirname, 'documentAssociation.ts'), 'utf8');
const documentSource = readFileSync(resolve(__dirname, 'document.ts'), 'utf8');

describe('document model tenant-scoped query contract', () => {
  it('uses structural tenant scoping for document association roots', () => {
    expect(associationSource).toMatch(/tenantDb\(knexOrTrx, tenant\)\.table(?:<[^>]+>)?\('document_associations'\)/);
    expect(associationSource).toContain("tenantDb(knexOrTrx, tenant).table<IDocumentAssociation>('document_associations').insert(association)");
    expect(associationSource).not.toContain('createTenantScopedQuery');

    expect(associationSource).not.toContain("knexOrTrx('document_associations')");
    expect(associationSource).not.toMatch(/knexOrTrx\('document_associations'\)\.where\(\{[^}]*tenant/);
    expect(associationSource).not.toMatch(/knexOrTrx\('document_associations'\)\s*[\r\n]+\s*\.where\(\{[^}]*tenant/);
  });

  it('uses current tenant context for document and associated-user reads', () => {
    expect(documentSource).toMatch(/tenantDb\(knexOrTrx, tenant\)\.table(?:<[^>]+>)?\('documents'\)/);
    expect(documentSource).toMatch(/tenantDb\(knexOrTrx, tenant\)\.table(?:<[^>]+>)?\('document_associations'\)/);
    expect(documentSource).toMatch(/tenantDb\(knexOrTrx, tenant\)\.table(?:<[^>]+>)?\('users'\)/);
    expect(documentSource).not.toContain('createTenantScopedQuery');
    expect(documentSource).not.toContain('const tenant = associations[0].tenant');

    expect(documentSource).not.toMatch(/knexOrTrx(?:<[^>]+>)?\('(documents|document_associations|users)'\)\s*[\r\n]+\s*\.where[^(]*\([^)]*tenant/);
    expect(documentSource).not.toMatch(/\.andWhere\(\{\s*tenant\s*\}\)/);
    expect(documentSource).not.toMatch(/\.andWhere\('tenant', tenant\)/);
    expect(documentSource).not.toMatch(/\.andWhere\('documents\.tenant', tenant\)/);
  });
});
