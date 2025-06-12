exports.up = async function(knex) {
  console.log('Assigning import/export permissions to Admin role for all tenants...');
  
  // Get all tenants
  const tenants = await knex('tenants').select('tenant');
  
  for (const { tenant: tenant_id } of tenants) {
    // Get the Admin role for this tenant
    const adminRole = await knex('roles')
      .where({ 
        tenant: tenant_id, 
        role_name: 'Admin' 
      })
      .first();
    
    if (!adminRole) {
      console.log(`No Admin role found for tenant ${tenant_id}, skipping`);
      continue;
    }
    
    // Get the import/export permissions for this tenant
    const permissions = await knex('permissions')
      .where({
        tenant: tenant_id,
        resource: 'settings.import_export'
      })
      .select('permission_id', 'action');
    
    if (permissions.length === 0) {
      console.log(`No import/export permissions found for tenant ${tenant_id}, creating them`);
      
      // Create the permissions if they don't exist
      const newPermissions = [
        {
          tenant: tenant_id,
          resource: 'settings.import_export',
          action: 'read',
          created_at: new Date()
        },
        {
          tenant: tenant_id,
          resource: 'settings.import_export',
          action: 'manage',
          created_at: new Date()
        }
      ];
      
      await knex('permissions').insert(newPermissions);
      
      // Re-fetch the permissions
      const createdPermissions = await knex('permissions')
        .where({
          tenant: tenant_id,
          resource: 'settings.import_export'
        })
        .select('permission_id', 'action');
      
      permissions.push(...createdPermissions);
    }
    
    // Assign permissions to Admin role
    for (const permission of permissions) {
      // Check if already assigned
      const existing = await knex('role_permissions')
        .where({
          tenant: tenant_id,
          role_id: adminRole.role_id,
          permission_id: permission.permission_id
        })
        .first();
      
      if (!existing) {
        await knex('role_permissions').insert({
          tenant: tenant_id,
          role_id: adminRole.role_id,
          permission_id: permission.permission_id,
          created_at: new Date()
        });
        console.log(`✅ Assigned ${permission.action} permission to Admin role for tenant ${tenant_id}`);
      } else {
        console.log(`Permission ${permission.action} already assigned to Admin role for tenant ${tenant_id}`);
      }
    }
  }
  
  console.log('Completed assigning import/export permissions to Admin roles');
};

exports.down = async function(knex) {
  console.log('Removing import/export permissions from Admin roles...');
  
  // Get all tenants
  const tenants = await knex('tenants').select('tenant');
  
  for (const { tenant: tenant_id } of tenants) {
    // Get the Admin role for this tenant
    const adminRole = await knex('roles')
      .where({ 
        tenant: tenant_id, 
        role_name: 'Admin' 
      })
      .first();
    
    if (!adminRole) {
      continue;
    }
    
    // Get the import/export permissions for this tenant
    const permissions = await knex('permissions')
      .where({
        tenant: tenant_id,
        resource: 'settings.import_export'
      })
      .select('permission_id');
    
    const permissionIds = permissions.map(p => p.permission_id);
    
    if (permissionIds.length > 0) {
      // Remove the role permissions
      await knex('role_permissions')
        .where({
          tenant: tenant_id,
          role_id: adminRole.role_id
        })
        .whereIn('permission_id', permissionIds)
        .del();
      
      console.log(`Removed import/export permissions from Admin role for tenant ${tenant_id}`);
    }
  }
};