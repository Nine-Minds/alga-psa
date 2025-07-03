exports.seed = function(knex) {
    return knex('tenants').select('tenant').first()
        .then((tenant) => {
            if (!tenant) return;
            return knex('priorities').insert([
                {
                    tenant: tenant.tenant,
                    priority_name: 'Whimsical Wish',
                    order_number: 1,
                    created_by: knex('users')
                        .where({
                            tenant: tenant.tenant,
                            username: 'glinda'
                        })
                        .select('user_id')
                        .first()
                },
                {
                    tenant: tenant.tenant,
                    priority_name: 'Curious Conundrum',
                    order_number: 2,
                    created_by: knex('users')
                        .where({
                            tenant: tenant.tenant,
                            username: 'glinda'
                        })
                        .select('user_id')
                        .first()
                },
                {
                    tenant: tenant.tenant,
                    priority_name: 'Enchanted Emergency',
                    order_number: 3,
                    created_by: knex('users')
                        .where({
                            tenant: tenant.tenant,
                            username: 'glinda'
                        })
                        .select('user_id')
                        .first()
                }
            ]);
        });
};
