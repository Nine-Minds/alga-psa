exports.seed = function(knex) {
    return knex('tenants').select('tenant').first()
        .then((tenant) => {
            if (!tenant) return;
            return knex('priorities').insert([
                {
                    tenant: tenant.tenant,
                    priority_name: 'Whimsical Wish',
                    display_order: 1,
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
                    display_order: 2,
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
                    display_order: 3,
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
