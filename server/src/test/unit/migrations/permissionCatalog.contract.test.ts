/**
 * The other direction of the catalog guard.
 *
 * permissionCatalog.test.ts proves no catalog entry ships without a call site.
 * This file proves the converse: no literal `hasPermission(user, 'x', 'y')` in
 * production code checks a permission the catalog never provisions — the shape
 * of the invoice:credit gap, where a documented endpoint returned 403 for
 * everyone because no tenant had ever been given the permission.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(__dirname, '../../../../..');
const permissionsDir = path.join(repoRoot, 'server/migrations/utils/permissions');
const { ACTIVE_PERMISSIONS } = require(path.join(permissionsDir, 'catalog.cjs'));
const { ALL_MSP, compileLegacyRoleGrants } = require(path.join(permissionsDir, 'roleGrants.cjs'));

const FOLLOW_UP_CARD = '63db81a4-76cf-4486-aca3-a09f7c02efb1';

/**
 * Enforced but never provisioned — a real 403 for every tenant, tracked by its
 * own card. Never extend this list: a new permission goes in the catalog.
 *
 * Six entries left it when the 2026-08-27 usage audit promoted
 * billing_profile_report:read, credential:read, cycle_count:approve,
 * import_export:manage, import_export:read and marketing:manage into the
 * catalog. billing:manage then left it once the Xero CSV export/import routes
 * moved to the granular accounting_integrations:exports_execute permission and
 * no production code checked billing:manage any longer.
 */
const KNOWN_UNDECLARED = [
  'role.read',
  'tenant.create',
  'user.admin',
  'user_schedule.read_all',
] as const;

const productionRoots = ['server/src', 'packages', 'shared', 'ee'];
const excludedPath = /(?:^|\/)(?:__tests__|test|tests|testing|mocks|e2e|dist|node_modules)(?:\/|$)|\.(?:test|spec)\.[cm]?[jt]sx?$/;

function productionPermissionCalls(): Set<string> {
  const calls = new Set<string>();
  const visit = (relativePath: string) => {
    const absolutePath = path.join(repoRoot, relativePath);
    if (excludedPath.test(relativePath)) return;
    for (const entry of fs.readdirSync(absolutePath, { withFileTypes: true })) {
      const child = path.join(relativePath, entry.name);
      if (excludedPath.test(child)) continue;
      if (entry.isDirectory()) visit(child);
      else if (/\.[cm]?[jt]sx?$/.test(entry.name)) {
        const source = fs.readFileSync(path.join(repoRoot, child), 'utf8');
        for (const match of source.matchAll(
          /hasPermission\s*\(\s*[^,]+,\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]/g,
        )) calls.add(`${match[1]}.${match[2]}`);
      }
    }
  };
  for (const root of productionRoots) visit(root);
  return calls;
}

describe('permission catalog contract', () => {
  it('declares every literal production permission check or quarantines the known follow-up', () => {
    const calls = productionPermissionCalls();
    const catalog = new Set<string>(ACTIVE_PERMISSIONS.map(
      (permission: { resource: string; action: string }) => `${permission.resource}.${permission.action}`,
    ));
    const quarantine = new Set<string>(KNOWN_UNDECLARED);
    const missing = [...calls].filter((pair) => !catalog.has(pair) && !quarantine.has(pair)).sort();
    const stale = [...quarantine].filter((pair) => !calls.has(pair)).sort();

    expect(missing, `Add new production permissions to the catalog; never extend KNOWN_UNDECLARED (${FOLLOW_UP_CARD})`).toEqual([]);
    expect(stale, `Remove stale quarantine entries tracked by ${FOLLOW_UP_CARD}`).toEqual([]);
    expect(KNOWN_UNDECLARED).toHaveLength(4);
  });

  it('retains product-specific grants and the secrets screen grants', () => {
    const psa = compileLegacyRoleGrants('psa');
    const algadesk = compileLegacyRoleGrants('algadesk');

    expect(psa.msp.Admin).toBe(ALL_MSP);
    expect(algadesk.msp.Agent).toContain('ticket:read:msp');
    expect(algadesk.client.Admin).toContain('ticket:delete:client');

    // The Secrets settings screen gates on exactly these two.
    for (const product of [psa, algadesk]) {
      expect(product.msp.Admin === ALL_MSP
        || (product.msp.Admin.includes('secrets:view:msp') && product.msp.Admin.includes('secrets:manage:msp'))).toBe(true);
    }
    expect(ACTIVE_PERMISSIONS.filter((permission: { resource: string }) => permission.resource === 'secrets')
      .map((permission: { action: string }) => permission.action).sort()).toEqual(['manage', 'view']);
  });

  it('declares credential:audit with supervisory default grants (msp only)', () => {
    const audit = ACTIVE_PERMISSIONS.find(
      (permission: { resource: string; action: string }) =>
        permission.resource === 'credential' && permission.action === 'audit'
    );
    expect(audit).toBeDefined();
    expect(audit.msp).toBe(true);
    expect(audit.client).toBe(false);
    expect(audit.products).toEqual(expect.arrayContaining(['algadesk', 'psa']));
    // The audit trail is an oversight surface: technicians can reveal but do
    // not see the report of who else did. Admin on both products; Manager on
    // PSA.
    expect(audit.defaultGrants.algadesk).toEqual(['msp:Admin']);
    expect(audit.defaultGrants.psa).toEqual(['msp:Admin', 'msp:Manager']);
  });
});
