import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const source = readFileSync(resolve(__dirname, 'tenantSettingsActions.ts'), 'utf8');

describe('tenant settings actions tenant-scoped query contract', () => {
  it('uses structural tenant scoping for tenant settings reads and updates', () => {
    expect(source).toContain('createTenantScopedQuery(knex, {');
    expect(source).toContain("table: 'tenant_settings'");
    expect(source).toContain('tenantSettingsQuery(knex, tenant)');

    expect(source).not.toContain(".where({ tenant })");
    expect(source).not.toContain("knex\n    .select('*')\n    .from('tenant_settings')");
    expect(source).not.toContain("knex('tenant_settings')\n      .where");
  });
});
