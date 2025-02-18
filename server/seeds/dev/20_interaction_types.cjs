exports.seed = function (knex) {
    return knex('interaction_types').del()
        .then(() => {
            return knex('interaction_types').insert([
                { tenant: knex('tenants').select('tenant').first(), type_name: 'Call', icon: 'phone' },
                { tenant: knex('tenants').select('tenant').first(), type_name: 'Email', icon: 'mail' },
                { tenant: knex('tenants').select('tenant').first(), type_name: 'Meeting', icon: 'calendar' },
                { tenant: knex('tenants').select('tenant').first(), type_name: 'Note', icon: 'file-text' }
            ]);
        });
};