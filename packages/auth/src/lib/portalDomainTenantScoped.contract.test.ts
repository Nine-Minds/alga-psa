import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const portalDomainModelSource = readFileSync(resolve(__dirname, 'PortalDomainModel.ts'), 'utf8');
const portalDomainSessionTokenSource = readFileSync(resolve(__dirname, 'PortalDomainSessionToken.ts'), 'utf8');

describe('portal domain tenant-scoped query contract', () => {
  it('uses structural tenant scoping for tenant-known portal domain roots', () => {
    expect(portalDomainModelSource).toContain('createTenantScopedQuery');
    expect(portalDomainModelSource).toContain('table: PORTAL_DOMAIN_TABLE');
    expect(portalDomainModelSource).not.toContain('.where({ tenant })');
  });

  it('uses structural tenant scoping for tenant-known OTT roots', () => {
    expect(portalDomainSessionTokenSource).toContain('createTenantScopedQuery');
    expect(portalDomainSessionTokenSource).toContain('table: PORTAL_DOMAINS_TABLE');
    expect(portalDomainSessionTokenSource).toContain('table: TABLE_NAME');
    expect(portalDomainSessionTokenSource).not.toContain('tenant, id: portalDomainId');
    expect(portalDomainSessionTokenSource).not.toContain('token_hash: tokenHash, tenant');
    expect(portalDomainSessionTokenSource).not.toContain(".andWhere('tenant', options.tenant)");
  });
});
