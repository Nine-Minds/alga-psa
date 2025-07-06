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
        permissionMap.set(`${p.resource}:${p.action}`, p.permission_id);
    });
    
    for (const role of roles) {
        let rolePermissionIds = [];
        
        // MSP Admin - Full access to all MSP permissions
        if (role.role_name === 'Admin' && role.msp === true) {
            rolePermissionIds = permissions
                .filter(p => p.msp === true)
                .map(p => p.permission_id);
        }
        
        // MSP Finance - Specific financial permissions
        else if (role.role_name === 'Finance' && role.msp === true) {
            const financePermissions = [
                'asset:read',
                'billing:create', 'billing:read', 'billing:update', 'billing:delete', 'billing:reconcile',
                'client:create', 'client:read', 'client:update', 'client:delete',
                'contact:create', 'contact:read', 'contact:update', 'contact:delete',
                'credit:create', 'credit:read', 'credit:update', 'credit:delete', 'credit:transfer', 'credit:apply',
                'document:create', 'document:read', 'document:update', 'document:delete',
                'invoice:create', 'invoice:read', 'invoice:update', 'invoice:delete', 'invoice:generate', 'invoice:finalize',
                'profile:create', 'profile:read', 'profile:update', 'profile:delete',
                'project:read', 'project:update',
                'tag:create', 'tag:read',
                'technician_dispatch:read',
                'ticket:read', 'ticket:update',
                'timeentry:create', 'timeentry:read', 'timeentry:update', 'timeentry:delete',
                'timesheet:create', 'timesheet:read', 'timesheet:update', 'timesheet:delete', 'timesheet:submit',
                'user:read',
                'user_schedule:read',
                'billing_settings:create', 'billing_settings:read', 'billing_settings:update', 'billing_settings:delete'
            ];
            
            rolePermissionIds = financePermissions
                .map(key => permissionMap.get(key))
                .filter(id => id !== undefined);
        }
        
        // MSP Technician - Technical support focused
        else if (role.role_name === 'Technician' && role.msp === true) {
            const technicianPermissions = [
                'asset:read',
                'contact:read',
                'document:create', 'document:read', 'document:update',
                'profile:read', 'profile:update',
                'project:read',
                'tag:read',
                'ticket:create', 'ticket:read', 'ticket:update',
                'timeentry:create', 'timeentry:read', 'timeentry:update',
                'timesheet:create', 'timesheet:read', 'timesheet:update', 'timesheet:submit',
                'user:read',
                'user_schedule:read',
                'user_settings:read', 'user_settings:update',
                'category:read',
                'priority:read',
                'comment:create', 'comment:read', 'comment:update'
            ];
            
            rolePermissionIds = technicianPermissions
                .map(key => permissionMap.get(key))
                .filter(id => id !== undefined);
        }
        
        // MSP Project Manager - Project oversight
        else if (role.role_name === 'Project Manager' && role.msp === true) {
            const projectManagerPermissions = [
                'asset:read',
                'client:read',
                'contact:create', 'contact:read', 'contact:update',
                'document:create', 'document:read', 'document:update', 'document:delete',
                'invoice:read',
                'profile:read',
                'project:create', 'project:read', 'project:update', 'project:delete',
                'tag:create', 'tag:read', 'tag:update',
                'technician_dispatch:read',
                'ticket:create', 'ticket:read', 'ticket:update',
                'timeentry:read',
                'timesheet:read', 'timesheet:approve',
                'user:read',
                'user_schedule:read',
                'team:create', 'team:read', 'team:update', 'team:manage',
                'comment:create', 'comment:read', 'comment:update',
                'category:read',
                'priority:read'
            ];
            
            rolePermissionIds = projectManagerPermissions
                .map(key => permissionMap.get(key))
                .filter(id => id !== undefined);
        }
        
        // MSP Dispatcher - Scheduling and dispatch
        else if (role.role_name === 'Dispatcher' && role.msp === true) {
            const dispatcherPermissions = [
                'contact:read',
                'profile:read',
                'technician_dispatch:create', 'technician_dispatch:read', 'technician_dispatch:update', 'technician_dispatch:delete',
                'ticket:read', 'ticket:update',
                'user:read',
                'user_schedule:create', 'user_schedule:read', 'user_schedule:update', 'user_schedule:delete'
            ];
            
            rolePermissionIds = dispatcherPermissions
                .map(key => permissionMap.get(key))
                .filter(id => id !== undefined);
        }
        
        // MSP Manager - Legacy role support
        else if (role.role_name === 'Manager' && role.msp === true) {
            const managerPermissions = [
                'ticket:create', 'ticket:read', 'ticket:update', 'ticket:delete',
                'user:create', 'user:read', 'user:update',
                'project:create', 'project:read', 'project:update', 'project:delete',
                'company:read',
                'team:create', 'team:read', 'team:update', 'team:manage',
                'timeentry:read', 'timeentry:update',
                'timesheet:read', 'timesheet:approve',
                'contact:create', 'contact:read', 'contact:update',
                'document:create', 'document:read', 'document:update',
                'asset:read',
                'category:read',
                'priority:read',
                'notification:create', 'notification:read', 'notification:update',
                'comment:create', 'comment:read', 'comment:update',
                'service:read',
                'tag:create', 'tag:read', 'tag:update',
                'user_schedule:read', 'user_schedule:update',
                'registration:approve'
            ];
            
            rolePermissionIds = managerPermissions
                .map(key => permissionMap.get(key))
                .filter(id => id !== undefined);
        }
        
        // Client Admin - Full access to client permissions
        else if (role.role_name === 'Admin' && role.client === true) {
            rolePermissionIds = permissions
                .filter(p => p.client === true)
                .map(p => p.permission_id);
        }
        
        // Client Finance - Financial visibility
        else if (role.role_name === 'Finance' && role.client === true) {
            const clientFinancePermissions = [
                'billing:read',
                'client:read',
                'contact:read',
                'credit:read',
                'document:read',
                'invoice:read',
                'profile:read',
                'user_settings:read', 'user_settings:update'
            ];
            
            rolePermissionIds = clientFinancePermissions
                .map(key => permissionMap.get(key))
                .filter(id => id !== undefined);
        }
        
        // Client User - Basic client access
        else if (role.role_name === 'User' && role.client === true) {
            const clientUserPermissions = [
                'asset:read',
                'contact:create', 'contact:read', 'contact:update',
                'document:create', 'document:read',
                'profile:read', 'profile:update',
                'project:read',
                'tag:read',
                'ticket:create', 'ticket:read', 'ticket:update',
                'user_settings:read', 'user_settings:update',
                'user:read',
                'comment:create', 'comment:read', 'comment:update',
                'category:read',
                'priority:read',
                'notification:read', 'notification:update'
            ];
            
            rolePermissionIds = clientUserPermissions
                .map(key => permissionMap.get(key))
                .filter(id => id !== undefined);
        }
        
        if (rolePermissionIds.length > 0) {
            // Get existing role permissions to avoid duplicates
            const existingRolePerms = await knex('role_permissions')
                .where({
                    tenant: tenant.tenant,
                    role_id: role.role_id
                })
                .select('permission_id');

            const existingPermIds = new Set(existingRolePerms.map(rp => rp.permission_id));

            // Filter out existing permissions
            const rolePermissionsToAdd = rolePermissionIds
                .filter(permId => !existingPermIds.has(permId))
                .map(permId => ({
                    tenant: tenant.tenant,
                    role_id: role.role_id,
                    permission_id: permId
                }));

            if (rolePermissionsToAdd.length > 0) {
                await knex('role_permissions').insert(rolePermissionsToAdd);
                console.log(`Added ${rolePermissionsToAdd.length} permissions to ${role.role_name} role (${role.msp ? 'MSP' : 'Client'}) for tenant ${tenant.tenant}`);
            } else {
                console.log(`${role.role_name} role (${role.msp ? 'MSP' : 'Client'}) already has all permissions`);
            }
        }
    }
};