import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const source = readFileSync(resolve(__dirname, 'twoFactorHelpers.ts'), 'utf8');

describe('twoFactorHelpers tenant-scoped query contract', () => {
  it('uses structural tenant scoping for user roots', () => {
    expect(source).toContain('createTenantScopedQuery');
    expect(source).toContain("createTenantScopedQuery(knex, { table: 'users', tenant }).builder");
    expect(source).not.toContain('.where({ tenant, user_id: userId })');
  });
});
