/**
 * Inventory module — permissions. MSP-only resources, granted to the MSP Admin role.
 * Patterned after 20251022000000_add_service_and_storage_permissions.cjs.
 */

const RESOURCES = ['inventory', 'vendor', 'purchase_order', 'sales_order', 'stock_transfer', 'stock_location'];
const ACTIONS = ['create', 'read', 'update', 'delete'];

function buildPermissions() {
  const perms = [];
  for (const resource of RESOURCES) {
    for (const action of ACTIONS) {
      perms.push({ resource, action, msp: true, client: false, description: `${action} ${resource}` });
    }
  }
  return perms;
}

exports.up = async function up(knex) {
  const tenants = await knex('tenants').select('tenant');
  if (!tenants.length) return;

  const newPermissions = buildPermissions();

  for (const { tenant } of tenants) {
    const existingPerms = await knex('permissions').where({ tenant }).select('resource', 'action');
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

    const adminRole = await knex('roles')
      .where({ tenant, msp: true, client: false })
      .whereRaw("LOWER(role_name) = 'admin'")
      .first();

    if (adminRole) {
      const invPerms = await knex('permissions')
        .where({ tenant, msp: true })
        .whereIn('resource', RESOURCES)
        .select('permission_id');

      const existingRolePerms = await knex('role_permissions')
        .where({ tenant, role_id: adminRole.role_id })
        .select('permission_id');
      const existingRolePermIds = new Set(existingRolePerms.map((rp) => rp.permission_id));

      const rolePermissionsToAdd = invPerms
        .filter((p) => !existingRolePermIds.has(p.permission_id))
        .map((p) => ({ tenant, role_id: adminRole.role_id, permission_id: p.permission_id }));

      if (rolePermissionsToAdd.length > 0) {
        await knex('role_permissions').insert(rolePermissionsToAdd);
      }
    }
  }
};

exports.down = async function down(knex) {
  const tenants = await knex('tenants').select('tenant');
  if (!tenants.length) return;

  for (const { tenant } of tenants) {
    await knex('role_permissions')
      .where('tenant', tenant)
      .whereIn('permission_id', function () {
        this.select('permission_id').from('permissions').where('tenant', tenant).whereIn('resource', RESOURCES);
      })
      .delete();

    await knex('permissions').where('tenant', tenant).whereIn('resource', RESOURCES).delete();
  }
};
