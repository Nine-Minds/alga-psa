const { getFirstTenantSeedContext } = require('./_tenant.cjs');

exports.seed = async function (knex) {
    const context = await getFirstTenantSeedContext(knex);
    if (!context) return;

    const { tenantId, db } = context;

    return db.table('roles').del()
        .then(() => {
            return db.table('roles').insert([
                // MSP Roles
                { tenant: tenantId, role_name: 'Admin', description: 'Full system administrator access', msp: true, client: false },
                { tenant: tenantId, role_name: 'Manager', description: 'Manage tickets and users', msp: true, client: false },
                { tenant: tenantId, role_name: 'Technician', description: 'Technical support and ticket management', msp: true, client: false },
                { tenant: tenantId, role_name: 'Finance', description: 'Financial operations and billing management', msp: true, client: false },
                { tenant: tenantId, role_name: 'Project Manager', description: 'Project planning and management', msp: true, client: false },
                { tenant: tenantId, role_name: 'Dispatcher', description: 'Technician scheduling and dispatch', msp: true, client: false },
                
                // Client Portal Roles
                { tenant: tenantId, role_name: 'Admin', description: 'Client portal administrator', msp: false, client: true },
                { tenant: tenantId, role_name: 'Finance', description: 'Client financial operations', msp: false, client: true },
                { tenant: tenantId, role_name: 'User', description: 'Standard client portal user', msp: false, client: true }
            ]);
        });
};
