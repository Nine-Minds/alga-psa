exports.up = async function(knex) {
  // Check if permissions table exists
  const hasPermissionsTable = await knex.schema.hasTable('permissions');
  if (!hasPermissionsTable) {
    console.log('permissions table does not exist yet, skipping permission creation');
    return;
  }

  // Define import/export permissions
  const permissions = [
    {
      resource: 'settings.import_export',
      action: 'read'
    },
    {
      resource: 'settings.import_export',
      action: 'manage'
    }
  ];

  // Get all tenants
  const tenants = await knex('tenants').select('tenant');

  // Insert permissions if they don't exist
  for (const tenant of tenants) {
    for (const perm of permissions) {
      const existing = await knex('permissions')
        .where({ resource: perm.resource, action: perm.action, tenant: tenant.tenant })
        .first();
      
      if (!existing) {
        await knex('permissions').insert({ ...perm, tenant: tenant.tenant });
        console.log(`✅ Added permission: ${perm.resource}.${perm.action} for tenant ${tenant.tenant}`);
      }
    }
  }

  // Grant these permissions to admin role
  const adminRole = await knex('roles')
    .where({ role_name: 'admin' })
    .first();

  if (adminRole) {
    for (const perm of permissions) {
      const permission = await knex('permissions')
        .where({ resource: perm.resource, action: perm.action })
        .first();
      
      if (permission) {
        const existingRolePerm = await knex('role_permissions')
          .where({
            role_id: adminRole.role_id,
            permission_id: permission.permission_id
          })
          .first();
        
        if (!existingRolePerm) {
          await knex('role_permissions').insert({
            role_id: adminRole.role_id,
            permission_id: permission.permission_id,
            created_at: new Date(),
            updated_at: new Date()
          });
          console.log(`✅ Granted ${perm.resource}.${perm.action} to admin role`);
        }
      }
    }
  }

  // Also grant to dispatcher role (read only)
  const dispatcherRole = await knex('roles')
    .where({ role_name: 'dispatcher' })
    .first();

  if (dispatcherRole) {
    const readPermission = await knex('permissions')
      .where({ resource: 'settings.import_export', action: 'read' })
      .first();
    
    if (readPermission) {
      const existingRolePerm = await knex('role_permissions')
        .where({
          role_id: dispatcherRole.role_id,
          permission_id: readPermission.permission_id
        })
        .first();
      
      if (!existingRolePerm) {
        await knex('role_permissions').insert({
          role_id: dispatcherRole.role_id,
          permission_id: readPermission.permission_id,
          created_at: new Date(),
          updated_at: new Date()
        });
        console.log(`✅ Granted settings.import_export.read to dispatcher role`);
      }
    }
  }
};

exports.down = async function(knex) {
  const hasPermissionsTable = await knex.schema.hasTable('permissions');
  if (!hasPermissionsTable) {
    return;
  }

  // Get permission IDs
  const permissions = await knex('permissions')
    .where({ resource: 'settings.import_export' })
    .whereIn('action', ['read', 'manage'])
    .pluck('permission_id');

  if (permissions.length > 0) {
    // Remove role permissions
    await knex('role_permissions')
      .whereIn('permission_id', permissions)
      .del();
    
    // Remove permissions
    await knex('permissions')
      .whereIn('permission_id', permissions)
      .del();
    
    console.log('Removed import/export permissions');
  }
};