import { describe, expect, it } from 'vitest';
import path from 'path';
import { readFileSync } from 'node:fs';

function readRepoFile(relativePathFromRepoRoot: string): string {
  const repoRoot = path.resolve(__dirname, '../../../../..');
  return readFileSync(path.join(repoRoot, relativePathFromRepoRoot), 'utf8');
}

describe('msp sso tenant login domains migration', () => {
  const migration = readRepoFile('server/migrations/20260224103000_create_msp_sso_tenant_login_domains.cjs');

  it('T001: creates tenant MSP SSO login-domain persistence model columns', () => {
    expect(migration).toContain("createTable('msp_sso_tenant_login_domains'");
    expect(migration).toContain("table.uuid('tenant').notNullable()");
    expect(migration).toContain("table.uuid('id').notNullable().defaultTo(knex.raw('gen_random_uuid()'))");
    expect(migration).toContain("table.text('domain').notNullable()");
    expect(migration).toContain("table.boolean('is_active').notNullable().defaultTo(true)");
    expect(migration).toContain("table.uuid('created_by')");
    expect(migration).toContain("table.uuid('updated_by')");
    expect(migration).toContain("table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now())");
    expect(migration).toContain("table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now())");
  });

  it('T002: rollback drops tenant MSP SSO login-domain table', () => {
    expect(migration).toContain("await knex.schema.dropTableIfExists('msp_sso_tenant_login_domains');");
  });

  it('T003: schema adds indexes for normalized-domain lookup and tenant listing', () => {
    expect(migration).toContain('msp_sso_tenant_login_domains_tenant_domain_uniq');
    expect(migration).toContain('ON msp_sso_tenant_login_domains (tenant, lower(domain));');
    expect(migration).toContain('msp_sso_tenant_login_domains_domain_active_idx');
    expect(migration).toContain('ON msp_sso_tenant_login_domains (lower(domain))');
    expect(migration).toContain('WHERE is_active = true;');
    expect(migration).toContain('msp_sso_tenant_login_domains_tenant_active_idx');
    expect(migration).toContain('ON msp_sso_tenant_login_domains (tenant, is_active, domain);');
  });
});
