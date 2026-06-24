/**
 * Add the `job:delete` permission (Clear job monitoring history) to existing
 * tenants and grant it to the MSP Admin role. Job monitoring is an MSP-only
 * feature, so this permission is MSP-only.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  const tenants = await knex('tenants').select('tenant');
  if (!tenants.length) return;

  const newPermissions = [
    { resource: 'job', action: 'delete', msp: true, client: false, description: 'Clear job monitoring history' },
  ];

  for (const { tenant } of tenants) {
    const existingPerms = await knex('permissions')
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
      await knex('permissions').insert(permissionsToAdd);
    }

    // Grant to MSP Admin role (msp=true, client=false, case-insensitive name match)
    const adminRole = await knex('roles')
      .where({ tenant, msp: true, client: false })
      .whereRaw("LOWER(role_name) = 'admin'")
      .first();

    if (adminRole) {
      const jobPerms = await knex('permissions')
        .where({ tenant, msp: true, resource: 'job' })
        .select('permission_id');

      const existingRolePerms = await knex('role_permissions')
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
        await knex('role_permissions').insert(rolePermissionsToAdd);
      }
    }
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  const tenants = await knex('tenants').select('tenant');
  if (!tenants.length) return;

  for (const { tenant } of tenants) {
    // Remove role assignments first (FK constraint), then the permission rows.
    await knex('role_permissions')
      .where('tenant', tenant)
      .whereIn('permission_id', function () {
        this.select('permission_id')
          .from('permissions')
          .where('tenant', tenant)
          .where('resource', 'job')
          .where('action', 'delete');
      })
      .delete();

    await knex('permissions')
      .where('tenant', tenant)
      .where('resource', 'job')
      .where('action', 'delete')
      .delete();
  }
};
