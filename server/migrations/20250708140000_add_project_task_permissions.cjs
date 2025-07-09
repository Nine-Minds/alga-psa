/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  // Helper function to create a permission if it doesn't exist
  const ensurePermission = async (tenant, resource, action, msp = true, client = false, description = null) => {
    const existing = await knex('permissions')
      .where({ tenant, resource, action })
      .first();
    
    if (!existing) {
      const [permission] = await knex('permissions')
        .insert({
          tenant,
          resource,
          action,
          msp,
          client,
          description,
          permission_id: knex.raw('gen_random_uuid()'),
          created_at: knex.fn.now()
        })
        .returning('*');
      return permission;
    }
    
    // Update existing permission with msp/client flags and description
    await knex('permissions')
      .where({ tenant, resource, action })
      .update({ msp, client, description });
    
    return existing;
  };

  // Helper function to assign permission to role
  const assignPermissionToRole = async (tenant, roleId, permissionId) => {
    const existing = await knex('role_permissions')
      .where({ tenant, role_id: roleId, permission_id: permissionId })
      .first();
    
    if (!existing) {
      await knex('role_permissions').insert({
        tenant,
        role_id: roleId,
        permission_id: permissionId,
        created_at: knex.fn.now()
      });
    }
  };

  // Get all tenants
  const tenants = await knex('tenants').select('tenant');

  for (const { tenant } of tenants) {
    console.log(`Processing tenant: ${tenant} - Adding project_task permissions`);

    // Define project_task permissions (similar to project permissions)
    const projectTaskPermissions = [
      { action: 'create', description: 'Create new project tasks' },
      { action: 'read', description: 'View project task details' },
      { action: 'update', description: 'Modify project task information' },
      { action: 'delete', description: 'Delete project tasks' }
    ];

    const permissionMap = new Map();
    
    // Create permissions for MSP portal
    for (const perm of projectTaskPermissions) {
      const permission = await ensurePermission(
        tenant,
        'project_task',
        perm.action,
        true,  // MSP
        false, // Client - project tasks are MSP only like projects
        perm.description
      );
      permissionMap.set(perm.action, permission.permission_id);
    }

    // Find all roles that have project permissions and grant them project_task permissions too
    const rolesWithProjectPerms = await knex('role_permissions as rp')
      .join('permissions as p', 'rp.permission_id', 'p.permission_id')
      .where('p.tenant', tenant)
      .where('p.resource', 'project')
      .select('rp.role_id', 'p.action')
      .distinct();

    console.log(`Found ${rolesWithProjectPerms.length} role-permission combinations for projects`);

    // Grant corresponding project_task permissions
    for (const rolePerm of rolesWithProjectPerms) {
      const permissionId = permissionMap.get(rolePerm.action);
      if (permissionId) {
        await assignPermissionToRole(tenant, rolePerm.role_id, permissionId);
        console.log(`Granted project_task:${rolePerm.action} to role ${rolePerm.role_id}`);
      }
    }

    // Also create read permission for client portal (like projects)
    const clientReadPermission = await ensurePermission(
      tenant,
      'project_task',
      'read',
      true,  // MSP can read
      true,  // Client can also read
      'View project task details'
    );
    
    // Update the permission map with the client-enabled read permission
    permissionMap.set('read', clientReadPermission.permission_id);
    
    // Find client roles that have project:read permission and grant them project_task:read
    const clientRolesWithProjectRead = await knex('role_permissions as rp')
      .join('permissions as p', 'rp.permission_id', 'p.permission_id')
      .join('roles as r', 'rp.role_id', 'r.role_id')
      .where('p.tenant', tenant)
      .where('p.resource', 'project')
      .where('p.action', 'read')
      .where('r.client', true)
      .select('r.role_id', 'r.role_name')
      .distinct();

    for (const role of clientRolesWithProjectRead) {
      await assignPermissionToRole(tenant, role.role_id, clientReadPermission.permission_id);
      console.log(`Granted project_task:read to client role ${role.role_name}`);
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

  for (const { tenant } of tenants) {
    // Find project_task permissions
    const permissions = await knex('permissions')
      .where({ tenant, resource: 'project_task' })
      .select('permission_id');

    const permissionIds = permissions.map(p => p.permission_id);

    if (permissionIds.length > 0) {
      // Remove role assignments
      await knex('role_permissions')
        .where('tenant', tenant)
        .whereIn('permission_id', permissionIds)
        .delete();

      // Remove permissions
      await knex('permissions')
        .where('tenant', tenant)
        .whereIn('permission_id', permissionIds)
        .delete();

      console.log(`Removed ${permissionIds.length} project_task permissions for tenant ${tenant}`);
    }
  }
};