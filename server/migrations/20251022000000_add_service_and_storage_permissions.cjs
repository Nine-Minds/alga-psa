/**
 * Add service and storage permissions to existing tenants
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  // Get all tenants
  const tenants = await knex('tenants').select('tenant');
  if (!tenants.length) return;

  // Define the permissions to add
  const newPermissions = [
    // Service permissions
    { resource: 'service', action: 'create', msp: true, client: false, description: 'Create services' },
    { resource: 'service', action: 'read', msp: true, client: false, description: 'View services' },
    { resource: 'service', action: 'update', msp: true, client: false, description: 'Update services' },
    { resource: 'service', action: 'delete', msp: true, client: false, description: 'Delete services' },

    // Storage permissions
    { resource: 'storage', action: 'read', msp: true, client: false, description: 'Read storage' },
    { resource: 'storage', action: 'write', msp: true, client: false, description: 'Write storage' },
  ];

  // For each tenant, add the permissions
  for (const { tenant } of tenants) {
    // Get existing permissions to avoid duplicates
    const existingPerms = await knex('permissions')
      .where({ tenant })
      .select('resource', 'action');

    const existingMap = new Set(existingPerms.map(p => `${p.resource}:${p.action}`));

    const permissionsToAdd = newPermissions
      .filter(p => !existingMap.has(`${p.resource}:${p.action}`))
      .map(p => ({
        tenant,
        permission_id: knex.raw('gen_random_uuid()'),
        ...p,
        created_at: new Date()
      }));

    if (permissionsToAdd.length > 0) {
      await knex('permissions').insert(permissionsToAdd);
      console.log(`Added ${permissionsToAdd.length} new permissions for tenant ${tenant}`);
    }

    // Get Admin role for this tenant (case-insensitive)
    const roles = await knex('roles').where({ tenant });
    const adminRole = roles.find(r =>
      r.role_name && r.role_name.toLowerCase() === 'admin'
    );

    if (adminRole) {
      // Get all service and storage permissions for this tenant
      const serviceAndStoragePerms = await knex('permissions')
        .where({ tenant })
        .whereIn('resource', ['service', 'storage'])
        .select('permission_id');

      // Get existing role permissions for admin
      const existingRolePerms = await knex('role_permissions')
        .where({
          tenant,
          role_id: adminRole.role_id
        })
        .select('permission_id');

      const existingRolePermIds = new Set(existingRolePerms.map(rp => rp.permission_id));

      // Add missing permissions to admin role
      const rolePermissionsToAdd = serviceAndStoragePerms
        .filter(p => !existingRolePermIds.has(p.permission_id))
        .map(p => ({
          tenant,
          role_id: adminRole.role_id,
          permission_id: p.permission_id
        }));

      if (rolePermissionsToAdd.length > 0) {
        await knex('role_permissions').insert(rolePermissionsToAdd);
        console.log(`Added ${rolePermissionsToAdd.length} role permissions to Admin role for tenant ${tenant}`);
      }
    }
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  // Get all tenants
  const tenants = await knex('tenants').select('tenant');
  if (!tenants.length) return;

  for (const { tenant } of tenants) {
    // Remove role permissions first (foreign key constraint)
    await knex('role_permissions')
      .where('tenant', tenant)
      .whereIn('permission_id', function() {
        this.select('permission_id')
          .from('permissions')
          .where('tenant', tenant)
          .whereIn('resource', ['service', 'storage']);
      })
      .delete();

    // Remove permissions
    await knex('permissions')
      .where('tenant', tenant)
      .whereIn('resource', ['service', 'storage'])
      .delete();
  }
};
