exports.seed = function (knex) {
    return knex('roles').del()
        .then(() => {
            return knex('roles').insert([
                { tenant: knex('tenants').select('tenant').first(), role_name: 'Admin', description: 'Full system access' },
                { tenant: knex('tenants').select('tenant').first(), role_name: 'Manager', description: 'Manage tickets and users' },
                { tenant: knex('tenants').select('tenant').first(), role_name: 'Technician', description: 'Handle tickets' }
            ]);
        });
};