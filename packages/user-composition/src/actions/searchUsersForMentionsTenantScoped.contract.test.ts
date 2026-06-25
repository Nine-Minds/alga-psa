import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const sourcePath = resolve(__dirname, 'searchUsersForMentions.ts');
const source = readFileSync(sourcePath, 'utf8');

describe('search users for mentions tenant-scoped query contract', () => {
  it('uses structural tenant scoping for mention user search roots', () => {
    expect(source).toContain('tenantDb(knex, tenant)');
    expect(source).toContain(".table('users')");
    expect(source).toContain(".andWhere('user_type', 'internal')");
    expect(source).not.toContain('createTenantScopedQuery');

    expect(source).not.toMatch(/knex\('users'\)\s*[\r\n]+\s*\.select/);
    expect(source).not.toContain(".where('tenant', tenant)");
  });
});
