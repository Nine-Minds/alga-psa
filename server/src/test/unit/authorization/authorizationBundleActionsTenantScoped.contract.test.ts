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
});
