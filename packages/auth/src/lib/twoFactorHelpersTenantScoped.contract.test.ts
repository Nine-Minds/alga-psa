import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const source = readFileSync(resolve(__dirname, 'twoFactorHelpers.ts'), 'utf8');

describe('twoFactorHelpers tenant-scoped query contract', () => {
  it('uses structural tenant scoping for user roots', () => {
    expect(source).toContain("tenantDb(knex, tenant).table('users')");
    expect(source).not.toContain('createTenantScopedQuery');
    expect(source).not.toContain('.where({ tenant, user_id: userId })');
  });
});
