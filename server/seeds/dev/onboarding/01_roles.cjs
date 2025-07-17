exports.seed = async function (knex) {
    // Get the tenant ID from environment or use the first tenant
    let tenantId;
    if (process.env.TENANT_ID) {
        tenantId = process.env.TENANT_ID;
    } else {
        const tenant = await knex('tenants').select('tenant').first();
        if (!tenant) {
            console.log('No tenant found, skipping roles seed');
            return;
        }
        tenantId = tenant.tenant;
    }

    // Don't delete existing roles, just add missing ones
    const existingRoles = await knex('roles').where({ tenant: tenantId });
    const existingRoleNames = new Set(existingRoles.map(r => `${r.role_name}-${r.msp}-${r.client}`));

    const rolesToInsert = [
        // MSP Roles (based on permissions_list.md)
        { tenant: tenantId, role_name: 'Admin', description: 'Full system administrator access', msp: true, client: false },
        { tenant: tenantId, role_name: 'Finance', description: 'Financial operations and billing management', msp: true, client: false },
        { tenant: tenantId, role_name: 'Technician', description: 'Technical support and service delivery', msp: true, client: false },
        { tenant: tenantId, role_name: 'Project Manager', description: 'Project oversight and team coordination', msp: true, client: false },
        { tenant: tenantId, role_name: 'Dispatcher', description: 'Scheduling and dispatch operations', msp: true, client: false },
        
        // Client Portal Roles (based on permissions_list.md)
        { tenant: tenantId, role_name: 'Admin', description: 'Client portal administrator', msp: false, client: true },
        { tenant: tenantId, role_name: 'Finance', description: 'Client billing and financial visibility', msp: false, client: true },
        { tenant: tenantId, role_name: 'User', description: 'Standard client portal user', msp: false, client: true }
    ].filter(role => !existingRoleNames.has(`${role.role_name}-${role.msp}-${role.client}`));

    if (rolesToInsert.length > 0) {
        await knex('roles').insert(rolesToInsert);
        console.log(`Inserted ${rolesToInsert.length} roles for tenant ${tenantId}`);
    } else {
        console.log(`All roles already exist for tenant ${tenantId}`);
    }
};