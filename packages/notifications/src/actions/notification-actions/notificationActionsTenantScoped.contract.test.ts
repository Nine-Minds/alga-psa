import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const source = readFileSync(resolve(__dirname, 'notificationActions.ts'), 'utf8');

describe('notification actions tenant-scoped query contract', () => {
  it('uses structural tenant scoping for tenant-owned notification action roots', () => {
    expect(source).toContain('function tenantScopedTable');
    expect(source).toContain('tenantDb(conn, tenant).table(table)');
    expect(source).toContain('tenantScopedTable(trx, "tenant_email_templates", tenant)');
    expect(source).toContain("tenantScopedTable(trx, 'tenant_notification_category_settings', tenant)");
    expect(source).toContain("tenantScopedTable(trx, 'tenant_notification_subtype_settings', tenant)");
    expect(source).toContain("tenantScopedTable(trx, 'users', tenant)");
    expect(source).toContain('tenantScopedTable(trx, "system_email_templates as t", tenant)');
    expect(source).toContain('tenantScopedTable(trx, "system_email_templates", tenant)');
    expect(source).toContain('db.tenantJoin(systemTemplatesQuery, "notification_subtypes as s"');
    expect(source).toContain('db.tenantJoin(systemTemplatesQuery, "notification_categories as c"');
    expect(source).toContain("const query = db.table('notification_categories as nc')");
    expect(source).toContain("db.tenantJoin(query, 'tenant_notification_category_settings as tcs'");
    expect(source).toContain("db.tenantJoin(categoryQuery, 'tenant_notification_category_settings as tcs'");
    expect(source).toContain("db.tenantJoin(subtypesQuery, 'tenant_notification_subtype_settings as tss'");
    expect(source).toContain("db.tenantJoin(updatedQuery, 'tenant_notification_category_settings as tcs'");
    expect(source).toContain("db.tenantJoin(updatedQuery, 'tenant_notification_subtype_settings as tss'");
    expect(source).toContain("tenantPredicate: 'literal'");

    expect(source).not.toContain('createTenantScopedQuery');
    expect(source).not.toMatch(/\btrx\(['"](system_email_templates|notification_categories)(\s+as\s+[^'"]*)?['"]\)/);
    expect(source).not.toMatch(/\.join\(["'](notification_subtypes|notification_categories)(\s+as\s+[^"']*)?["']/);
    expect(source).not.toMatch(/\.andOn\(['"]t(?:cs|ss)\.tenant['"],\s*trx\.raw\(['"]\?['"],\s*\[tenant\]\)\)/);
    expect(source).not.toMatch(/\btrx\(["'](tenant_email_templates|tenant_notification_category_settings|tenant_notification_subtype_settings|users)["']\)\s*[\r\n]+\s*\.where\(\{[^}]*tenant/);
    expect(source).not.toMatch(/\btrx\(["'](tenant_email_templates|tenant_notification_category_settings|tenant_notification_subtype_settings|users)["']\)\.where\(\{[^}]*tenant/);
  });
});
