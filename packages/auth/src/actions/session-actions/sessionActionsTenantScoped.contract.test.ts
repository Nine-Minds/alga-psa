import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const source = readFileSync(resolve(__dirname, 'sessionActions.ts'), 'utf8');

describe('session actions tenant-scoped query contract', () => {
  it('uses structural tenant scoping for the sessions root while preserving user join equality', () => {
    expect(source).toContain("tenantDb(knex, tenant).table('sessions')");
    expect(source).not.toContain('createTenantScopedQuery');
    expect(source).toContain(".andOn('sessions.tenant', '=', 'users.tenant')");
    expect(source).not.toContain(".where('sessions.tenant', tenant)");
  });
});
