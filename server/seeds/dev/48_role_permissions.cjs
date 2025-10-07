exports.seed = async function (knex) {
    // Get the tenant ID
    const tenant = await knex('tenants').select('tenant').first();
    if (!tenant) return;

    console.log(`Seeding role permissions for tenant ${tenant.tenant}`);

    // Get all roles for this tenant
    const roles = await knex('roles').where({ tenant: tenant.tenant });
    
    // Get all permissions for this tenant
    const permissions = await knex('permissions').where({ tenant: tenant.tenant });
    
    // Create permission map for easy lookup
    const permissionMap = new Map();
    permissions.forEach(p => {
        if (p.msp) {
            permissionMap.set(`${p.resource}:${p.action}:msp`, p.permission_id);
        }
        if (p.client) {
            permissionMap.set(`${p.resource}:${p.action}:client`, p.permission_id);
        }
    });
    
    // Clear existing role permissions
    await knex('role_permissions').where({ tenant: tenant.tenant }).del();
    console.log('Cleared existing role permissions');
    
    for (const role of roles) {
        let rolePermissionIds = [];
        
        // MSP Admin - Full access to all MSP permissions
        if (role.role_name === 'Admin' && role.msp === true) {
            rolePermissionIds = permissions
                .filter(p => p.msp === true)
                .map(p => p.permission_id);
        }
        
        // MSP Finance - Based on permissions_list.md
        else if (role.role_name === 'Finance' && role.msp === true) {
            const financePermissions = [
                'asset:read:msp',
                'billing:create:msp', 'billing:read:msp', 'billing:update:msp', 'billing:delete:msp',
                'client:create:msp', 'client:read:msp', 'client:update:msp', 'client:delete:msp',
                'contact:create:msp', 'contact:read:msp', 'contact:update:msp', 'contact:delete:msp',
                'credit:create:msp', 'credit:read:msp', 'credit:update:msp', 'credit:delete:msp', 'credit:transfer:msp', 'credit:reconcile:msp',
                'document:create:msp', 'document:read:msp', 'document:update:msp', 'document:delete:msp',
                'invoice:create:msp', 'invoice:read:msp', 'invoice:update:msp', 'invoice:delete:msp', 'invoice:generate:msp', 'invoice:finalize:msp', 'invoice:send:msp', 'invoice:void:msp',
                'profile:create:msp', 'profile:read:msp', 'profile:update:msp',
                'project:read:msp', 'project:update:msp',
                'project_task:read:msp', 'project_task:update:msp',
                'tag:create:msp', 'tag:read:msp',
                'technician_dispatch:read:msp',
                'ticket:read:msp', 'ticket:update:msp',
                'timeentry:create:msp', 'timeentry:read:msp', 'timeentry:update:msp', 'timeentry:delete:msp',
                'timesheet:read:msp', 'timesheet:read_all:msp', 'timesheet:submit:msp',
                'user:read:msp',
                'user_schedule:read:msp',
                'billing_settings:create:msp', 'billing_settings:read:msp', 'billing_settings:update:msp', 'billing_settings:delete:msp'
            ];
            
            rolePermissionIds = financePermissions
                .map(key => permissionMap.get(key))
                .filter(id => id !== undefined);
        }
        
        // MSP Technician - Based on permissions_list.md
        else if (role.role_name === 'Technician' && role.msp === true) {
            const technicianPermissions = [
                'asset:create:msp', 'asset:read:msp', 'asset:update:msp',
                'client:read:msp', 'client:delete:msp',
                'contact:read:msp', 'contact:delete:msp',
                'document:create:msp', 'document:read:msp', 'document:update:msp',
                'profile:read:msp', 'profile:update:msp',
                'project:read:msp',
                'project_task:create:msp', 'project_task:read:msp', 'project_task:update:msp',
                'tag:create:msp', 'tag:read:msp', 'tag:update:msp',
                'technician_dispatch:read:msp',
                'ticket:create:msp', 'ticket:read:msp', 'ticket:update:msp',
                'timeentry:create:msp', 'timeentry:read:msp', 'timeentry:update:msp',
                'timesheet:read:msp', 'timesheet:update:msp', 'timesheet:read_all:msp', 'timesheet:submit:msp',
                'user_schedule:read:msp',
                'ticket_settings:read:msp'
            ];
            
            rolePermissionIds = technicianPermissions
                .map(key => permissionMap.get(key))
                .filter(id => id !== undefined);
        }
        
        // MSP Project Manager - Based on permissions_list.md
        else if (role.role_name === 'Project Manager' && role.msp === true) {
            const projectManagerPermissions = [
                'asset:read:msp',
                'billing:read:msp',
                'client:create:msp', 'client:read:msp', 'client:update:msp',
                'contact:create:msp', 'contact:read:msp', 'contact:update:msp',
                'document:create:msp', 'document:read:msp', 'document:update:msp',
                'invoice:read:msp',
                'profile:read:msp', 'profile:update:msp',
                'project:create:msp', 'project:read:msp', 'project:update:msp', 'project:delete:msp',
                'project_task:create:msp', 'project_task:read:msp', 'project_task:update:msp', 'project_task:delete:msp',
                'tag:create:msp', 'tag:read:msp', 'tag:update:msp',
                'technician_dispatch:read:msp',
                'ticket:create:msp', 'ticket:read:msp', 'ticket:update:msp',
                'timeentry:create:msp', 'timeentry:read:msp', 'timeentry:update:msp',
                'timesheet:read:msp', 'timesheet:update:msp', 'timesheet:read_all:msp', 'timesheet:submit:msp', 'timesheet:approve:msp', 'timesheet:reverse:msp',
                'user:read:msp', 'user:invite:msp',
                'user_schedule:read:msp',
                'user_settings:read:msp',
                'billing_settings:read:msp'
            ];
            
            rolePermissionIds = projectManagerPermissions
                .map(key => permissionMap.get(key))
                .filter(id => id !== undefined);
        }
        
        // MSP Dispatcher - Based on permissions_list.md
        else if (role.role_name === 'Dispatcher' && role.msp === true) {
            const dispatcherPermissions = [
                'asset:read:msp',
                'client:read:msp',
                'contact:read:msp',
                'document:read:msp',
                'profile:read:msp',
                'project:read:msp',
                'project_task:read:msp',
                'tag:create:msp', 'tag:read:msp', 'tag:update:msp',
                'technician_dispatch:create:msp', 'technician_dispatch:read:msp', 'technician_dispatch:update:msp',
                'ticket:create:msp', 'ticket:read:msp', 'ticket:update:msp',
                'timeentry:read:msp',
                'timesheet:read:msp',
                'user:read:msp',
                'user_schedule:create:msp', 'user_schedule:read:msp', 'user_schedule:update:msp',
                'user_settings:read:msp'
            ];
            
            rolePermissionIds = dispatcherPermissions
                .map(key => permissionMap.get(key))
                .filter(id => id !== undefined);
        }
        
        // Client Admin - Based on permissions_list.md
        else if (role.role_name === 'Admin' && role.client === true) {
            const clientAdminPermissions = [
                'billing:create:client', 'billing:read:client', 'billing:update:client',
                'client:create:client', 'client:read:client', 'client:update:client', 'client:delete:client',
                'project:create:client', 'project:read:client', 'project:update:client', 'project:delete:client',
                'ticket:create:client', 'ticket:read:client', 'ticket:update:client',
                'time_management:create:client', 'time_management:read:client', 'time_management:update:client', 'time_management:delete:client',
                'user:create:client', 'user:read:client', 'user:update:client', 'user:delete:client', 'user:reset_password:client',
                'settings:create:client', 'settings:read:client', 'settings:update:client', 'settings:delete:client',
                'document:create:client', 'document:read:client', 'document:update:client'
            ];
            
            rolePermissionIds = clientAdminPermissions
                .map(key => permissionMap.get(key))
                .filter(id => id !== undefined);
        }
        
        // Client Finance - Based on permissions_list.md
        else if (role.role_name === 'Finance' && role.client === true) {
            const clientFinancePermissions = [
                'billing:read:client',
                'client:create:client', 'client:read:client', 'client:update:client',
                'project:read:client',
                'ticket:create:client', 'ticket:read:client', 'ticket:update:client',
                'time_management:read:client',
                'user:read:client',
                'settings:read:client',
                'document:create:client', 'document:read:client', 'document:update:client'
            ];
            
            rolePermissionIds = clientFinancePermissions
                .map(key => permissionMap.get(key))
                .filter(id => id !== undefined);
        }
        
        // Client User - Based on permissions_list.md
        else if (role.role_name === 'User' && role.client === true) {
            const clientUserPermissions = [
                'client:create:client', 'client:read:client', 'client:update:client',
                'project:read:client',
                'ticket:create:client', 'ticket:read:client', 'ticket:update:client',
                'time_management:read:client',
                'document:create:client', 'document:read:client', 'document:update:client'
            ];
            
            rolePermissionIds = clientUserPermissions
                .map(key => permissionMap.get(key))
                .filter(id => id !== undefined);
        }
        
        if (rolePermissionIds.length > 0) {
            // Insert role permissions
            const rolePermissionsToAdd = rolePermissionIds.map(permId => ({
                tenant: tenant.tenant,
                role_id: role.role_id,
                permission_id: permId
            }));

            await knex('role_permissions').insert(rolePermissionsToAdd);
            console.log(`Added ${rolePermissionsToAdd.length} permissions to ${role.role_name} role (${role.msp ? 'MSP' : 'Client'}) for tenant ${tenant.tenant}`);
        } else {
            console.log(`No permissions found for ${role.role_name} role (${role.msp ? 'MSP' : 'Client'})`);
        }
    }
};
