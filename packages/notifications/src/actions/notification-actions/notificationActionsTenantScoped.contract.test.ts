import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const source = readFileSync(resolve(__dirname, 'notificationActions.ts'), 'utf8');

describe('notification actions tenant-scoped query contract', () => {
  it('uses structural tenant scoping for tenant-owned notification action roots', () => {
    expect(source).toContain('function tenantScopedTable');
    expect(source).toContain('tenantScopedTable(trx, "tenant_email_templates", tenant)');
    expect(source).toContain("tenantScopedTable(trx, 'tenant_notification_category_settings', tenant)");
    expect(source).toContain("tenantScopedTable(trx, 'tenant_notification_subtype_settings', tenant)");
    expect(source).toContain("tenantScopedTable(trx, 'users', tenant)");
    expect(source).toContain("trx('system_email_templates')");
    expect(source).toContain("trx('notification_categories as nc')");
    expect(source).toContain("trx('notification_subtypes as ns')");

    expect(source).not.toMatch(/\btrx\(["'](tenant_email_templates|tenant_notification_category_settings|tenant_notification_subtype_settings|users)["']\)\s*[\r\n]+\s*\.where\(\{[^}]*tenant/);
    expect(source).not.toMatch(/\btrx\(["'](tenant_email_templates|tenant_notification_category_settings|tenant_notification_subtype_settings|users)["']\)\.where\(\{[^}]*tenant/);
  });
});
