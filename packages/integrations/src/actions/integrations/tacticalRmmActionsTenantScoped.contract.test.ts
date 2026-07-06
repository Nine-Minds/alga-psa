import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(__dirname, 'tacticalRmmActions.ts'), 'utf8');

function sectionBetween(startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);

  return source.slice(start, end);
}

describe('Tactical RMM action tenant-scoped query contract', () => {
  it('uses structural tenant scoping for top settings, summary, test, and organization sync roots', () => {
    const section = sectionBetween('export const getTacticalRmmSettings', 'export const syncTacticalRmmDevices');

    expect(source).toContain("import { createTenantKnex, tenantDb } from '@alga-psa/db';");
    expect(source).toContain('function tenantScopedTable(conn: Knex | Knex.Transaction, table: string, tenant: string): Knex.QueryBuilder');
    expect(source).toContain('tenantDb(conn, tenant).table(table)');
    expect(source).not.toContain('createTenantScopedQuery');

    expect(section).toContain("tenantScopedTable(knex, 'rmm_integrations', tenant)");
    expect(section).toContain("tenantScopedTable(knex, 'rmm_organization_mappings', tenant)");
    expect(section).toContain("tenantScopedTable(knex, 'assets', tenant)");
    expect(section).toContain("tenantScopedTable(knex, 'rmm_alerts', tenant)");
    expect(section).toContain(".where('provider', PROVIDER)");
    expect(section).toContain(".where('integration_id', integration.integration_id)");

    expect(section).not.toMatch(/\.where\(\{\s*tenant[,}]/);
    expect(section).not.toMatch(/\.where\(\{\s*'[^']*\.tenant':\s*tenant/);
    expect(section).not.toMatch(/\.where\(['"]tenant['"],\s*tenant\)/);
  });
});
