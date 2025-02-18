exports.seed = function (knex) {
    return knex('approval_levels').del()
        .then(() => {
            return knex('approval_levels').insert([
                { tenant: knex('tenants').select('tenant').first(), name: 'Team Lead', order_num: 1 },
                { tenant: knex('tenants').select('tenant').first(), name: 'Manager', order_num: 2 },
                { tenant: knex('tenants').select('tenant').first(), name: 'Director', order_num: 3 }
            ]);
        });
};