import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(process.cwd(), '..');
const { PERMISSIONS, ROLE_GRANTS, RETIRED, reconcileSeedTenants, reconcileTenantPermissions } = require(path.join(
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

type Row = Record<string, any>;

function catalogHarness() {
  const tables: Record<string, Row[]> = { tenants: [], permissions: [], roles: [], role_permissions: [] };
  let sequence = 0;
  const knex: any = (table: string) => {
    let rows = tables[table];
    let predicates: Array<(row: Row) => boolean> = [];
    const filtered = () => rows.filter((row) => predicates.every((predicate) => predicate(row)));
    const query: any = {
      where(condition: Row) { predicates.push((row) => Object.entries(condition).every(([key, value]) => row[key] === value)); return query; },
      whereIn(key: string, values: unknown[]) { predicates.push((row) => values.includes(row[key])); return query; },
      select(..._keys: string[]) { return query; },
      pluck(key: string) { return Promise.resolve(filtered().map((row) => row[key])); },
      insert(input: Row | Row[]) { (Array.isArray(input) ? input : [input]).forEach((row) => rows.push({ ...row })); return Promise.resolve(); },
      delete() { const matched = filtered(); rows = tables[table] = rows.filter((row) => !matched.includes(row)); return Promise.resolve(matched.length); },
      then(resolve: (value: Row[]) => unknown) { return Promise.resolve(filtered().map((row) => ({ ...row }))).then(resolve); },
    };
    return query;
  };
  knex.raw = () => `generated-${++sequence}`;
  return { knex, tables };
}

function addTenantWithRoles(tables: Record<string, Row[]>, tenant: string, product_code = 'psa') {
  tables.tenants.push({ tenant, product_code });
  tables.roles.push(
    { tenant, role_id: `${tenant}-msp-admin`, role_name: 'Admin', msp: true, client: false },
    { tenant, role_id: `${tenant}-msp-editor`, role_name: 'Editor', msp: true, client: false },
    { tenant, role_id: `${tenant}-client-admin`, role_name: 'Admin', msp: false, client: true },
  );
}

describe('permission catalog reconciliation behavior', () => {
  it('populates an empty tenant and is idempotent', async () => {
    const { knex, tables } = catalogHarness();
    addTenantWithRoles(tables, 'tenant-a');
    await reconcileTenantPermissions(knex, 'tenant-a', 'psa');
    const firstPermissions = structuredClone(tables.permissions);
    const firstGrants = structuredClone(tables.role_permissions);
    expect(firstPermissions).toHaveLength(PERMISSIONS.length);
    expect(firstGrants.length).toBeGreaterThan(0);
    await reconcileTenantPermissions(knex, 'tenant-a', 'psa');
    expect(tables.permissions).toEqual(firstPermissions);
    expect(tables.role_permissions).toEqual(firstGrants);
  });

  it('preserves hand-added permissions but retires explicitly retired entries and their grants', async () => {
    const { knex, tables } = catalogHarness();
    addTenantWithRoles(tables, 'tenant-a');
    tables.permissions.push(
      { tenant: 'tenant-a', permission_id: 'custom', resource: 'custom', action: 'manage', msp: true, client: false },
      { tenant: 'tenant-a', permission_id: 'retired', resource: RETIRED[0].resource, action: RETIRED[0].action, msp: true, client: false },
    );
    tables.role_permissions.push({ tenant: 'tenant-a', role_id: 'tenant-a-msp-admin', permission_id: 'retired' });
    await reconcileTenantPermissions(knex, 'tenant-a', 'psa');
    expect(tables.permissions).toContainEqual(expect.objectContaining({ permission_id: 'custom' }));
    expect(tables.permissions).not.toContainEqual(expect.objectContaining({ permission_id: 'retired' }));
    expect(tables.role_permissions).not.toContainEqual(expect.objectContaining({ permission_id: 'retired' }));
  });

  it('makes onboarding seed wrappers match direct reconciliation for each product', async () => {
    for (const productCode of ['psa', 'algadesk']) {
      const direct = catalogHarness(); const seeded = catalogHarness();
      addTenantWithRoles(direct.tables, 'tenant-a', productCode);
      addTenantWithRoles(seeded.tables, 'tenant-a', productCode);
      await reconcileTenantPermissions(direct.knex, 'tenant-a', productCode);
      await reconcileSeedTenants(seeded.knex, { tenantId: 'tenant-a', productCode });
      const comparablePermissions = (rows: Row[]) => rows.map(({ created_at, ...row }) => row);
      expect(comparablePermissions(seeded.tables.permissions)).toEqual(comparablePermissions(direct.tables.permissions));
      expect(seeded.tables.role_permissions).toEqual(direct.tables.role_permissions);
    }
  });
});
