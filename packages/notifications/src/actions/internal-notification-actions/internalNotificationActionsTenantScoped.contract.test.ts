import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const source = readFileSync(resolve(__dirname, 'internalNotificationActions.ts'), 'utf8');

describe('internal notification actions tenant-scoped query contract', () => {
  it('uses structural tenant scoping for tenant-owned internal notification roots', () => {
    expect(source).toContain('function tenantScopedTable');
    expect(source).toContain('tenantDb(conn, tenant).table(table)');
    expect(source).toContain('const db = tenantDb(trx, tenant);');
    expect(source).toContain("const userQuery = db.table('users as u')");
    expect(source).toContain("db.tenantJoin(userQuery, 'contacts as con'");
    expect(source).toContain("db.tenantJoin(userQuery, 'clients as c'");
    expect(source).toContain("tenantScopedTable(trx, 'internal_notifications'");
    expect(source).toContain("tenantScopedTable(trx, 'user_internal_notification_preferences'");
    expect(source).toContain("tenantScopedTable(trx, 'tenant_internal_notification_category_settings'");
    expect(source).toContain("tenantScopedTable(trx, 'tenant_internal_notification_subtype_settings'");
    expect(source).toContain("tenantScopedTable(trx, 'tenant_settings'");
    expect(source).toContain("tenantScopedTable(trx, 'internal_notification_categories'");
    expect(source).toContain("tenantScopedTable(trx, 'internal_notification_subtypes'");
    expect(source).toContain("tenantScopedTable(trx, 'internal_notification_templates', tenant)");
    expect(source).toContain("tenantDb(trx, '__internal_notification_template_name_lookup__')");
    expect(source).toContain("db.table('internal_notification_categories as inc')");
    expect(source).toContain("db.table('internal_notification_subtypes as ins')");
    expect(source).toContain("db.tenantJoin(query, 'tenant_internal_notification_category_settings as tics'");
    expect(source).toContain("db.tenantJoin(query, 'tenant_internal_notification_subtype_settings as tiss'");
    expect(source).toContain("tenantPredicate: 'literal'");

    expect(source).not.toContain('createTenantScopedQuery');
    expect(source).not.toMatch(/\btrx\(['"](internal_notification_categories|internal_notification_subtypes|internal_notification_templates)(\s+as\s+[^'"]*)?['"]\)/);
    expect(source).not.toMatch(/\.andOn\(['"]ti(?:cs|ss)\.tenant['"],\s*trx\.raw\(['"]\?['"],\s*\[tenant\]\)\)/);
    expect(source).not.toMatch(/\btrx\(['"](internal_notifications|user_internal_notification_preferences|tenant_internal_notification_category_settings|tenant_internal_notification_subtype_settings|tenant_settings|user_preferences)['"]\)\s*[\r\n]+\s*\.where\(\{[^}]*tenant/);
    expect(source).not.toMatch(/\.andWhere\('u\.tenant', tenant\)/);
  });
});
