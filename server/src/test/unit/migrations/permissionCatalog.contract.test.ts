import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(process.cwd(), '..');
const { PERMISSIONS, ROLE_GRANTS } = require(path.join(
  repoRoot,
  'server/migrations/utils/permissionCatalog.cjs',
));

const FOLLOW_UP_CARD = '63db81a4-76cf-4486-aca3-a09f7c02efb1';
const KNOWN_UNDECLARED = [
  'billing.manage',
  'billing_profile_report.read',
  'credential.read',
  'cycle_count.approve',
  'import_export.manage',
  'import_export.read',
  'marketing.manage',
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
    const catalog = new Set<string>(PERMISSIONS.map(
      (permission: { resource: string; action: string }) => `${permission.resource}.${permission.action}`,
    ));
    const quarantine = new Set<string>(KNOWN_UNDECLARED);
    const missing = [...calls].filter((pair) => !catalog.has(pair) && !quarantine.has(pair)).sort();
    const stale = [...quarantine].filter((pair) => !calls.has(pair)).sort();

    expect(missing, `Add new production permissions to the catalog; never extend KNOWN_UNDECLARED (${FOLLOW_UP_CARD})`).toEqual([]);
    expect(stale, `Remove stale quarantine entries tracked by ${FOLLOW_UP_CARD}`).toEqual([]);
    expect(KNOWN_UNDECLARED).toHaveLength(11);
  });

  it('retains product-specific grants and the secrets Editor grants', () => {
    expect(ROLE_GRANTS.psa.msp.Admin).toBe('ALL_MSP');
    expect(ROLE_GRANTS.psa.msp.Editor).toEqual(expect.arrayContaining([
      'secrets:view:msp',
      'secrets:use:msp',
    ]));
    expect(ROLE_GRANTS.algadesk.msp.Agent).toContain('ticket:read:msp');
    expect(ROLE_GRANTS.algadesk.client.Admin).toContain('ticket:delete:client');
  });
});
