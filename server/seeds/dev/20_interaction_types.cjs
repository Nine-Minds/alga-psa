exports.seed = function(knex) {
    return knex('tenants').select('tenant').first()
        .then((tenant) => {
            if (!tenant) return;
            return knex('interaction_types').insert([
                {
                    tenant: tenant.tenant,
                    type_name: 'Phone Call',
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
                    type_name: 'Email',
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
                    type_name: 'In-Person Meeting',
                    display_order: 3,
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
                    type_name: 'Chat/Instant Message',
                    display_order: 4,
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