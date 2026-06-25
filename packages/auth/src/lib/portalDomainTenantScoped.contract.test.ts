import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const portalDomainModelSource = readFileSync(resolve(__dirname, 'PortalDomainModel.ts'), 'utf8');
const portalDomainSessionTokenSource = readFileSync(resolve(__dirname, 'PortalDomainSessionToken.ts'), 'utf8');

describe('portal domain tenant-scoped query contract', () => {
  it('uses structural tenant scoping for tenant-known portal domain roots', () => {
    expect(portalDomainModelSource).toContain('tenantDb(knex, tenant).table<PortalDomainRecord>(PORTAL_DOMAIN_TABLE)');
    expect(portalDomainModelSource).not.toContain('createTenantScopedQuery');
    expect(portalDomainModelSource).not.toContain('.where({ tenant })');
  });

  it('uses structural tenant scoping for tenant-known OTT roots', () => {
    expect(portalDomainSessionTokenSource).toContain('tenantDb(knex, tenant).table<PortalDomainRecord>(PORTAL_DOMAINS_TABLE)');
    expect(portalDomainSessionTokenSource).toContain('tenantDb(trx, tenant).table<PortalDomainSessionOttRow>(TABLE_NAME)');
    expect(portalDomainSessionTokenSource).toContain('tenantDb(knex, options.tenant).table<PortalDomainSessionOttRow>(TABLE_NAME)');
    expect(portalDomainSessionTokenSource).not.toContain('createTenantScopedQuery');
    expect(portalDomainSessionTokenSource).not.toContain('tenant, id: portalDomainId');
    expect(portalDomainSessionTokenSource).not.toContain('token_hash: tokenHash, tenant');
    expect(portalDomainSessionTokenSource).not.toContain(".andWhere('tenant', options.tenant)");
  });
});
