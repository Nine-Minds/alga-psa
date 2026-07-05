// @vitest-environment node

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('ticket bento actions tenant-scoped authorization contract', () => {
  const source = fs.readFileSync(path.resolve(__dirname, './ticketBentoActions.ts'), 'utf8');

  it('uses tenant-scoped wrappers for all data roots', () => {
    expect(source).toContain('tenantDb');
    expect(source).toContain('function tenantScopedTable(');
    expect(source).toContain('tenantDb(conn, tenant).table(table)');
    expect(source).toContain("tenantScopedTable(trx, 'tickets', tenant)");
    expect(source).toContain("tenantScopedTable(trx, 'schedule_entries as se', tenant)");
    expect(source).toContain("tenantScopedTable(trx, 'interactions as i', tenant)");
    expect(source).toContain("tenantScopedTable(trx, 'time_entries', tenant)");
    expect(source).toContain("tenantScopedTable(trx, 'client_contracts as cc', tenant)");
  });

  it('keeps the internal-user and ticket read permission guards', () => {
    expect(source).toContain('withAuth(');
    expect(source).toContain("user.user_type === 'client'");
    expect(source).toContain("hasPermission(user, 'ticket', 'read', trx)");
    expect(source).toContain("throw new Error('Tenant required')");
    expect(source).toContain("throw new Error('ticketId required')");
    expect(source).toContain("throw new Error('Ticket not found')");
  });

  it('does not use bare knex or transaction table roots', () => {
    expect(source).not.toMatch(/\bknex\s*(?:<[^>]+>)?\(\s*['"`]/);
    expect(source).not.toMatch(/\btrx\s*(?:<[^>]+>)?\(\s*['"`]/);
  });
});
