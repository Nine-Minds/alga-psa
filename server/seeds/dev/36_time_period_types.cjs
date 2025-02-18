exports.seed = function (knex) {
    return knex('time_period_types').del()
        .then(() => {
            return knex('time_period_types').insert([
                { tenant: knex('tenants').select('tenant').first(), type_name: 'Weekly', description: 'Weekly time tracking period' },
                { tenant: knex('tenants').select('tenant').first(), type_name: 'Monthly', description: 'Monthly time tracking period' }
            ]);
        });
};