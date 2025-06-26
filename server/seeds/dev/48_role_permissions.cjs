exports.seed = async function (knex) {
    // Get the tenant ID
    const tenant = await knex('tenants').select('tenant').first();
    if (!tenant) return;

    console.log(`Seeding role permissions for tenant ${tenant.tenant}`);

    // Get all roles for this tenant
    const roles = await knex('roles').where({ tenant: tenant.tenant });
    
    for (const role of roles) {
        let rolePermissions = [];
        
        if (role.role_name.toLowerCase() === 'technician') {
            // Technician gets limited ticket permissions
            rolePermissions = await knex('permissions')
                .where({ tenant: tenant.tenant })
                .where('resource', 'ticket')
                .whereIn('action', ['read', 'update'])
                .select('permission_id');
        }
        // Note: Admin and Manager roles are handled by 47_permissions.cjs seed
        
        if (rolePermissions.length > 0) {
            // Get existing role permissions to avoid duplicates
            const existingRolePerms = await knex('role_permissions')
                .where({
                    tenant: tenant.tenant,
                    role_id: role.role_id
                })
                .select('permission_id');

            const existingPermIds = new Set(existingRolePerms.map(rp => rp.permission_id));

            // Filter out existing permissions
            const rolePermissionsToAdd = rolePermissions
                .filter(p => !existingPermIds.has(p.permission_id))
                .map(p => ({
                    tenant: tenant.tenant,
                    role_id: role.role_id,
                    permission_id: p.permission_id
                }));

            if (rolePermissionsToAdd.length > 0) {
                await knex('role_permissions').insert(rolePermissionsToAdd);
                console.log(`Added ${rolePermissionsToAdd.length} permissions to ${role.role_name} role for tenant ${tenant.tenant}`);
            }
        }
    }
};