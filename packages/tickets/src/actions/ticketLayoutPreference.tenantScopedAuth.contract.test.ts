// @vitest-environment node

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('ticket layout preference actions tenant-scoped authorization contract', () => {
  const source = fs.readFileSync(path.resolve(__dirname, './ticketLayoutPreference.ts'), 'utf8');

  it('uses tenant-scoped wrappers and UserPreferences storage', () => {
    expect(source).toContain('tenantDb');
    expect(source).toContain('function tenantScopedTable(');
    expect(source).toContain('tenantDb(conn, tenant).table(table)');
    expect(source).toContain("tenantScopedTable(trx, 'users', tenant)");
    expect(source).toContain('UserPreferences.get');
    expect(source).toContain('UserPreferences.upsert');
  });

  it('keeps the authenticated internal-user guard without ticket permissions', () => {
    expect(source).toContain('withAuth(');
    expect(source).toContain("user.user_type === 'client'");
    expect(source).toContain("throw new Error('Tenant required')");
    expect(source).toContain("throw new Error('user.user_id required')");
    expect(source).not.toContain("hasPermission(user, 'ticket', 'read'");
  });

  it('does not use bare knex or transaction table roots', () => {
    expect(source).not.toMatch(/\bknex\s*(?:<[^>]+>)?\(\s*['"`]/);
    expect(source).not.toMatch(/\btrx\s*(?:<[^>]+>)?\(\s*['"`]/);
  });
});
