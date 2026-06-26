import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const sourcePath = resolve(__dirname, 'userClientActions.ts');
const source = readFileSync(sourcePath, 'utf8');

describe('user client actions tenant-scoped query contract', () => {
  it('uses structural tenant scoping for the users client-info root', () => {
    expect(source).toContain('const scopedDb = tenantDb(trx, tenant);');
    expect(source).toContain("const usersQuery = scopedDb.table('users as u');");
    expect(source).toContain("scopedDb.tenantJoin(usersQuery, 'contacts as c', 'u.contact_id', 'c.contact_name_id', { type: 'left' })");
    expect(source).toContain("scopedDb.tenantJoin(usersQuery, 'clients as co', 'c.client_id', 'co.client_id', { type: 'left' })");

    expect(source).not.toMatch(/trx\('users as u'\)\s*\./);
    expect(source).not.toMatch(/\.where\('u\.tenant', tenant\)/);
    expect(source).not.toContain(".andOn('u.tenant', '=', 'c.tenant')");
    expect(source).not.toContain(".andOn('c.tenant', '=', 'co.tenant')");
  });
});
