import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const sourcePath = resolve(__dirname, 'contactQueryActions.ts');
const source = readFileSync(sourcePath, 'utf8');

describe('contact query actions tenant-scoped query contract', () => {
  it('uses structural tenant scoping for contact picker roots', () => {
    expect(source).toContain('createTenantScopedQuery(trx, {');
    expect(source).toContain("table: 'contacts'");
    expect(source).toContain(".andOn('clients.tenant', 'contacts.tenant')");

    expect(source).not.toMatch(/trx\('contacts'\)\s*[\r\n]+\s*\.select/);
    expect(source).not.toContain(".where('contacts.tenant', tenant)");
  });
});
