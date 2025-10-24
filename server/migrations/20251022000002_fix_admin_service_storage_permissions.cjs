/**
 * Fix: Ensure ALL MSP Admin roles have service and storage permissions
 *
 * The previous migration (20251022000000) had a bug where it used .find()
 * to get "Admin" role without specifying msp=true. This caused it to
 * randomly assign permissions to either MSP Admin or Client Admin.
 *
 * Since service and storage are MSP-only features, they should be assigned
 * to MSP Admin roles (msp=true, client=false).
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  // Get all tenants
  const tenants = await knex('tenants').select('tenant');
  if (!tenants.length) return;

  let totalPermissionsAdded = 0;

  for (const { tenant } of tenants) {
    // Get MSP Admin role for this tenant (msp=true, client=false)
    const mspAdminRole = await knex('roles')
      .where({
        tenant,
        msp: true,
        client: false
      })
      .whereRaw("LOWER(role_name) = 'admin'")
      .first();

    if (!mspAdminRole) {
      console.log(`No MSP Admin role found for tenant ${tenant}, skipping`);
      continue;
    }

    // Get all service and storage permissions for this tenant
    const serviceAndStoragePerms = await knex('permissions')
      .where({
        tenant,
        msp: true  // Only MSP permissions
      })
      .whereIn('resource', ['service', 'storage'])
      .select('permission_id');

    if (serviceAndStoragePerms.length === 0) {
      console.log(`No service/storage permissions found for tenant ${tenant}, skipping`);
      continue;
    }

    // Get existing role permissions for MSP Admin
    const existingRolePerms = await knex('role_permissions')
      .where({
        tenant,
        role_id: mspAdminRole.role_id
      })
      .select('permission_id');

    const existingRolePermIds = new Set(existingRolePerms.map(rp => rp.permission_id));

    // Add missing permissions to MSP Admin role
    const rolePermissionsToAdd = serviceAndStoragePerms
      .filter(p => !existingRolePermIds.has(p.permission_id))
      .map(p => ({
        tenant,
        role_id: mspAdminRole.role_id,
        permission_id: p.permission_id
      }));

    if (rolePermissionsToAdd.length > 0) {
      await knex('role_permissions').insert(rolePermissionsToAdd);
      totalPermissionsAdded += rolePermissionsToAdd.length;
      console.log(`Added ${rolePermissionsToAdd.length} service/storage permissions to MSP Admin role for tenant ${tenant}`);
    }
  }

  console.log(`Migration complete: Added ${totalPermissionsAdded} total permission assignments across all tenants`);
};

/**
 * Rollback: Remove service and storage permissions from MSP Admin roles
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  // Get all tenants
  const tenants = await knex('tenants').select('tenant');
  if (!tenants.length) return;

  for (const { tenant } of tenants) {
    // Get MSP Admin role
    const mspAdminRole = await knex('roles')
      .where({
        tenant,
        msp: true,
        client: false
      })
      .whereRaw("LOWER(role_name) = 'admin'")
      .first();

    if (!mspAdminRole) continue;

    // Remove service and storage permissions from MSP Admin
    await knex('role_permissions')
      .where({
        tenant,
        role_id: mspAdminRole.role_id
      })
      .whereIn('permission_id', function() {
        this.select('permission_id')
          .from('permissions')
          .where({ tenant })
          .whereIn('resource', ['service', 'storage']);
      })
      .delete();
  }
};
