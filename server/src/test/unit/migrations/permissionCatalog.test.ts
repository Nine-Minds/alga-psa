/**
 * Permission catalog guard.
 *
 * The catalog under server/migrations/utils/permissions is the only place
 * system permissions and default-role grants are defined. These tests prove the
 * structural rules and the additive/never-destructive contract of the synchronizer
 * (against an in-memory knex stub).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const permissionsDir = path.resolve(__dirname, '../../../../migrations/utils/permissions');

const catalog = require(path.join(permissionsDir, 'catalog.cjs'));
const roleGrants = require(path.join(permissionsDir, 'roleGrants.cjs'));
const { collectCatalogErrors } = require(path.join(permissionsDir, 'catalogValidation.cjs'));
const { buildCatalogPlan, syncPermissionCatalog } = require(path.join(permissionsDir, 'syncPermissionCatalog.cjs'));

type Row = Record<string, any>;

// ---------------------------------------------------------------------------
// In-memory knex stub: enough of the builder surface for the synchronizer, and
// a statement log so a DELETE can be asserted against.
// ---------------------------------------------------------------------------

function makeKnex(seed: Record<string, Row[]>) {
  const tables: Record<string, Row[]> = {};
  for (const [name, rows] of Object.entries(seed)) tables[name] = rows.map((row) => ({ ...row }));
  const statements: string[] = [];

  const knex: any = (expression: string) => {
    const name = String(expression).trim().split(/\s+/)[0];
    const filters: Row[] = [];
    const rows = () => (tables[name] ||= []);
    const matching = () => rows().filter((row) => filters.every((filter) =>
      Object.entries(filter).every(([column, value]) => row[column] === value)));

    const builder: any = {
      where(column: any, value?: any) {
        filters.push(typeof column === 'string' ? { [column.split('.').pop()!]: value } : column);
        return builder;
      },
      orderBy() { return builder; },
      select(...columns: string[]) {
        statements.push(`select:${name}`);
        return Promise.resolve(matching().map((row) => (columns.length === 0
          ? { ...row }
          : Object.fromEntries(columns.map((column) => [column, row[column]])))));
      },
      first(...columns: string[]) {
        statements.push(`select:${name}`);
        const [row] = matching();
        if (!row) return Promise.resolve(undefined);
        return Promise.resolve(columns.length === 0
          ? { ...row }
          : Object.fromEntries(columns.map((column) => [column, row[column]])));
      },
      update(patch: Row) {
        statements.push(`update:${name}`);
        for (const row of matching()) Object.assign(row, patch);
        return Promise.resolve(1);
      },
      del() { statements.push(`delete:${name}`); return Promise.resolve(0); },
      delete() { statements.push(`delete:${name}`); return Promise.resolve(0); },
      insert(payload: Row | Row[]) {
        const incoming = Array.isArray(payload) ? payload : [payload];
        let conflictColumns: string[] = [];
        const commit = () => {
          statements.push(`insert:${name}`);
          for (const row of incoming) {
            const clash = conflictColumns.length > 0
              && rows().some((existing) => conflictColumns.every((column) => existing[column] === row[column]));
            if (!clash) rows().push({ ...row });
          }
          return [];
        };
        const chain: any = {
          onConflict(columns: string[]) { conflictColumns = columns; return chain; },
          ignore() { return Promise.resolve(commit()); },
          then(resolve: any, reject: any) { return Promise.resolve(commit()).then(resolve, reject); },
        };
        return chain;
      },
    };
    return builder;
  };

  knex.transaction = async (handler: (trx: any) => Promise<any>) => {
    const trx: any = (expression: string) => knex(expression);
    trx.isTransaction = true;
    return handler(trx);
  };

  return { knex, tables, statements };
}

const TENANT = '11111111-1111-1111-1111-111111111111';

function tenantFixture(product: 'psa' | 'algadesk') {
  const roles = roleGrants.DEFAULT_ROLES[product]
    .filter((role: any) => !role.legacy)
    .map((role: any, index: number) => ({
      tenant: TENANT,
      role_id: `role-${index}`,
      role_name: role.roleName,
      msp: role.msp,
      client: role.client,
    }));

  return {
    tenants: [{ tenant: TENANT, product_code: product }],
    roles,
    permissions: [],
    role_permissions: [],
  };
}

// ---------------------------------------------------------------------------

describe('permission catalog structure', () => {
  it('validates cleanly', () => {
    expect(collectCatalogErrors()).toEqual([]);
  });

  it.each([
    ['duplicate identity', [
      { resource: 'ticket', action: 'read', msp: true, client: false, description: 'd', products: ['psa'], defaultGrants: {} },
      { resource: 'ticket', action: 'read', msp: true, client: false, description: 'd', products: ['psa'], defaultGrants: {} },
    ], /duplicate catalog identity/],
    ['empty resource', [
      { resource: '', action: 'read', msp: true, client: false, description: 'd', products: ['psa'], defaultGrants: {} },
    ], /resource is empty/],
    ['empty action', [
      { resource: 'ticket', action: '', msp: true, client: false, description: 'd', products: ['psa'], defaultGrants: {} },
    ], /action is empty/],
    ['empty description', [
      { resource: 'ticket', action: 'read', msp: true, client: false, description: '', products: ['psa'], defaultGrants: {} },
    ], /description is empty/],
    ['no scope', [
      { resource: 'ticket', action: 'read', msp: false, client: false, description: 'd', products: ['psa'], defaultGrants: {} },
    ], /neither msp nor client scope/],
    ['unknown product', [
      { resource: 'ticket', action: 'read', msp: true, client: false, description: 'd', products: ['algapsa'], defaultGrants: {} },
    ], /unknown product/],
    ['unresolvable grant', [
      { resource: 'ticket', action: 'read', msp: true, client: false, description: 'd', products: ['psa'], defaultGrants: { psa: ['msp:Editor'] } },
    ], /does not resolve to a psa default role/],
    ['grant outside the permission scope', [
      { resource: 'ticket', action: 'read', msp: true, client: false, description: 'd', products: ['psa'], defaultGrants: { psa: ['client:Admin'] } },
    ], /outside the permission's scope/],
  ])('rejects %s', (_label, entries, pattern) => {
    expect(collectCatalogErrors(entries as any).join('\n')).toMatch(pattern as RegExp);
  });

  it('emits both grant keys for a dual-scope permission and one for a single-scope permission', () => {
    expect(catalog.permissionGrantKeys({ resource: 'settings', action: 'read', msp: true, client: true }))
      .toEqual(['settings:read:msp', 'settings:read:client']);
    expect(catalog.permissionGrantKeys({ resource: 'ticket', action: 'read', msp: true, client: false }))
      .toEqual(['ticket:read:msp']);
    expect(catalog.permissionGrantKeys({ resource: 'ticket', action: 'read', msp: false, client: true }))
      .toEqual(['ticket:read:client']);
  });

  it('keeps a dual-scope permission distinct from a same-named single-scope one', () => {
    const identities = catalog.ACTIVE_PERMISSIONS
      .filter((entry: any) => entry.resource === 'settings' && entry.action === 'read')
      .map(catalog.permissionIdentity);
    expect(identities).toEqual(['settings|read|msp|-', 'settings|read|msp|client', 'settings|read|-|client']);
  });

  it('compiles the MSP Admin all-permissions invariant per product', () => {
    for (const product of catalog.PRODUCTS) {
      const compiled = roleGrants.compileRoleGrants(product);
      const admin = compiled.get('msp:Admin');
      const expected = catalog.getProductPermissions(product)
        .filter((entry: any) => entry.msp === true)
        .map(catalog.permissionIdentity);

      expect(admin.allMsp).toBe(true);
      expect([...admin.identities].sort()).toEqual([...expected].sort());
      expect(admin.identities.every((identity: string) => identity.split('|')[2] === 'msp')).toBe(true);
    }
  });

  it('never grants an MSP-scoped permission to a client role, or vice versa', () => {
    for (const product of catalog.PRODUCTS) {
      const compiled = roleGrants.compileRoleGrants(product);
      for (const [key, target] of compiled) {
        const scope = key.split(':')[0];
        for (const identity of target.identities) {
          const [, , msp, client] = identity.split('|');
          expect(scope === 'msp' ? msp : client, `${product} ${key} -> ${identity}`).not.toBe('-');
        }
      }
    }
  });

  it('produces a stable catalog version', () => {
    expect(catalog.catalogVersion()).toMatch(/^v1-[0-9a-f]{16}$/);
    expect(catalog.catalogVersion()).toBe(catalog.catalogVersion());
  });
});

/**
 * RBAC used to compare resources through a RESOURCE_CANONICAL_MAP that was
 * copy-pasted into six modules — and present in only some of them, so the same
 * permission resolved differently depending on which hasPermission() a caller
 * reached. The catalog now stores the same names the rest of the system uses,
 * so resources are compared verbatim. These guards keep it that way.
 */
describe('permission resources need no translation layer', () => {
  const repoRoot = path.resolve(__dirname, '../../../../..');

  function listApplicationSourceFiles(dir: string): string[] {
    return fs.readdirSync(dir, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() && /\.(cjs|js|jsx|mjs|ts|tsx)$/.test(entry.name))
      .map((entry) => path.join(entry.parentPath ?? (entry as any).path, entry.name))
      .filter((file) => !/(^|\/)(__tests__|test|tests|node_modules|dist|build|\.next)(\/|$)|\.(test|spec)\./
        .test(path.relative(repoRoot, file)));
  }

  it('defines no legacy spelling in the catalog', () => {
    const legacy = Object.keys(catalog.RENAMED_RESOURCES);
    const offenders = catalog.ACTIVE_PERMISSIONS
      .filter((entry: any) => legacy.includes(entry.resource));

    expect(offenders.map(catalog.permissionIdentity)).toEqual([]);
  });

  it('reintroduces no resource alias table in application code', () => {
    const offenders = [
      ...listApplicationSourceFiles(path.join(repoRoot, 'ee')),
      ...listApplicationSourceFiles(path.join(repoRoot, 'packages')),
      ...listApplicationSourceFiles(path.join(repoRoot, 'server/src')),
      ...listApplicationSourceFiles(path.join(repoRoot, 'shared')),
    ]
      .filter((file: string) => fs.readFileSync(file, 'utf8').includes('RESOURCE_CANONICAL_MAP'))
      .map((file: string) => path.relative(repoRoot, file));

    // Fix the permission name at its source (catalog + rename migration)
    // instead of translating it at check time.
    expect(offenders).toEqual([]);
  });
});

describe('no seed defines permissions outside the catalog', () => {
  const repoRoot = path.resolve(__dirname, '../../../../..');
  // A permission definition literal, and any direct write to the RBAC tables.
  // Both belong in server/migrations/utils/permissions now.
  const PERMISSION_LITERAL = /resource:\s*'[^']*'\s*,\s*action:\s*'[^']*'\s*,\s*(msp|client):/;
  const RBAC_TABLE_WRITE = /\.table\(\s*['"](permissions|role_permissions)['"]\s*\)/;

  function seedFiles(dir: string): string[] {
    return fs.readdirSync(dir, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.cjs'))
      .map((entry) => path.join(entry.parentPath ?? (entry as any).path, entry.name));
  }

  const files = [
    ...seedFiles(path.join(repoRoot, 'server/seeds/dev')),
    ...seedFiles(path.join(repoRoot, 'ee/server/seeds/onboarding')),
  ];

  it('finds seed files to check', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it.each(['permission definition literals', 'direct permissions/role_permissions writes'])(
    'has no %s',
    (kind) => {
      const pattern = kind.startsWith('permission definition') ? PERMISSION_LITERAL : RBAC_TABLE_WRITE;
      const offenders = files
        .filter((file) => pattern.test(fs.readFileSync(file, 'utf8')))
        .map((file) => path.relative(repoRoot, file));
      expect(offenders).toEqual([]);
    },
  );
});

describe('permission catalog synchronization', () => {
  it('provisions a fresh PSA tenant and reruns as a no-op', async () => {
    const { knex, tables, statements } = makeKnex(tenantFixture('psa'));

    const first = await syncPermissionCatalog(knex, TENANT, 'psa');
    expect(first.insertedPermissions).toHaveLength(catalog.getProductPermissions('psa').length);
    expect(tables.permissions).toHaveLength(catalog.getProductPermissions('psa').length);
    expect(first.before.rolePermissions).toBe(0);
    expect(first.after.rolePermissions).toBeGreaterThan(0);

    const before = tables.role_permissions.length;
    statements.length = 0;
    const second = await syncPermissionCatalog(knex, TENANT, 'psa');
    expect(second.insertedPermissions).toEqual([]);
    expect(second.insertedGrants).toEqual([]);
    expect(second.updatedDescriptions).toEqual([]);
    expect(tables.role_permissions).toHaveLength(before);
    expect(statements.filter((statement) => statement.startsWith('insert') || statement.startsWith('update'))).toEqual([]);
  });

  it('never issues a DELETE', async () => {
    const { knex, statements } = makeKnex(tenantFixture('psa'));
    await syncPermissionCatalog(knex, TENANT, 'psa');
    await syncPermissionCatalog(knex, TENANT, 'psa');
    expect(statements.filter((statement) => statement.startsWith('delete'))).toEqual([]);
  });

  it('gives MSP Admin every MSP catalog permission and resolves dual-scope client grants', async () => {
    const { knex, tables } = makeKnex(tenantFixture('psa'));
    await syncPermissionCatalog(knex, TENANT, 'psa');

    const permissionById = new Map(tables.permissions.map((row) => [row.permission_id, row]));
    const grantsFor = (roleName: string, msp: boolean) => {
      const role = tables.roles.find((candidate) => candidate.role_name === roleName && candidate.msp === msp)!;
      return tables.role_permissions
        .filter((grant) => grant.role_id === role.role_id)
        .map((grant) => permissionById.get(grant.permission_id)!);
    };

    const adminGrants = grantsFor('Admin', true);
    expect(adminGrants).toHaveLength(catalog.getProductPermissions('psa').filter((entry: any) => entry.msp).length);
    expect(adminGrants.every((permission) => permission.msp === true)).toBe(true);

    // settings:read is msp AND client; the client Admin role must still reach it.
    const clientAdminGrants = grantsFor('Admin', false);
    const settingsRead = clientAdminGrants.find((permission) =>
      permission.resource === 'settings' && permission.action === 'read');
    expect(settingsRead).toBeDefined();
    expect(settingsRead!.msp).toBe(true);
    expect(settingsRead!.client).toBe(true);
  });

  it('preserves unknown permissions, custom roles and extra grants', async () => {
    const fixture = tenantFixture('psa');
    fixture.permissions.push({
      tenant: TENANT,
      permission_id: 'legacy-permission',
      resource: 'legacy_widget',
      action: 'read',
      msp: true,
      client: false,
      description: 'Legacy',
    });
    fixture.roles.push({ tenant: TENANT, role_id: 'custom-role', role_name: 'Auditor', msp: true, client: false });
    fixture.role_permissions.push({ tenant: TENANT, role_id: 'custom-role', permission_id: 'legacy-permission' });
    const adminRole = fixture.roles.find((role) => role.role_name === 'Admin' && role.msp)!;
    fixture.role_permissions.push({ tenant: TENANT, role_id: adminRole.role_id, permission_id: 'legacy-permission' });

    const { knex, tables } = makeKnex(fixture);
    const result = await syncPermissionCatalog(knex, TENANT, 'psa');

    expect(tables.permissions.some((row) => row.permission_id === 'legacy-permission')).toBe(true);
    expect(tables.roles.some((row) => row.role_id === 'custom-role')).toBe(true);
    expect(tables.role_permissions.some((row) =>
      row.role_id === 'custom-role' && row.permission_id === 'legacy-permission')).toBe(true);
    expect(result.preservedUnknownPermissions).toBe(1);
    expect(result.customRoles).toBe(1);
    expect(result.preservedExtraGrants).toBeGreaterThanOrEqual(1);
    expect(result.after.rolePermissions).toBeGreaterThan(result.before.rolePermissions);
  });

  it('refreshes catalog-owned descriptions without touching scope flags', async () => {
    const fixture = tenantFixture('psa');
    const entry = catalog.getProductPermissions('psa')[0];
    fixture.permissions.push({
      tenant: TENANT,
      permission_id: 'drifted',
      resource: entry.resource,
      action: entry.action,
      msp: entry.msp,
      client: entry.client,
      description: 'stale copy',
    });

    const { knex, tables } = makeKnex(fixture);
    const result = await syncPermissionCatalog(knex, TENANT, 'psa');

    const row = tables.permissions.find((candidate) => candidate.permission_id === 'drifted')!;
    expect(result.updatedDescriptions).toContain(catalog.permissionIdentity(entry));
    expect(row.description).toBe(entry.description);
    expect(row.msp).toBe(entry.msp);
    expect(row.client).toBe(entry.client);
  });

  it('fails the tenant when a required default role is missing or ambiguous', async () => {
    const missing = tenantFixture('psa');
    missing.roles = missing.roles.filter((role) => !(role.role_name === 'Dispatcher' && role.msp));
    await expect(syncPermissionCatalog(makeKnex(missing).knex, TENANT, 'psa'))
      .rejects.toThrow(/has no psa default role \(role_name="Dispatcher"/);

    const ambiguous = tenantFixture('psa');
    ambiguous.roles.push({ tenant: TENANT, role_id: 'second-admin', role_name: 'Admin', msp: true, client: false });
    await expect(syncPermissionCatalog(makeKnex(ambiguous).knex, TENANT, 'psa'))
      .rejects.toThrow(/2 roles matching the psa default role identity/);
  });

  it('grants a legacy default role when present and skips it silently when absent', async () => {
    const withManager = tenantFixture('psa');
    withManager.roles.push({ tenant: TENANT, role_id: 'manager', role_name: 'Manager', msp: true, client: false });
    const { knex, tables } = makeKnex(withManager);
    await syncPermissionCatalog(knex, TENANT, 'psa');
    expect(tables.role_permissions.filter((grant) => grant.role_id === 'manager').length)
      .toBe(roleGrants.compileRoleGrants('psa').get('msp:Manager').identities.length);

    const plan = buildCatalogPlan({
      tenantId: TENANT,
      product: 'psa',
      permissions: [],
      roles: tenantFixture('psa').roles,
      rolePermissions: [],
    });
    expect(plan.errors).toEqual([]);
    expect(plan.roleResolution.find((role: any) => role.roleKey === 'msp:Manager').status).toBe('legacy-absent');
  });

  it('refuses an unsupported product transition', async () => {
    const { knex } = makeKnex(tenantFixture('psa'));
    await expect(syncPermissionCatalog(knex, TENANT, 'algadesk'))
      .rejects.toThrow(/Refusing to apply the "algadesk" permission catalog/);
  });

  it('allows the AlgaDesk to AlgaPSA transition before the product_code flip', async () => {
    // The upgrade backfills the PSA seeds while the tenant is still algadesk.
    const fixture = tenantFixture('algadesk');
    for (const role of tenantFixture('psa').roles) {
      if (!fixture.roles.some((existing) => existing.role_name === role.role_name
        && existing.msp === role.msp && existing.client === role.client)) {
        fixture.roles.push({ ...role, role_id: `psa-${role.role_name}-${role.msp}` });
      }
    }

    const { knex, tables } = makeKnex(fixture);
    const result = await syncPermissionCatalog(knex, TENANT, 'psa');

    expect(result.product).toBe('psa');
    expect(tables.permissions.map(catalog.permissionIdentity).sort())
      .toEqual(catalog.getProductPermissions('psa').map(catalog.permissionIdentity).sort());
  });

  it('provisions a fresh AlgaDesk tenant with only AlgaDesk permissions', async () => {
    const { knex, tables } = makeKnex(tenantFixture('algadesk'));
    await syncPermissionCatalog(knex, TENANT, 'algadesk');

    const expected = catalog.getProductPermissions('algadesk').map(catalog.permissionIdentity).sort();
    expect(tables.permissions.map(catalog.permissionIdentity).sort()).toEqual(expected);
    expect(tables.permissions.some((row) => row.resource === 'invoice')).toBe(false);
  });
});

/**
 * The populated path of the reconciliation migrations.
 *
 * A migration that runs against every tenant a database has accumulated cannot
 * be allowed to abort `knex migrate:latest` because one of them drifted: that
 * is how the standard_statuses incident happened, and it is how this catalog's
 * first cut blocked an environment rebuild on a tenant with no MSP Admin role.
 * The earlier green runs only ever saw a database with zero tenants, so nothing
 * in the chain exercised this. These do.
 */
describe('permission catalog reconciliation migration', () => {
  const HEALTHY = '10000000-0000-0000-0000-000000000001';
  const NO_ADMIN_ROLE = '20000000-0000-0000-0000-000000000002';
  const DUPLICATE_ROLE = '30000000-0000-0000-0000-000000000003';
  const NULL_PRODUCT = '40000000-0000-0000-0000-000000000004';
  const UNKNOWN_PRODUCT = '50000000-0000-0000-0000-000000000005';

  const migrations = ['20260827091000_reconcile_tenant_permissions.cjs',
    '20260827120000_reconcile_permission_catalog.cjs'];

  function rolesFor(tenant: string) {
    return roleGrants.DEFAULT_ROLES.psa
      .filter((role: any) => !role.legacy)
      .map((role: any, index: number) => ({
        tenant,
        role_id: `${tenant}-role-${index}`,
        role_name: role.roleName,
        msp: role.msp,
        client: role.client,
      }));
  }

  function driftedFleet() {
    const roles = [HEALTHY, NO_ADMIN_ROLE, DUPLICATE_ROLE, NULL_PRODUCT, UNKNOWN_PRODUCT].flatMap(rolesFor);
    return {
      tenants: [
        { tenant: HEALTHY, product_code: 'psa' },
        // The shape that blocked the environment rebuild: no MSP Admin row.
        { tenant: NO_ADMIN_ROLE, product_code: 'psa' },
        { tenant: DUPLICATE_ROLE, product_code: 'psa' },
        { tenant: NULL_PRODUCT, product_code: null },
        { tenant: UNKNOWN_PRODUCT, product_code: 'legacy-product' },
      ],
      roles: [
        ...roles.filter((role: any) => !(role.tenant === NO_ADMIN_ROLE
          && role.role_name === 'Admin' && role.msp === true && role.client === false)),
        { tenant: DUPLICATE_ROLE, role_id: `${DUPLICATE_ROLE}-second-admin`, role_name: 'Admin', msp: true, client: false },
      ],
      permissions: [],
      role_permissions: [],
    };
  }

  afterEach(() => vi.restoreAllMocks());

  it.each(migrations)('%s reconciles the healthy tenants and skips the drifted ones', async (file) => {
    const migration = require(path.resolve(__dirname, '../../../../migrations', file));
    const { knex, tables } = makeKnex(driftedFleet());
    const warnings: string[] = [];
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation((message: any) => { warnings.push(String(message)); });

    await expect(migration.up(knex)).resolves.not.toThrow();

    const psaIdentities = catalog.getProductPermissions('psa').map(catalog.permissionIdentity).sort();
    const healthy = tables.permissions.filter((row) => row.tenant === HEALTHY);
    expect(healthy.map(catalog.permissionIdentity).sort()).toEqual(psaIdentities);
    expect(tables.role_permissions.some((grant) => grant.tenant === HEALTHY)).toBe(true);

    for (const drifted of [NO_ADMIN_ROLE, DUPLICATE_ROLE, NULL_PRODUCT, UNKNOWN_PRODUCT]) {
      expect(tables.permissions.some((row) => row.tenant === drifted), drifted).toBe(false);
      expect(tables.role_permissions.some((grant) => grant.tenant === drifted), drifted).toBe(false);
    }

    expect(warnings).toHaveLength(4);
    expect(warnings.join('\n')).toContain('has no psa default role (role_name="Admin", msp=true, client=false)');
    expect(warnings.join('\n')).toContain('2 roles matching the psa default role identity');
    expect(warnings.join('\n')).toContain('product_code "null" is missing or invalid');
    expect(warnings.join('\n')).toContain('Unknown product "legacy-product"');
  });

  it('reports a drifted tenant once per run and still reconciles on a rerun', async () => {
    const migration = require(path.resolve(__dirname, '../../../../migrations',
      '20260827120000_reconcile_permission_catalog.cjs'));
    const { knex, tables } = makeKnex(driftedFleet());
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await migration.up(knex);
    const afterFirst = tables.permissions.length;
    await migration.up(knex);

    expect(tables.permissions).toHaveLength(afterFirst);
  });

  it('never deletes while reconciling a drifted fleet', async () => {
    const migration = require(path.resolve(__dirname, '../../../../migrations',
      '20260827120000_reconcile_permission_catalog.cjs'));
    const { knex, statements } = makeKnex(driftedFleet());
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await migration.up(knex);

    expect(statements.filter((statement) => statement.startsWith('delete:'))).toEqual([]);
  });
});

/**
 * Seeds share the migrations' tenant loop but not their forgiveness.
 *
 * A migration has to route around a tenant that drifted years ago; a seed owns
 * the tenant it just created, so drift there is a bug to surface immediately.
 * And a seed must reach EVERY tenant: a competing implementation reconciled
 * only the first row of `tenants`, leaving every other tenant in a developer
 * database silently under-permissioned.
 */
describe('permission catalog seeds', () => {
  const FIRST = 'aaaaaaaa-0000-0000-0000-000000000001';
  const SECOND = 'bbbbbbbb-0000-0000-0000-000000000002';

  function rolesFor(tenant: string, product: 'psa' | 'algadesk') {
    return roleGrants.DEFAULT_ROLES[product]
      .filter((role: any) => !role.legacy)
      .map((role: any, index: number) => ({
        tenant,
        role_id: `${tenant}-role-${index}`,
        role_name: role.roleName,
        msp: role.msp,
        client: role.client,
      }));
  }

  function fleet(products: Array<['psa' | 'algadesk', string]>) {
    return {
      tenants: products.map(([product_code, tenant]) => ({ tenant, product_code })),
      roles: products.flatMap(([product, tenant]) => rolesFor(tenant, product)),
      permissions: [] as Row[],
      role_permissions: [] as Row[],
    };
  }

  function seedModule(file: string) {
    return require(path.resolve(__dirname, '../../../../..', file));
  }

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => vi.restoreAllMocks());

  it('reconciles every tenant in the developer database, not just the first', async () => {
    const { knex, tables } = makeKnex(fleet([['psa', FIRST], ['psa', SECOND]]));

    await seedModule('server/seeds/dev/47_permissions.cjs').seed(knex);
    await seedModule('server/seeds/dev/48_role_permissions.cjs').seed(knex);

    const psaIdentities = catalog.getProductPermissions('psa').map(catalog.permissionIdentity).sort();
    for (const tenant of [FIRST, SECOND]) {
      expect(tables.permissions.filter((row) => row.tenant === tenant).map(catalog.permissionIdentity).sort(), tenant)
        .toEqual(psaIdentities);
      // The grant seed is the one that regressed: `.first()` gave tenant two
      // permissions but no grants at all.
      expect(tables.role_permissions.some((grant) => grant.tenant === tenant), tenant).toBe(true);
    }
  });

  it.each([
    ['server/seeds/dev/47_permissions.cjs', undefined],
    ['server/seeds/dev/48_role_permissions.cjs', undefined],
    ['ee/server/seeds/onboarding/psa/02_permissions.cjs', FIRST],
    ['ee/server/seeds/onboarding/psa/03_role_permissions.cjs', FIRST],
    ['ee/server/seeds/onboarding/algadesk/02_permissions.cjs', FIRST],
    ['ee/server/seeds/onboarding/algadesk/03_role_permissions.cjs', FIRST],
  ])('%s fails loudly on a drifted tenant instead of skipping it', async (file, tenantId) => {
    const product = file.includes('algadesk') ? 'algadesk' : 'psa';
    const state = fleet([[product as 'psa' | 'algadesk', FIRST]]);
    state.roles = state.roles.filter((role: any) =>
      !(role.role_name === 'Admin' && role.msp === true && role.client === false));
    const { knex, tables } = makeKnex(state);

    await expect(seedModule(file).seed(knex, tenantId)).rejects.toThrow(/no \w+ default role/);
    expect(tables.permissions).toEqual([]);
  });

  it('keeps each onboarding seed inside its own product', async () => {
    const { knex, tables } = makeKnex(fleet([['psa', FIRST], ['algadesk', SECOND]]));

    // No tenant id: an appliance seed replay enumerates by product, and must
    // not reach the other product's tenants.
    await seedModule('ee/server/seeds/onboarding/psa/02_permissions.cjs').seed(knex);

    expect(tables.permissions.filter((row) => row.tenant === FIRST).length)
      .toBe(catalog.getProductPermissions('psa').length);
    expect(tables.permissions.filter((row) => row.tenant === SECOND)).toEqual([]);
  });
});
