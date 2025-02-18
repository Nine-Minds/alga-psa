exports.seed = function (knex) {
    return knex('tenants').select('tenant').first()
        .then((tenant) => {
            if (!tenant) return;
            return knex('comments').insert([
                {
                    tenant: tenant.tenant,
                    comment_id: knex.raw('gen_random_uuid()'),
                    ticket_id: knex('tickets')
                        .where({
                            tenant: tenant.tenant,
                            title: 'Missing White Rabbit'
                        })
                        .select('ticket_id')
                        .first(),
                    user_id: knex('users')
                        .where({
                            tenant: tenant.tenant,
                            username: 'glinda'
                        })
                        .select('user_id')
                        .first(),
                    note: 'Initial report of missing White Rabbit. Last seen heading towards the tea party.',
                    is_internal: false,
                    is_resolution: false,
                    is_initial_description: true,
                    created_at: knex.fn.now()
                },
                {
                    tenant: tenant.tenant,
                    comment_id: knex.raw('gen_random_uuid()'),
                    ticket_id: knex('tickets')
                        .where({
                            tenant: tenant.tenant,
                            title: 'Missing White Rabbit'
                        })
                        .select('ticket_id')
                        .first(),
                    user_id: knex('users')
                        .where({
                            tenant: tenant.tenant,
                            username: 'glinda'
                        })
                        .select('user_id')
                        .first(),
                    note: 'Last seen heading towards the tea party.',
                    is_internal: true,
                    is_resolution: false,
                    is_initial_description: false,
                    created_at: knex.fn.now()
                },
                {
                    tenant: tenant.tenant,
                    comment_id: knex.raw('gen_random_uuid()'),
                    ticket_id: knex('tickets')
                        .where({
                            tenant: tenant.tenant,
                            title: 'Missing White Rabbit'
                        })
                        .select('ticket_id')
                        .first(),
                    user_id: knex('users')
                        .where({
                            tenant: tenant.tenant,
                            username: 'glinda'
                        })
                        .select('user_id')
                        .first(),
                    note: 'White Rabbit was arrested at the tea party.',
                    is_internal: false,
                    is_resolution: true,
                    is_initial_description: false,
                    created_at: knex.fn.now()
                }
            ]);
        });
};