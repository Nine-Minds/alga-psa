import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const source = readFileSync(resolve(__dirname, 'microsoftConsumerProfileResolution.ts'), 'utf8');

describe('integrations Microsoft consumer profile resolution tenant-scoped query contract', () => {
  it('uses structural tenant scoping for tenant-known Microsoft profile resolution roots', () => {
    expect(source).toContain('createTenantScopedQuery');
    expect(source).toContain("tenantScopedTable(db, 'microsoft_profiles', tenant)");
    expect(source).toContain("tenantScopedTable(db, 'microsoft_profile_consumer_bindings', tenant)");
    expect(source).toContain("tenantScopedTable(db, 'msp_sso_tenant_login_domains', tenant)");
    expect(source).toContain("tenantScopedTable(db, 'email_providers', tenant)");
    expect(source).toContain("tenantScopedTable(db, 'calendar_providers', tenant)");
    expect(source).not.toContain("db('microsoft_profiles').where({ tenant");
    expect(source).not.toContain(".where({ tenant, consumer_type: consumerType })");
    expect(source).not.toContain(".where({ tenant, profile_id: profileId })");
    expect(source).not.toContain('.where({ tenant, is_active: true })');
    expect(source).not.toContain(".where({ tenant, provider_type: 'microsoft' })");
  });
});
