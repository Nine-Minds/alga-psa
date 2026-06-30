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

  it('builds the eligibility scan through the tenant query facade', () => {
    expect(source).toContain('const db = tenantDb(conn, tenant);');
    expect(source).toContain("db.table('tickets as t')");
    expect(source).toContain("db.table('comments as c')");
    expect(source).toContain("db.table('ticket_audit_logs as a')");
    expect(source).toContain("db.tenantJoin(pendingQuery, 'board_auto_close_rules as r'");
    expect(source).toContain("db.tenantJoinSubquery(pendingQuery, commentActivity, 't.ticket_id', 'comment_activity.ticket_id'");
    expect(source).toContain("db.tenantJoinSubquery(pendingQuery, auditActivity, 't.ticket_id', 'audit_activity.ticket_id'");
    expect(source).toContain("rootTenantColumn: 't.tenant'");
    expect(source).toContain("joinedTenantColumn: 'comment_activity.tenant'");
    expect(source).toContain("joinedTenantColumn: 'audit_activity.tenant'");
    expect(source).not.toContain('const result = await knex.raw');
    expect(source).not.toContain('JOIN board_auto_close_rules r');
    expect(source).not.toContain('WHERE t.tenant = :tenant');
  });
});
