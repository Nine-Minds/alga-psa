exports.seed = function (knex) {
    return knex('approval_levels').del()
        .then(async () => {
            const tenant = await knex('tenants').select('tenant').first();
            return knex('approval_levels').insert([
                { tenant: tenant?.tenant ?? null, name: 'Team Lead', order_num: 1 },
                { tenant: tenant?.tenant ?? null, name: 'Manager', order_num: 2 },
                { tenant: tenant?.tenant ?? null, name: 'Director', order_num: 3 }
            ]);
        });
};
