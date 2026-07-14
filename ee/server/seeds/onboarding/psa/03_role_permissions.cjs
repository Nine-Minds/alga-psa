const { ALL_MSP, psa: roleGrants } = require('../lib/roleGrants.cjs');

exports.seed = async function (knex, tenantId) {
    const { tenantDb } = await import('@alga-psa/db');

    // Use provided tenantId or seed all tenants
    let tenants;
    if (tenantId) {
        tenants = [{ tenant: tenantId }];
    } else {
        tenants = await knex('tenants').select('tenant');
        if (!tenants.length) {
            console.log('No tenants found, skipping role permissions seed');
            return;
        }
    }

    // Process each tenant
    for (const { tenant } of tenants) {
        const db = tenantDb(knex, tenant);

        console.log(`Seeding role permissions for tenant ${tenant}`);

        // Get all roles for this tenant
        const roles = await db.table('roles');
        
        // Get all permissions for this tenant
        const permissions = await db.table('permissions');
        
        // Create permission map for easy lookup
        const permissionMap = new Map();
        permissions.forEach(p => {
            const key = `${p.resource}:${p.action}:${p.msp ? 'msp' : 'client'}`;
            permissionMap.set(key, p.permission_id);
        });
        
        // Clear existing role permissions
        await db.table('role_permissions').del();
        console.log('Cleared existing role permissions');
        
        for (const role of roles) {
            let grants;
            if (role.msp === true) {
                grants = roleGrants.msp[role.role_name];
            } else if (role.client === true) {
                grants = roleGrants.client[role.role_name];
            }

            let rolePermissionIds = [];
            if (grants === ALL_MSP) {
                rolePermissionIds = permissions
                    .filter(p => p.msp === true)
                    .map(p => p.permission_id);
            } else if (Array.isArray(grants)) {
                rolePermissionIds = grants
                    .map(key => permissionMap.get(key))
                    .filter(id => id !== undefined);
            }
            
            if (rolePermissionIds.length > 0) {
                // Insert role permissions
                const rolePermissionsToAdd = rolePermissionIds.map(permId => ({
                    tenant,
                    role_id: role.role_id,
                    permission_id: permId
                }));

                await db.table('role_permissions').insert(rolePermissionsToAdd);
                console.log(`Added ${rolePermissionsToAdd.length} permissions to ${role.role_name} role (${role.msp ? 'MSP' : 'Client'}) for tenant ${tenant}`);
            } else {
                console.log(`No permissions found for ${role.role_name} role (${role.msp ? 'MSP' : 'Client'})`);
            }
        }
    }
};
