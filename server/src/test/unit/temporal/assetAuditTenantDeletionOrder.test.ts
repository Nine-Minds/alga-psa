/**
 * Site audit tenant deletion ordering (mobile 2.0 FR15).
 *
 * `asset_audits` and `asset_audit_items` both declare
 * `tenant NOT NULL REFERENCES tenants(tenant)` with no ON DELETE, and
 * ensureTenantDistribution colocates them with `tenants`, so the FK is enforced
 * on Citus too. A tenant that has ever run an audit cannot be deleted unless
 * both tables are purged before `tenants`.
 */
import { describe, expect, it } from 'vitest';
import path from 'path';
import { readFileSync } from 'node:fs';

function readRepoFile(relativePathFromRepoRoot: string): string {
  const repoRoot = path.resolve(__dirname, '../../../../..');
  return readFileSync(path.join(repoRoot, relativePathFromRepoRoot), 'utf8');
}

// Mirrors scripts/validate-tenant-management.ts so the test sees the same list.
function parseDeletionOrder(source: string): string[] {
  const arrayMatch = source.match(
    /const\s+TENANT_TABLES_DELETION_ORDER\s*:\s*string\[\]\s*=\s*\[([\s\S]*?)\n\];/
  );
  if (!arrayMatch) throw new Error('TENANT_TABLES_DELETION_ORDER not found');
  const withoutComments = arrayMatch[1].replace(/\/\/.*$/gm, '');
  return [...withoutComments.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
}

const MIGRATION = 'server/migrations/20261029120000_create_asset_audits.cjs';

describe('asset audit tenant deletion ordering (T138)', () => {
  const order = parseDeletionOrder(
    readRepoFile('ee/temporal-workflows/src/activities/tenant-deletion-activities.ts')
  );
  const migration = readRepoFile(MIGRATION);
  const createdTables = [...migration.matchAll(/createTable\('([a-z_]+)'/g)].map((m) => m[1]);

  it('deletes every table the audit migration creates', () => {
    expect(createdTables.sort()).toEqual(['asset_audit_items', 'asset_audits']);
    for (const table of createdTables) {
      expect(order).toContain(table);
    }
  });

  it('deletes both audit tables before tenants, users and assets', () => {
    const index = (table: string) => order.indexOf(table);
    for (const table of createdTables) {
      expect(index(table)).toBeLessThan(index('assets'));
      expect(index(table)).toBeLessThan(index('users'));
      // `tenants` is removed by the workflow after this list, but guard the
      // position if it is ever added to the array itself.
      if (index('tenants') !== -1) {
        expect(index(table)).toBeLessThan(index('tenants'));
      }
    }
  });

  it('deletes items before their audit', () => {
    expect(order.indexOf('asset_audit_items')).toBeLessThan(order.indexOf('asset_audits'));
  });

  it('keeps the restrictive tenant FK the ordering exists for', () => {
    // If a later migration adds ON DELETE CASCADE the ordering requirement
    // relaxes, but the tables must still be listed, so only the FK shape is
    // asserted here.
    expect(migration).toMatch(/table\.uuid\('tenant'\)\.notNullable\(\)\.references\('tenant'\)\.inTable\('tenants'\)/);
    expect(migration).not.toMatch(/onDelete\(/);
  });
});
