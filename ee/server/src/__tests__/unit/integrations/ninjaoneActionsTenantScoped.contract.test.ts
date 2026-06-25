import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(
  resolve(__dirname, '../../../lib/actions/integrations/ninjaoneActions.ts'),
  'utf8'
);

function sectionBetween(startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);

  return source.slice(start, end);
}

function expectNoDirectTenantRoot(section: string): void {
  expect(section).not.toMatch(/\.where\(\{\s*tenant[,}]/);
  expect(section).not.toMatch(/\.where\(\{\s*tenant:/);
  expect(section).not.toMatch(/\.where\(['"]tenant['"],\s*tenant\)/);
}

describe('NinjaOne action tenant-scoped query contract', () => {
  it('centralizes tenant-scoped query construction for migrated NinjaOne action roots', () => {
    expect(source).toContain("import { createTenantScopedQuery } from '@alga-psa/db';");
    expect(source).toContain('function tenantScopedTable(conn: Knex, table: string, tenant: string): Knex.QueryBuilder');
    expect(source).toContain('createTenantScopedQuery(conn, { table, tenant }).builder');
  });

  it('uses structural tenant scoping for connection, disconnect, and organization sync roots', () => {
    const section = sectionBetween('export const getNinjaOneConnectionStatus', 'export const getNinjaOneOrganizationMappings');

    expect(section).toContain("tenantScopedTable(knex, 'rmm_integrations', tenant)");
    expect(section).toContain("tenantScopedTable(knex, 'rmm_organization_mappings', tenant)");
    expect(section).toContain("tenantScopedTable(knex, 'rmm_alerts', tenant)");
    expect(section).toContain(".where('provider', 'ninjaone')");
    expect(section).toContain(".where('integration_id', integration.integration_id)");
    expectNoDirectTenantRoot(section);
  });

  it('uses structural tenant scoping for organization mappings and sync trigger roots', () => {
    const section = sectionBetween('export const getNinjaOneOrganizationMappings', 'export const getNinjaOneRemoteAccessUrl');

    expect(section).toContain("tenantScopedTable(knex, 'rmm_integrations', tenant)");
    expect(section).toContain("tenantScopedTable(knex, 'rmm_organization_mappings as rom', tenant)");
    expect(section).toContain("tenantScopedTable(knex, 'rmm_organization_mappings', tenant)");
    expect(section).toContain(".where('provider', 'ninjaone')");
    expect(section).toContain(".where('rom.integration_id', integration.integration_id)");
    expect(section).toContain(".where('mapping_id', mappingId)");
    expectNoDirectTenantRoot(section);
    expect(section).not.toMatch(/\.where\(['"]rom\.tenant['"],\s*tenant\)/);
  });

  it('uses structural tenant scoping for remote access, asset alert, and device detail roots', () => {
    const section = sectionBetween('export const getNinjaOneRemoteAccessUrl', 'export const triggerPatchStatusSync');

    expect(section).toContain("tenantScopedTable(knex, 'assets', tenant)");
    expect(section).toContain("tenantScopedTable(knex, 'rmm_alerts', tenant)");
    expect(section).toContain(".where('asset_id', assetId)");
    expect(section).toContain(".where('alert_id', alertId)");
    expectNoDirectTenantRoot(section);
  });
});
