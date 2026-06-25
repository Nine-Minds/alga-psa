import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const sourcePath = resolve(__dirname, 'userQueryActions.ts');
const source = readFileSync(sourcePath, 'utf8');

describe('user query actions tenant-scoped query contract', () => {
  it('uses structural tenant scoping for direct user, role, and contact roots', () => {
    expect(source).toContain('createTenantScopedQuery(trx, {');
    expect(source).toContain("table: 'users'");
    expect(source).toContain("table: 'roles'");
    expect(source).toContain("table: 'contacts'");
    expect(source).toContain(".andOn('contacts.tenant', '=', 'users.tenant')");

    expect(source).not.toContain('tenant: tenant || undefined');
    expect(source).not.toMatch(/trx\('users'\)\s*[\r\n]+\s*\.(?:whereIn|where|join)/);
    expect(source).not.toMatch(/trx\('roles'\)\s*[\r\n]+\s*\.where/);
    expect(source).not.toMatch(/trx\('contacts'\)\s*[\r\n]+\s*\.where/);
    expect(source).not.toContain("'users.tenant': tenant");
  });
});
