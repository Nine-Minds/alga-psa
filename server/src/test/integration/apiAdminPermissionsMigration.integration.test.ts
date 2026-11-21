/**
 * 20261115120000_add_api_admin_permissions against a real PostgreSQL schema.
 *
 * A tenant provisioned before metadata/role/webhook existed in the catalog has
 * no such permissions, so its Admin API key got 403 on /meta, /roles and
 * /webhooks. The migration must give Admin (and only Admin) those grants, and a
 * second run must write nothing.
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { tenantDb } from '@alga-psa/db';
import { TestContext } from '../../../test-utils/testContext';
import { createTenant } from '../../../test-utils/testDataFactory';

const require = createRequire(import.meta.url);
const migrationsDir = path.resolve(__dirname, '../../../migrations');
const permissionsDir = path.join(migrationsDir, 'utils/permissions');
const { DEFAULT_ROLES } = require(path.join(permissionsDir, 'roleGrants.cjs'));
const { syncPermissionCatalog } = require(path.join(permissionsDir, 'syncPermissionCatalog.cjs'));
const migration = require(path.join(migrationsDir, '20261115120000_add_api_admin_permissions.cjs'));

const RESOURCES = ['metadata', 'role', 'webhook'];
const helpers = TestContext.createHelpers();
const HOOK_TIMEOUT = 900_000;

describe('add_api_admin_permissions migration integration', () => {
  let ctx: TestContext;

  beforeAll(async () => { ctx = await helpers.beforeAll({ cleanupTables: [] }); }, HOOK_TIMEOUT);
  afterAll(async () => { await helpers.afterAll(); }, HOOK_TIMEOUT);
  beforeEach(async () => { ctx = await helpers.beforeEach(); }, HOOK_TIMEOUT);
  afterEach(async () => { await helpers.afterEach(); }, HOOK_TIMEOUT);

  const table = (tenantId: string, name: string) => tenantDb(ctx.db, tenantId).table(name);

  async function legacyTenant(): Promise<string> {
    const tenantId = await createTenant(ctx.db, 'API admin legacy tenant', { productCode: 'psa' });
    await table(tenantId, 'roles').insert(DEFAULT_ROLES.psa
      .filter((role: any) => !role.legacy)
      .map((role: any) => ({
        tenant: tenantId, role_name: role.roleName, description: role.roleName, msp: role.msp, client: role.client,
      })));
    await syncPermissionCatalog(ctx.db, tenantId, 'psa');
    // Rewind to the pre-fix state: no metadata/role/webhook permissions or grants.
    const ids = (await table(tenantId, 'permissions').whereIn('resource', RESOURCES).select('permission_id'))
      .map((row: any) => row.permission_id);
    await table(tenantId, 'role_permissions').whereIn('permission_id', ids).delete();
    await table(tenantId, 'permissions').whereIn('permission_id', ids).delete();
    return tenantId;
  }

  async function heldBy(tenantId: string, roleName: string): Promise<string[]> {
    const rows = await table(tenantId, 'role_permissions as rp')
      .join('roles as r', function join() { this.on('r.role_id', 'rp.role_id').andOn('r.tenant', 'rp.tenant'); })
      .join('permissions as p', function join() { this.on('p.permission_id', 'rp.permission_id').andOn('p.tenant', 'rp.tenant'); })
      .where('r.role_name', roleName).where('r.msp', true)
      .whereIn('p.resource', RESOURCES)
      .select('p.resource', 'p.action');
    return (rows as any[]).map((row) => `${row.resource}:${row.action}`).sort();
  }

  async function total(tenantId: string, name: string): Promise<number> {
    return Number(((await table(tenantId, name).count({ total: '*' }).first()) as any).total);
  }

  it('gives an existing tenant Admin the permissions, not other roles, and is a no-op on rerun', async () => {
    const tenantId = await legacyTenant();
    expect(await heldBy(tenantId, 'Admin')).toEqual([]);

    await migration.up(ctx.db);

    const admin = await heldBy(tenantId, 'Admin');
    expect(admin).toContain('metadata:read');
    expect(admin).toEqual(expect.arrayContaining(['role:read', 'role:create', 'role:update', 'role:delete']));
    expect(admin.filter((key) => key.startsWith('webhook:'))).toHaveLength(14);
    expect(await heldBy(tenantId, 'Technician')).toEqual([]);
    expect(await heldBy(tenantId, 'Manager')).toEqual([]);

    const before = { permissions: await total(tenantId, 'permissions'), grants: await total(tenantId, 'role_permissions') };
    await migration.up(ctx.db);
    expect({ permissions: await total(tenantId, 'permissions'), grants: await total(tenantId, 'role_permissions') }).toEqual(before);
  }, HOOK_TIMEOUT);

  it('is irreversible and non-transactional like its sibling migrations', async () => {
    await expect(migration.down()).rejects.toThrow(/irreversible/);
    expect(migration.config).toEqual({ transaction: false });
  });
});
