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

function sectionFrom(startMarker: string): string {
  const start = source.indexOf(startMarker);

  expect(start).toBeGreaterThanOrEqual(0);

  return source.slice(start);
}

function expectNoDirectTenantRoot(section: string): void {
  expect(section).not.toMatch(/\.where\(\{\s*tenant[,}]/);
  expect(section).not.toMatch(/\.where\(\{\s*tenant:/);
  expect(section).not.toMatch(/\.where\(['"]tenant['"],\s*tenant\)/);
  expect(section).not.toMatch(/\.where\(['"][A-Za-z0-9_]+\.[Tt]enant['"],\s*tenant\)/);
}

describe('NinjaOne action tenant-scoped query contract', () => {
  it('centralizes tenant-scoped query construction for migrated NinjaOne action roots', () => {
    expect(source).toContain("import { tenantDb } from '@alga-psa/db';");
    expect(source).toContain('const db = tenantDb(knex, tenant);');
    expect(source).not.toContain('function tenantScopedTable');
    expect(source).not.toContain('createTenantScopedQuery');
  });

  it('uses structural tenant scoping for connection, disconnect, and organization sync roots', () => {
    const section = sectionBetween('export const getNinjaOneConnectionStatus', 'export const getNinjaOneOrganizationMappings');

    expect(section).toContain("db.table('rmm_integrations')");
    expect(section).toContain("db.table('rmm_organization_mappings')");
    expect(section).toContain("db.table('rmm_alerts')");
    expect(section).toContain(".where('provider', 'ninjaone')");
    expect(section).toContain(".where('integration_id', integration.integration_id)");
    expectNoDirectTenantRoot(section);
  });

  it('uses structural tenant scoping for organization mappings and sync trigger roots', () => {
    const section = sectionBetween('export const getNinjaOneOrganizationMappings', 'export const getNinjaOneRemoteAccessUrl');

    expect(section).toContain("db.table('rmm_integrations')");
    expect(section).toContain("db.table('rmm_organization_mappings as rom')");
    expect(section).toContain("db.table('rmm_organization_mappings')");
    expect(section).toContain(".where('provider', 'ninjaone')");
    expect(section).toContain(".where('rom.integration_id', integration.integration_id)");
    expect(section).toContain(".where('mapping_id', mappingId)");
    expectNoDirectTenantRoot(section);
    expect(section).not.toMatch(/\.where\(['"]rom\.tenant['"],\s*tenant\)/);
  });

  it('uses structural tenant scoping for remote access, asset alert, and device detail roots', () => {
    const section = sectionBetween('export const getNinjaOneRemoteAccessUrl', 'export const triggerPatchStatusSync');

    expect(section).toContain("db.table('assets')");
    expect(section).toContain("db.table('rmm_alerts')");
    expect(section).toContain(".where('asset_id', assetId)");
    expect(section).toContain(".where('alert_id', alertId)");
    expectNoDirectTenantRoot(section);
  });

  it('uses structural tenant scoping for patch and software sync trigger roots', () => {
    const section = sectionBetween('export const triggerPatchStatusSync', 'export const searchSoftware');

    expect(section).toContain("db.table('rmm_integrations')");
    expect(section).toContain(".where('provider', 'ninjaone')");
    expectNoDirectTenantRoot(section);
  });

  it('uses structural tenant scoping and tenant joins for compliance summary roots', () => {
    const section = sectionFrom('export const getRmmComplianceSummary');

    expect(section).toContain("db.table('assets')");
    expect(section).toContain("db.table('rmm_alerts')");
    expect(section).toContain("db.table('workstation_assets as aw')");
    expect(section).toContain("db.tenantJoin(workstationPatchesQuery, 'assets as a', 'a.asset_id', 'aw.asset_id')");
    expect(section).toContain("db.table('server_assets as asrv')");
    expect(section).toContain("db.tenantJoin(serverPatchesQuery, 'assets as a', 'a.asset_id', 'asrv.asset_id')");
    expect(section).toContain("db.table('rmm_integrations')");
    expectNoDirectTenantRoot(section);
  });

  it('has no remaining direct tenant roots in NinjaOne actions', () => {
    expectNoDirectTenantRoot(source);
  });
});
