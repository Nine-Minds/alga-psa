import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const source = readFileSync(resolve(__dirname, 'sessionActions.ts'), 'utf8');

describe('session actions tenant-scoped query contract', () => {
  it('uses the tenant facade for the sessions root and user join', () => {
    expect(source).toContain('const db = tenantDb(knex, tenant);');
    expect(source).toContain("const sessionsQuery = db.table('sessions')");
    expect(source).toContain("db.tenantJoin(sessionsQuery, 'users', 'sessions.user_id', 'users.user_id', { type: 'left' });");
    expect(source).not.toContain('createTenantScopedQuery');
    expect(source).not.toContain(".andOn('sessions.tenant', '=', 'users.tenant')");
    expect(source).not.toContain(".where('sessions.tenant', tenant)");
  });
});
