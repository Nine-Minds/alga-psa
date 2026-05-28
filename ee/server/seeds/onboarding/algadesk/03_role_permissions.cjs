exports.seed = async function (knex, tenantId) {
    let tenants;
    if (tenantId) {
        tenants = [{ tenant: tenantId }];
    } else {
        tenants = await knex('tenants').where({ product_code: 'algadesk' }).select('tenant');
        if (!tenants.length) {
            console.log('No Algadesk tenants found, skipping role permissions seed');
            return;
        }
    }

    for (const { tenant } of tenants) {
        const roles = await knex('roles').where({ tenant });
        const permissions = await knex('permissions').where({ tenant });

        const permissionMap = new Map();
        permissions.forEach(p => {
            const key = `${p.resource}:${p.action}:${p.msp ? 'msp' : 'client'}`;
            permissionMap.set(key, p.permission_id);
        });

        await knex('role_permissions').where({ tenant }).del();
        console.log(`Cleared existing Algadesk role permissions for tenant ${tenant}`);

        for (const role of roles) {
            let rolePermissionIds = [];

            if (role.role_name === 'Admin' && role.msp === true) {
                rolePermissionIds = permissions
                    .filter(p => p.msp === true)
                    .map(p => p.permission_id);
            } else if (role.role_name === 'Agent' && role.msp === true) {
                const agentPermissions = [
                    'client:read:msp',
                    'contact:read:msp',
                    'document:create:msp', 'document:read:msp', 'document:update:msp',
                    'profile:read:msp', 'profile:update:msp',
                    'reports:read:msp',
                    'tag:create:msp', 'tag:read:msp', 'tag:update:msp',
                    'ticket:create:msp', 'ticket:read:msp', 'ticket:update:msp',
                    'ticket_settings:read:msp',
                    'user:read:msp',
                    'user_settings:read:msp'
                ];
                rolePermissionIds = agentPermissions
                    .map(key => permissionMap.get(key))
                    .filter(id => id !== undefined);
            } else if (role.role_name === 'Admin' && role.client === true) {
                const clientAdminPermissions = [
                    'client:read:client', 'client:update:client',
                    'contact:read:client', 'contact:update:client',
                    'document:create:client', 'document:read:client', 'document:update:client',
                    'settings:read:client', 'settings:update:client',
                    'ticket:create:client', 'ticket:read:client', 'ticket:update:client', 'ticket:delete:client',
                    'user:create:client', 'user:read:client', 'user:update:client', 'user:delete:client', 'user:reset_password:client'
                ];
                rolePermissionIds = clientAdminPermissions
                    .map(key => permissionMap.get(key))
                    .filter(id => id !== undefined);
            } else if (role.role_name === 'User' && role.client === true) {
                const clientUserPermissions = [
                    'client:read:client',
                    'contact:read:client',
                    'document:create:client', 'document:read:client', 'document:update:client',
                    'ticket:create:client', 'ticket:read:client', 'ticket:update:client'
                ];
                rolePermissionIds = clientUserPermissions
                    .map(key => permissionMap.get(key))
                    .filter(id => id !== undefined);
            }

            if (rolePermissionIds.length > 0) {
                const rolePermissionsToAdd = rolePermissionIds.map(permissionId => ({
                    tenant,
                    role_id: role.role_id,
                    permission_id: permissionId
                }));

                await knex('role_permissions').insert(rolePermissionsToAdd);
                console.log(`Added ${rolePermissionsToAdd.length} permissions to ${role.role_name} role (${role.msp ? 'MSP' : 'Client'}) for tenant ${tenant}`);
            } else {
                console.log(`No Algadesk permissions found for ${role.role_name} role (${role.msp ? 'MSP' : 'Client'}) for tenant ${tenant}`);
            }
        }
    }
};
