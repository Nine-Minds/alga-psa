import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const sourcePath = resolve(__dirname, 'findUserByIdForApi.ts');
const source = readFileSync(sourcePath, 'utf8');

describe('find user by id for API tenant-scoped query contract', () => {
  it('uses structural tenant scoping for the API user lookup root', () => {
    expect(source).toContain('createTenantScopedQuery(knex, {');
    expect(source).toContain("table: 'users'");
    expect(source).toContain('tenant: tenantId');

    expect(source).not.toMatch(/knex\('users'\)\s*\./);
    expect(source).not.toMatch(/tenant: tenantId,\s*is_inactive/);
  });
});
