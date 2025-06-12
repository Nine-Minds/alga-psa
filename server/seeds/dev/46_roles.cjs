exports.seed = function (knex) {
    return knex('roles').del()
        .then(() => {
            return knex('roles').insert([
                { tenant: knex('tenants').select('tenant').first(), role_name: 'Admin', description: 'Full system access' },
                { tenant: knex('tenants').select('tenant').first(), role_name: 'Manager', description: 'Manage tickets and users' },
                { tenant: knex('tenants').select('tenant').first(), role_name: 'Technician', description: 'Handle tickets' },
                { tenant: knex('tenants').select('tenant').first(), role_name: 'Client', description: 'Client user role' },
                { tenant: knex('tenants').select('tenant').first(), role_name: 'Client_Admin', description: 'Client administrator role' },
                { tenant: knex('tenants').select('tenant').first(), role_name: 'Dispatcher', description: 'Role for users who can dispatch and schedule for other users' }
            ]);
        });
};