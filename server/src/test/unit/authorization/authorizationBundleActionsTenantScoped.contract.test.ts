import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const source = readFileSync(
  path.resolve(
    import.meta.dirname,
    '../../../../../ee/server/src/lib/actions/auth/authorizationBundleActions.ts',
  ),
  'utf8',
);

function sectionBetween(start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = startIndex === -1 ? -1 : source.indexOf(end, startIndex + start.length);

  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);

  return source.slice(startIndex, endIndex);
}

const seedSection = sectionBetween(
  'export const seedStarterAuthorizationBundlesAction',
  'export const cloneAuthorizationBundleAction'
);
const draftEditorSection = sectionBetween(
  'export const getAuthorizationBundleDraftEditorAction',
  'export const upsertAuthorizationBundleDraftRuleAction'
);
const assignmentsSection = sectionBetween(
  'export const listAuthorizationBundleAssignmentsAction',
  'export const listAuthorizationSimulationPrincipalsAction'
);
const simulationOptionsSection = sectionBetween(
  'export const listAuthorizationSimulationPrincipalsAction',
  'function normalizeBundleRules'
);
const simulationRecordLoaderSection = sectionBetween(
  'async function loadSimulationRecord',
  'function getSimulationModeValidationError'
);

describe('authorization bundle action tenant-scoped query contract', () => {
  it('uses structural tenant scoping for starter seeding and draft-editor roots', () => {
    expect(source).toContain("import { createTenantScopedQuery } from '@alga-psa/db';");
    expect(source).toContain(
      'function tenantScopedTable(knexOrTrx: Knex | Knex.Transaction, tenant: string, table: string): Knex.QueryBuilder'
    );
    expect(source).toContain('createTenantScopedQuery(knexOrTrx, { table, tenant }).builder');

    expect(seedSection).toContain("tenantScopedTable(trx, tenant, 'authorization_bundles')");
    expect(draftEditorSection).toContain("tenantScopedTable(knex, tenant, 'authorization_bundles')");
    expect(draftEditorSection).toContain("tenantScopedTable(knex, tenant, 'authorization_bundle_revisions')");
    expect(draftEditorSection).toContain("tenantScopedTable(knex, tenant, 'clients')");
    expect(draftEditorSection).toContain("tenantScopedTable(knex, tenant, 'boards')");

    expect(seedSection).not.toMatch(/\.where\(\{[^}]*['"]?tenant['"]?\s*:/s);
    expect(draftEditorSection).not.toMatch(/\.where\(\{[^}]*['"]?tenant['"]?\s*:/s);
    expect(seedSection).not.toContain("trx('authorization_bundles')");
    expect(draftEditorSection).not.toContain("knex('authorization_bundles')");
    expect(draftEditorSection).not.toContain("knex('authorization_bundle_revisions')");
    expect(draftEditorSection).not.toContain("knex('clients')");
    expect(draftEditorSection).not.toContain("knex('boards')");
  });

  it('uses structural tenant scoping for assignment and simulator lookup roots', () => {
    expect(assignmentsSection).toContain("tenantScopedTable(knex, tenant, 'authorization_bundle_assignments')");
    expect(assignmentsSection).toContain("tenantScopedTable(knex, tenant, 'roles')");
    expect(assignmentsSection).toContain("tenantScopedTable(knex, tenant, 'teams')");
    expect(assignmentsSection).toContain("tenantScopedTable(knex, tenant, 'users')");
    expect(assignmentsSection).toContain("tenantScopedTable(knex, tenant, 'api_keys')");
    expect(assignmentsSection).toContain("tenantScopedTable(knex, tenant, 'api_keys as ak')");
    expect(simulationOptionsSection).toContain("tenantScopedTable(knex, tenant, 'users')");
    expect(simulationOptionsSection).toContain("tenantScopedTable(knex, tenant, 'tickets')");
    expect(simulationOptionsSection).toContain("tenantScopedTable(knex, tenant, 'documents')");
    expect(simulationOptionsSection).toContain("tenantScopedTable(knex, tenant, 'time_entries')");
    expect(simulationOptionsSection).toContain("tenantScopedTable(knex, tenant, 'projects')");
    expect(simulationOptionsSection).toContain("tenantScopedTable(knex, tenant, 'assets')");
    expect(simulationOptionsSection).toContain("tenantScopedTable(knex, tenant, 'quotes')");
    expect(simulationRecordLoaderSection).toContain("tenantScopedTable(knex, tenant, 'tickets')");
    expect(simulationRecordLoaderSection).toContain("tenantScopedTable(knex, tenant, 'documents')");
    expect(simulationRecordLoaderSection).toContain("tenantScopedTable(knex, tenant, 'time_entries')");
    expect(simulationRecordLoaderSection).toContain("tenantScopedTable(knex, tenant, 'projects')");
    expect(simulationRecordLoaderSection).toContain("tenantScopedTable(knex, tenant, 'assets')");
    expect(simulationRecordLoaderSection).toContain("tenantScopedTable(knex, tenant, 'quotes')");

    for (const section of [assignmentsSection, simulationOptionsSection, simulationRecordLoaderSection]) {
      expect(section).not.toMatch(/\.where\(\{[^}]*['"]?tenant['"]?\s*:/s);
      expect(section).not.toMatch(/\.where\(['"][^'"]*tenant['"]\s*,\s*tenant\)/);
    }

    expect(assignmentsSection).not.toContain("knex('authorization_bundle_assignments')");
    expect(assignmentsSection).not.toContain("knex('roles')");
    expect(assignmentsSection).not.toContain("knex('teams')");
    expect(assignmentsSection).not.toContain("knex('users')");
    expect(assignmentsSection).not.toContain("knex('api_keys')");
    expect(assignmentsSection).not.toContain(".where('ak.tenant', tenant)");
    expect(simulationOptionsSection).not.toContain("knex('users')");
    expect(simulationOptionsSection).not.toContain("knex('tickets')");
    expect(simulationOptionsSection).not.toContain("knex('documents')");
    expect(simulationOptionsSection).not.toContain("knex('time_entries')");
    expect(simulationOptionsSection).not.toContain("knex('projects')");
    expect(simulationOptionsSection).not.toContain("knex('assets')");
    expect(simulationOptionsSection).not.toContain("knex('quotes')");
    expect(simulationRecordLoaderSection).not.toContain("knex('tickets')");
    expect(simulationRecordLoaderSection).not.toContain("knex('documents')");
    expect(simulationRecordLoaderSection).not.toContain("knex('time_entries')");
    expect(simulationRecordLoaderSection).not.toContain("knex('projects')");
    expect(simulationRecordLoaderSection).not.toContain("knex('assets')");
    expect(simulationRecordLoaderSection).not.toContain("knex('quotes')");
  });
});
