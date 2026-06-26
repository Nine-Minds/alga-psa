import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const sourcePath = resolve(__dirname, 'contactQueryActions.ts');
const source = readFileSync(sourcePath, 'utf8');

describe('contact query actions tenant-scoped query contract', () => {
  it('uses structural tenant scoping for contact picker roots', () => {
    expect(source).toContain('tenantDb(trx, tenant)');
    expect(source).toContain(".table('contacts')");
    expect(source).toContain("scopedDb.tenantJoin(contactsQuery, 'clients', 'contacts.client_id', 'clients.client_id', { type: 'left' })");
    expect(source).not.toContain('createTenantScopedQuery');

    expect(source).not.toMatch(/trx\('contacts'\)\s*[\r\n]+\s*\.select/);
    expect(source).not.toContain(".where('contacts.tenant', tenant)");
    expect(source).not.toContain(".andOn('clients.tenant', 'contacts.tenant')");
  });
});
