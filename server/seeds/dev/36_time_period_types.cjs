exports.seed = function (knex) {
    return knex('time_period_types').del()
        .then(async () => {
            const tenant = await knex('tenants').select('tenant').first();
            return knex('time_period_types').insert([
                { tenant: tenant?.tenant ?? null, type_name: 'Weekly', description: 'Weekly time tracking period' },
                { tenant: tenant?.tenant ?? null, type_name: 'Monthly', description: 'Monthly time tracking period' }
            ]);
        });
};
