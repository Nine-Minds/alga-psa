exports.seed = async function (knex, tenantId) {
    let tenants;
    if (tenantId) {
        tenants = [{ tenant: tenantId }];
    } else {
        tenants = await knex('tenants').where({ product_code: 'algadesk' }).select('tenant');
        if (!tenants.length) {
            console.log('No Algadesk tenants found, skipping roles seed');
            return;
        }
    }

    const roleDefinitions = [
        { role_name: 'Admin', description: 'Full Algadesk administrator access', msp: true, client: false },
        { role_name: 'Agent', description: 'Help desk agent access for tickets, clients, contacts, and documents', msp: true, client: false },
        // Keep client portal role names compatible with existing invitation/onboarding lookups.
        { role_name: 'Admin', description: 'Client portal administrator', msp: false, client: true },
        { role_name: 'User', description: 'Standard client portal user', msp: false, client: true }
    ];

    for (const { tenant } of tenants) {
        const existingRoles = await knex('roles').where({ tenant });
        const existingRoleNames = new Set(existingRoles.map(r => `${r.role_name}-${r.msp}-${r.client}`));
        const rolesToInsert = roleDefinitions
            .filter(role => !existingRoleNames.has(`${role.role_name}-${role.msp}-${role.client}`))
            .map(role => ({ tenant, ...role }));

        if (rolesToInsert.length > 0) {
            await knex('roles').insert(rolesToInsert);
            console.log(`Inserted ${rolesToInsert.length} Algadesk roles for tenant ${tenant}`);
        } else {
            console.log(`All Algadesk roles already exist for tenant ${tenant}`);
        }
    }
};
