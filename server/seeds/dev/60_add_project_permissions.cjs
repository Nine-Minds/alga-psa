exports.seed = async function(knex) {
    // Get the tenant ID
    const tenant = await knex('tenants').select('tenant').first();
    if (!tenant) return;

    // Deletes existing project permissions for this tenant
    await knex('permissions').where({ resource: 'project', tenant: tenant.tenant }).del();
    
    // Inserts seed entries
    await knex('permissions').insert([
      {
        tenant: tenant.tenant,
        resource: 'project',
        action: 'read'
      },
      {
        tenant: tenant.tenant,
        resource: 'project',
        action: 'create'
      },
      {
        tenant: tenant.tenant,
        resource: 'project',
        action: 'update'
      },
      {
        tenant: tenant.tenant,
        resource: 'project',
        action: 'delete'
      }
    ]);
  
    // Fetch all roles
    const roles = await knex('roles')
      .where('tenant', tenant.tenant)
      .select('role_id');
  
    // Fetch all project permissions
    const projectPermissions = await knex('permissions')
      .where({ resource: 'project', tenant: tenant.tenant })
      .select('permission_id');
  
    // Prepare role_permissions entries
    const rolePermissions = roles.flatMap(role => 
      projectPermissions.map(permission => ({
        tenant: tenant.tenant,
        role_id: role.role_id,
        permission_id: permission.permission_id
      }))
    );
  
    // Insert role_permissions
    await knex('role_permissions').insert(rolePermissions);
};