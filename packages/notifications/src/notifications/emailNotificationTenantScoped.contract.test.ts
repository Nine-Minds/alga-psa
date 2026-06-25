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
    expect(source).toContain("knex('system_email_templates')");
    expect(source).toContain("knex('notification_subtypes')");

    expect(source).not.toContain('createTenantScopedQuery');
    expect(source).not.toMatch(/\bknex\('(tenant_email_settings|notification_settings|tenant_email_templates|user_notification_preferences|tenant_notification_subtype_settings|tenant_notification_category_settings|notification_logs)'\)\s*[\r\n]+\s*\.where\(\{[^}]*tenant/);
    expect(source).not.toMatch(/\bknex\('(tenant_email_settings|notification_settings|tenant_email_templates|user_notification_preferences|tenant_notification_subtype_settings|tenant_notification_category_settings|notification_logs)'\)\.where\(\{[^}]*tenant/);
  });
});
