/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  // Get all tenants
  const tenants = await knex('tenants').select('tenant');
  if (!tenants.length) return;

  // For each tenant, add the permissions and roles
  for (const { tenant } of tenants) {
    // Get existing permissions to avoid duplicates
    const existingPerms = await knex('permissions')
      .where({ tenant })
      .whereIn('resource', ['technician_dispatch', 'user_schedule'])
      .select('resource', 'action');

    const existingMap = new Set(existingPerms.map(p => `${p.resource}:${p.action}`));

    // Define new permissions using standard CRUD actions
    const permissionsToAdd = [
      { resource: 'technician_dispatch', action: 'create' },
      { resource: 'technician_dispatch', action: 'read' },
      { resource: 'technician_dispatch', action: 'update' },
      { resource: 'technician_dispatch', action: 'delete' },
      { resource: 'user_schedule', action: 'create' },
      { resource: 'user_schedule', action: 'read' },
      { resource: 'user_schedule', action: 'update' },
      { resource: 'user_schedule', action: 'delete' }
    ].filter(p => !existingMap.has(`${p.resource}:${p.action}`))
     .map(p => ({
       tenant,
       permission_id: knex.raw('gen_random_uuid()'),
       ...p
     }));

    if (permissionsToAdd.length > 0) {
      await knex('permissions').insert(permissionsToAdd);
    }

    // Create Dispatcher role if it doesn't exist
    let dispatcherRole = await knex('roles')
      .where({ tenant, role_name: 'Dispatcher' })
      .first();

    if (!dispatcherRole) {
      const [newRole] = await knex('roles')
        .insert({
          tenant,
          role_id: knex.raw('gen_random_uuid()'),
          role_name: 'Dispatcher',
          description: 'Role for users who can dispatch and schedule for other users'
        })
        .returning('*');
      
      dispatcherRole = newRole;
    }

    // Get Manager and Admin roles
    const managerRole = await knex('roles')
      .where({ tenant, role_name: 'Manager' })
      .first();

    const adminRole = await knex('roles')
      .where({ tenant, role_name: 'Admin' })
      .first();

    const technicianRole = await knex('roles')
      .where({ tenant, role_name: 'Technician' })
      .first();

    // Helper function to assign permissions idempotently
    const assignPermissionsToRole = async (role, permissions) => {
      if (!role || !permissions || permissions.length === 0) return;
      const inserts = [];
      for (const permission of permissions) {
        const existingRolePerm = await knex('role_permissions')
          .where({
            tenant,
            role_id: role.role_id,
            permission_id: permission.permission_id
          })
          .first();
        if (!existingRolePerm) {
          inserts.push({
            tenant,
            role_id: role.role_id,
            permission_id: permission.permission_id
          });
        }
      }
      if (inserts.length > 0) {
        await knex('role_permissions').insert(inserts);
      }
    };

    // Get all created/existing permissions for the resources
    const allPermissions = await knex('permissions')
      .where({ tenant })
      .whereIn('resource', ['technician_dispatch', 'user_schedule']);

    const permissionsMap = allPermissions.reduce((acc, p) => {
      acc[`${p.resource}:${p.action}`] = p;
      return acc;
    }, {});

    // Assign permissions based on role requirements
    const allCrudPerms = allPermissions; // Dispatcher, Manager, Admin gets all
    const readPerms = allPermissions.filter(p => p.action === 'read');

    await assignPermissionsToRole(dispatcherRole, allCrudPerms);
    await assignPermissionsToRole(managerRole, allCrudPerms);
    await assignPermissionsToRole(adminRole, allCrudPerms);
    await assignPermissionsToRole(technicianRole, readPerms);
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
    // Get permission IDs
    const permissions = await knex('permissions')
      .where({ tenant })
      .whereIn('resource', ['technician_dispatch', 'user_schedule']);

    if (permissions.length > 0) {
      const permissionIds = permissions.map(p => p.permission_id);

      // Get roles modified in the 'up' function
      const dispatcherRole = await knex('roles').where({ tenant, role_name: 'Dispatcher' }).first();
      const managerRole = await knex('roles').where({ tenant, role_name: 'Manager' }).first();
      const adminRole = await knex('roles').where({ tenant, role_name: 'Admin' }).first();
      const technicianRole = await knex('roles').where({ tenant, role_name: 'Technician' }).first();

      const roleIdsToClean = [
        dispatcherRole?.role_id,
        managerRole?.role_id,
        adminRole?.role_id,
        technicianRole?.role_id
      ].filter(Boolean);

      // Remove specific role permissions added by this migration
      if (roleIdsToClean.length > 0) {
        await knex('role_permissions')
          .where('tenant', tenant)
          .whereIn('role_id', roleIdsToClean)
          .whereIn('permission_id', permissionIds)
          .delete();
      }

      // Remove the permissions themselves
      await knex('permissions')
        .where('tenant', tenant)
        .whereIn('permission_id', permissionIds)
        .delete();
    }

    // Get dispatcher role (using correct case)
    const dispatcherRoleToDelete = await knex('roles')
      .where({ tenant, role_name: 'Dispatcher' })
      .first();

    if (dispatcherRoleToDelete) {
      // Check if the role has any *other* permissions remaining
      const otherPermissions = await knex('role_permissions')
        .where({ tenant, role_id: dispatcherRoleToDelete.role_id })
        .first(); // Check if *any* link exists

      // Only delete the role if it has no other permissions linked
      if (!otherPermissions) {
        await knex('roles')
          .where({ tenant, role_id: dispatcherRoleToDelete.role_id })
          .delete();
      } else {
        console.warn(`Dispatcher role (ID: ${dispatcherRoleToDelete.role_id}) in tenant ${tenant} still has other permissions assigned. Skipping role deletion.`);
      }
    }
  }
};
