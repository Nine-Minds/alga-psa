import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const source = readFileSync(resolve(__dirname, 'autoCloseTicketsHandler.ts'), 'utf8');

describe('auto-close tickets handler tenant-scoped query contract', () => {
  it('uses structural tenant scoping for state and status query-builder roots', () => {
    expect(source).toContain('tenantDb(conn, tenant).table(table)');
    expect(source).not.toContain('createTenantScopedQuery');
    expect(source).toContain("tenantScopedTable(knex, 'ticket_auto_close_state', tenant)");
    expect(source).toContain("tenantScopedTable(knex, 'ticket_auto_close_state as s', tenant)");
    expect(source).toContain("tenantScopedTable(trx, 'ticket_auto_close_state', tenant)");
    expect(source).toContain("tenantScopedTable(trx, 'statuses', tenant)");
    expect(source).not.toContain('.where({ tenant');
    expect(source).not.toContain(".where('s.tenant', tenant)");
  });
});
