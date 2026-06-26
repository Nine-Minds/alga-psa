import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('tenant core and portal-domain tenant-scoped query contract', () => {
  it('uses structural tenant scoping for core tenant action roots', () => {
    const source = readFileSync(resolve(__dirname, 'coreTenantActions.ts'), 'utf8');
    expect(source).toContain('tenantDb(trx, tenant).table(table)');
    expect(source).toContain("tenantScopedTable(trx, 'tenants', tenant)");
    expect(source).toContain("tenantDb(trx, tenant).table('tenant_companies as tc')");
    expect(source).toContain("tenantScopedTable(trx, 'tenant_companies', tenant)");
    expect(source).not.toContain('createTenantScopedQuery');

    expect(source).not.toContain(".where('tenant', tenant)");
    expect(source).not.toContain(".where('tc.tenant', tenant)");
  });

  it('uses structural tenant scoping for tenant-known portal-domain roots', () => {
    const source = readFileSync(resolve(__dirname, '../lib/PortalDomainModel.ts'), 'utf8');
    expect(source).toContain('tenantDb(knex, tenant).table<PortalDomainRecord>(PORTAL_DOMAIN_TABLE)');
    expect(source).toContain(".unscoped<PortalDomainRecord>(PORTAL_DOMAIN_TABLE, PORTAL_DOMAIN_HOSTNAME_DISCOVERY_REASON)");
    expect(source).toContain('portalDomainsQuery(knex, tenant)');
    expect(source).not.toContain('createTenantScopedQuery');
    expect(source).not.toContain('knex<PortalDomainRecord>(PORTAL_DOMAIN_TABLE)');

    expect(source).not.toContain('.where({ tenant })');
  });
});
