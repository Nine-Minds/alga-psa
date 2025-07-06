exports.seed = function (knex) {
    return knex('roles').del()
        .then(() => {
            return knex('roles').insert([
                // MSP Roles
                { tenant: knex('tenants').select('tenant').first(), role_name: 'Admin', description: 'Full system administrator access', msp: true, client: false },
                { tenant: knex('tenants').select('tenant').first(), role_name: 'Manager', description: 'Manage tickets and users', msp: true, client: false },
                { tenant: knex('tenants').select('tenant').first(), role_name: 'Technician', description: 'Technical support and ticket management', msp: true, client: false },
                { tenant: knex('tenants').select('tenant').first(), role_name: 'Finance', description: 'Financial operations and billing management', msp: true, client: false },
                { tenant: knex('tenants').select('tenant').first(), role_name: 'Project Manager', description: 'Project planning and management', msp: true, client: false },
                { tenant: knex('tenants').select('tenant').first(), role_name: 'Dispatcher', description: 'Technician scheduling and dispatch', msp: true, client: false },
                
                // Client Portal Roles
                { tenant: knex('tenants').select('tenant').first(), role_name: 'Admin', description: 'Client portal administrator', msp: false, client: true },
                { tenant: knex('tenants').select('tenant').first(), role_name: 'Finance', description: 'Client financial operations', msp: false, client: true },
                { tenant: knex('tenants').select('tenant').first(), role_name: 'User', description: 'Standard client portal user', msp: false, client: true }
            ]);
        });
};