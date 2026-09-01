/**
 * Permission catalog synchronization against a real PostgreSQL schema.
 *
 * Proves the additive contract the reconciliation depends on: catalog entries
 * and default-role grants are inserted, a rerun writes nothing, and unknown
 * permissions, custom roles and extra grants on default roles survive untouched.
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { tenantDb } from '@alga-psa/db';
import { TestContext } from '../../../test-utils/testContext';
import { createTenant } from '../../../test-utils/testDataFactory';

const require = createRequire(import.meta.url);
const permissionsDir = path.resolve(__dirname, '../../../migrations/utils/permissions');
const catalog = require(path.join(permissionsDir, 'catalog.cjs'));
const { DEFAULT_ROLES, compileRoleGrants } = require(path.join(permissionsDir, 'roleGrants.cjs'));
const { syncPermissionCatalog } = require(path.join(permissionsDir, 'syncPermissionCatalog.cjs'));
const { auditTenantCatalog } = require(path.join(permissionsDir, 'auditPermissionCatalog.cjs'));

const helpers = TestContext.createHelpers();
const HOOK_TIMEOUT = 900_000;

describe('permission catalog synchronization integration', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await helpers.beforeAll({ cleanupTables: [] });
  }, HOOK_TIMEOUT);

  afterAll(async () => {
    await helpers.afterAll();
  }, HOOK_TIMEOUT);

  beforeEach(async () => {
    ctx = await helpers.beforeEach();
  }, HOOK_TIMEOUT);

  afterEach(async () => {
    await helpers.afterEach();
  }, HOOK_TIMEOUT);

  function table(tenantId: string, name: string) {
    return tenantDb(ctx.db, tenantId).table(name);
  }

  async function provisionTenant(product: 'psa' | 'algadesk'): Promise<string> {
    const tenantId = await createTenant(ctx.db, `Catalog ${product}`, { productCode: product });
    await table(tenantId, 'roles').insert(DEFAULT_ROLES[product]
      .filter((role: any) => !role.legacy)
      .map((role: any) => ({
        tenant: tenantId,
        role_name: role.roleName,
        description: `${role.roleName} (${role.msp ? 'msp' : 'client'})`,
        msp: role.msp,
        client: role.client,
      })));
    return tenantId;
  }

  async function counts(tenantId: string) {
    const [permissions, roles, grants] = await Promise.all([
      table(tenantId, 'permissions').count({ total: '*' }).first(),
      table(tenantId, 'roles').count({ total: '*' }).first(),
      table(tenantId, 'role_permissions').count({ total: '*' }).first(),
    ]);
    return {
      permissions: Number((permissions as any).total),
      roles: Number((roles as any).total),
      grants: Number((grants as any).total),
    };
  }

  async function roleId(tenantId: string, roleName: string, msp: boolean): Promise<string> {
    const row = await table(tenantId, 'roles')
      .where({ role_name: roleName, msp, client: !msp })
      .first('role_id');
    return (row as any).role_id;
  }

  it('inserts every catalog permission and the default-role grants for a fresh tenant', async () => {
    const tenantId = await provisionTenant('psa');

    const result = await syncPermissionCatalog(ctx.db, tenantId, 'psa');

    const expected = catalog.getProductPermissions('psa');
    expect(result.insertedPermissions).toHaveLength(expected.length);
    expect(result.catalogVersion).toBe(catalog.catalogVersion());

    const rows = await table(tenantId, 'permissions').select('resource', 'action', 'msp', 'client', 'description');
    expect(rows.map((row: any) => catalog.permissionIdentity(row)).sort())
      .toEqual(expected.map(catalog.permissionIdentity).sort());
    for (const row of rows as any[]) {
      const entry = expected.find((candidate: any) => catalog.permissionIdentity(candidate) === catalog.permissionIdentity(row));
      expect(row.description).toBe(entry.description);
    }

    const adminId = await roleId(tenantId, 'Admin', true);
    const adminGrants = await table(tenantId, 'role_permissions').where({ role_id: adminId }).select('permission_id');
    expect(adminGrants).toHaveLength(expected.filter((entry: any) => entry.msp).length);

    const financeId = await roleId(tenantId, 'Finance', true);
    const financeGrants = await table(tenantId, 'role_permissions').where({ role_id: financeId }).select('permission_id');
    expect(financeGrants).toHaveLength(compileRoleGrants('psa').get('msp:Finance').identities.length);
  }, HOOK_TIMEOUT);

  it('is a no-op on a second run', async () => {
    const tenantId = await provisionTenant('psa');
    await syncPermissionCatalog(ctx.db, tenantId, 'psa');
    const before = await counts(tenantId);

    const second = await syncPermissionCatalog(ctx.db, tenantId, 'psa');

    expect(second.insertedPermissions).toEqual([]);
    expect(second.insertedGrants).toEqual([]);
    expect(second.updatedDescriptions).toEqual([]);
    expect(await counts(tenantId)).toEqual(before);

    const audit = await auditTenantCatalog(ctx.db, tenantId, 'psa');
    expect(audit.missingPermissions).toEqual([]);
    expect(audit.missingGrants).toEqual([]);
    expect(audit.errors).toEqual([]);
  }, HOOK_TIMEOUT);

  it('adds only what is missing and never reduces any count', async () => {
    const tenantId = await provisionTenant('psa');
    const [entry] = catalog.getProductPermissions('psa');
    await table(tenantId, 'permissions').insert({
      tenant: tenantId,
      resource: entry.resource,
      action: entry.action,
      msp: entry.msp,
      client: entry.client,
      description: 'stale description',
    });
    const before = await counts(tenantId);

    const result = await syncPermissionCatalog(ctx.db, tenantId, 'psa');
    const after = await counts(tenantId);

    expect(result.updatedDescriptions).toContain(catalog.permissionIdentity(entry));
    const refreshed = await table(tenantId, 'permissions')
      .where({ resource: entry.resource, action: entry.action })
      .first('description');
    expect((refreshed as any).description).toBe(entry.description);

    expect(after.permissions).toBe(before.permissions + catalog.getProductPermissions('psa').length - 1);
    expect(after.roles).toBe(before.roles);
    expect(after.grants).toBeGreaterThan(before.grants);
  }, HOOK_TIMEOUT);

  it('preserves an unknown permission, a custom role and extra grants on a default role', async () => {
    const tenantId = await provisionTenant('psa');
    await syncPermissionCatalog(ctx.db, tenantId, 'psa');

    const [unknown] = await table(tenantId, 'permissions').insert({
      tenant: tenantId,
      resource: 'legacy_widget',
      action: 'read',
      msp: true,
      client: false,
      description: 'Legacy, not in the catalog',
    }).returning('permission_id');
    const [custom] = await table(tenantId, 'roles').insert({
      tenant: tenantId,
      role_name: 'Auditor',
      description: 'Custom role',
      msp: true,
      client: false,
    }).returning('role_id');

    const dispatcherId = await roleId(tenantId, 'Dispatcher', true);
    await table(tenantId, 'role_permissions').insert([
      { tenant: tenantId, role_id: (custom as any).role_id, permission_id: (unknown as any).permission_id },
      { tenant: tenantId, role_id: dispatcherId, permission_id: (unknown as any).permission_id },
    ]);
    const before = await counts(tenantId);

    const result = await syncPermissionCatalog(ctx.db, tenantId, 'psa');

    expect(result.preservedUnknownPermissions).toBe(1);
    expect(result.customRoles).toBe(1);
    expect(result.preservedExtraGrants).toBeGreaterThanOrEqual(1);
    expect(await counts(tenantId)).toEqual(before);

    expect(await table(tenantId, 'permissions')
      .where({ permission_id: (unknown as any).permission_id }).first()).toBeDefined();
    expect(await table(tenantId, 'roles')
      .where({ role_id: (custom as any).role_id }).first()).toBeDefined();
    expect(await table(tenantId, 'role_permissions')
      .where({ role_id: dispatcherId, permission_id: (unknown as any).permission_id }).first()).toBeDefined();
  }, HOOK_TIMEOUT);

  it('grants a dual-scope permission through both the MSP and the client role', async () => {
    const tenantId = await provisionTenant('psa');
    await syncPermissionCatalog(ctx.db, tenantId, 'psa');

    const dualScope = await table(tenantId, 'permissions')
      .where({ resource: 'settings', action: 'read', msp: true, client: true })
      .first('permission_id');
    expect(dualScope).toBeDefined();

    const mspAdmin = await roleId(tenantId, 'Admin', true);
    const clientAdmin = await roleId(tenantId, 'Admin', false);
    for (const role of [mspAdmin, clientAdmin]) {
      expect(await table(tenantId, 'role_permissions')
        .where({ role_id: role, permission_id: (dualScope as any).permission_id })
        .first()).toBeDefined();
    }
  }, HOOK_TIMEOUT);

  it('rolls the tenant back when a required default role is missing', async () => {
    const tenantId = await provisionTenant('psa');
    await table(tenantId, 'roles').where({ role_name: 'Dispatcher', msp: true }).del();
    const before = await counts(tenantId);

    await expect(syncPermissionCatalog(ctx.db, tenantId, 'psa'))
      .rejects.toThrow(/has no psa default role \(role_name="Dispatcher"/);

    expect(await counts(tenantId)).toEqual(before);
  }, HOOK_TIMEOUT);

  it('keeps products isolated and refuses a mismatched product catalog', async () => {
    const psaTenant = await provisionTenant('psa');
    const algadeskTenant = await provisionTenant('algadesk');

    await syncPermissionCatalog(ctx.db, algadeskTenant, 'algadesk');
    const psaBefore = await counts(psaTenant);

    const algadeskRows = await table(algadeskTenant, 'permissions').select('resource', 'action', 'msp', 'client');
    expect(algadeskRows.map((row: any) => catalog.permissionIdentity(row)).sort())
      .toEqual(catalog.getProductPermissions('algadesk').map(catalog.permissionIdentity).sort());

    expect(await counts(psaTenant)).toEqual(psaBefore);
    await expect(syncPermissionCatalog(ctx.db, psaTenant, 'algadesk'))
      .rejects.toThrow(/Refusing to apply the "algadesk" permission catalog/);
  }, HOOK_TIMEOUT);

  it('applies the PSA catalog to an AlgaDesk tenant before the upgrade flips product_code', async () => {
    const tenantId = await provisionTenant('algadesk');
    await syncPermissionCatalog(ctx.db, tenantId, 'algadesk');
    // The upgrade creates the PSA roles before backfilling the PSA seeds.
    await table(tenantId, 'roles').insert(DEFAULT_ROLES.psa
      .filter((role: any) => !role.legacy && !['Admin', 'User'].includes(role.roleName))
      .map((role: any) => ({
        tenant: tenantId,
        role_name: role.roleName,
        description: `${role.roleName} (${role.msp ? 'msp' : 'client'})`,
        msp: role.msp,
        client: role.client,
      })));
    const before = await counts(tenantId);

    const result = await syncPermissionCatalog(ctx.db, tenantId, 'psa');
    const after = await counts(tenantId);

    expect(result.product).toBe('psa');
    expect(after.permissions).toBeGreaterThan(before.permissions);
    expect(after.grants).toBeGreaterThan(before.grants);
    // AlgaDesk-only identities are still there: the upgrade removes nothing.
    const algadeskOnly = catalog.getProductPermissions('algadesk')
      .filter((entry: any) => !entry.products.includes('psa'));
    const rows = await table(tenantId, 'permissions').select('resource', 'action', 'msp', 'client');
    const identities = new Set(rows.map((row: any) => catalog.permissionIdentity(row)));
    for (const entry of algadeskOnly) {
      expect(identities.has(catalog.permissionIdentity(entry))).toBe(true);
    }
  }, HOOK_TIMEOUT);
});
