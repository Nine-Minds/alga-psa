import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const source = readFileSync(resolve(__dirname, 'email.ts'), 'utf8');

describe('email notification service tenant-scoped query contract', () => {
  it('uses structural tenant scoping for tenant-owned notification roots', () => {
    expect(source).toContain('private tenantScopedTable');
    expect(source).toContain('tenantDb(knex, tenant).table(table)');
    expect(source).toContain("'tenant_email_settings', tenantId");
    expect(source).toContain("tenantDb(knex, tenant).table<NotificationSettings>('notification_settings')");
    expect(source).toContain("tenantDb(knex, tenant).table<TenantEmailTemplate>('tenant_email_templates')");
    expect(source).toContain("tenantDb(knex, tenant).table<any>('user_notification_preferences')");
    expect(source).toContain("'tenant_notification_subtype_settings', params.tenant");
    expect(source).toContain("'tenant_notification_category_settings', params.tenant");
    expect(source).toContain("tenantDb(knex, params.tenant).table('notification_logs')");
    expect(source).toContain("tenantDb(knex, '__email_system_template_lookup__')");
    expect(source).toContain("this.tenantScopedTable(knex, 'system_email_templates', tenant)");
    expect(source).toContain("const query = db.table('notification_categories as nc')");
    expect(source).toContain("db.tenantJoin(query, 'tenant_notification_category_settings as tcs'");
    expect(source).toContain("db.tenantJoin(categoryQuery, 'tenant_notification_category_settings as tcs'");
    expect(source).toContain("db.tenantJoin(subtypesQuery, 'tenant_notification_subtype_settings as tss'");
    expect(source).toContain("tenantPredicate: 'literal'");

    expect(source).not.toContain('createTenantScopedQuery');
    expect(source).not.toMatch(/\bknex\(['"](system_email_templates|notification_categories)(\s+as\s+[^'"]*)?['"]\)/);
    expect(source).not.toMatch(/\.andOn\(['"]t(?:cs|ss)\.tenant['"],\s*knex\.raw\(['"]\?['"],\s*\[tenant\]\)\)/);
    expect(source).not.toMatch(/\bknex\('(tenant_email_settings|notification_settings|tenant_email_templates|user_notification_preferences|tenant_notification_subtype_settings|tenant_notification_category_settings|notification_logs)'\)\s*[\r\n]+\s*\.where\(\{[^}]*tenant/);
    expect(source).not.toMatch(/\bknex\('(tenant_email_settings|notification_settings|tenant_email_templates|user_notification_preferences|tenant_notification_subtype_settings|tenant_notification_category_settings|notification_logs)'\)\.where\(\{[^}]*tenant/);
  });
});
