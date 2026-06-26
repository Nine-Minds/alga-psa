/**
 * Add the `job:delete` permission (Clear job monitoring history) to existing
 * tenants and grant it to the MSP Admin role. Job monitoring is an MSP-only
 * feature, so this permission is MSP-only.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
const MIGRATION_TENANT = 'migration:20260624120000_add_job_delete_permission';
const TENANT_ENUMERATION_REASON = 'enumerate tenants for job delete permission backfill';

async function loadTenantDb() {
  return (await import('@alga-psa/db')).tenantDb;
}

exports.up = async function (knex) {
  const tenantDb = await loadTenantDb();
  const migrationDb = tenantDb(knex, MIGRATION_TENANT);
  const tenants = await migrationDb.unscoped('tenants', TENANT_ENUMERATION_REASON).select('tenant');
  if (!tenants.length) return;

  const newPermissions = [
    { resource: 'job', action: 'delete', msp: true, client: false, description: 'Clear job monitoring history' },
  ];

  for (const { tenant } of tenants) {
    const db = tenantDb(knex, tenant);
    const existingPerms = await db.table('permissions')
      .where({ tenant })
      .select('resource', 'action');
    const existingMap = new Set(existingPerms.map((p) => `${p.resource}:${p.action}`));

    const permissionsToAdd = newPermissions
      .filter((p) => !existingMap.has(`${p.resource}:${p.action}`))
      .map((p) => ({
        tenant,
        permission_id: knex.raw('gen_random_uuid()'),
        ...p,
        created_at: new Date(),
    }));

    if (permissionsToAdd.length > 0) {
      await db.table('permissions').insert(permissionsToAdd);
    }

    // Grant to MSP Admin role (msp=true, client=false, case-insensitive name match)
    const adminRole = await db.table('roles')
      .where({ tenant, msp: true, client: false })
      .whereRaw("LOWER(role_name) = 'admin'")
      .first();

    if (adminRole) {
      const jobPerms = await db.table('permissions')
        .where({ tenant, msp: true, resource: 'job' })
        .select('permission_id');

      const existingRolePerms = await db.table('role_permissions')
        .where({ tenant, role_id: adminRole.role_id })
        .select('permission_id');
      const existingRolePermIds = new Set(existingRolePerms.map((rp) => rp.permission_id));

      const rolePermissionsToAdd = jobPerms
        .filter((p) => !existingRolePermIds.has(p.permission_id))
        .map((p) => ({
          tenant,
          role_id: adminRole.role_id,
          permission_id: p.permission_id,
      }));

      if (rolePermissionsToAdd.length > 0) {
        await db.table('role_permissions').insert(rolePermissionsToAdd);
      }
    }
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  const tenantDb = await loadTenantDb();
  const migrationDb = tenantDb(knex, MIGRATION_TENANT);
  const tenants = await migrationDb.unscoped('tenants', TENANT_ENUMERATION_REASON).select('tenant');
  if (!tenants.length) return;

  for (const { tenant } of tenants) {
    const db = tenantDb(knex, tenant);
    const permissionIds = await db.table('permissions')
      .where('tenant', tenant)
      .where('resource', 'job')
      .where('action', 'delete')
      .pluck('permission_id');

    if (!permissionIds.length) {
      continue;
    }

    // Remove role assignments first (FK constraint), then the permission rows.
    await db.table('role_permissions')
      .where('tenant', tenant)
      .whereIn('permission_id', permissionIds)
      .delete();

    await db.table('permissions')
      .where('tenant', tenant)
      .where('resource', 'job')
      .where('action', 'delete')
      .delete();
  }
};
