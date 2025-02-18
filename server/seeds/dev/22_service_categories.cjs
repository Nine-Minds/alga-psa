exports.seed = function (knex) {
    return knex('service_categories').del()
        .then(() => {
            return knex('service_categories').insert([
                { tenant: knex('tenants').select('tenant').first(), category_name: 'Network Services', description: 'Services related to network infrastructure' },
                { tenant: knex('tenants').select('tenant').first(), category_name: 'Security Services', description: 'Services focused on cybersecurity' },
                { tenant: knex('tenants').select('tenant').first(), category_name: 'Cloud Services', description: 'Cloud-based solutions and management' }
            ]);
        });
};