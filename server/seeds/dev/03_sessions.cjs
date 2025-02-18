exports.seed = function(knex) {
    return knex('tenants').select('tenant').first()
        .then((tenant) => {
            if (!tenant) return;
            return knex('users')
                .select('user_id')
                .where({
                    tenant: tenant.tenant,
                    username: 'glinda'
                })
                .first()
                .then((user) => {
                    if (user) {
                        return knex('sessions').insert([
                            {
                                tenant: tenant.tenant,
                                user_id: user.user_id,
                                token: 'sample_token_1234567890',
                                created_at: knex.raw("CURRENT_TIMESTAMP - INTERVAL '1 hour'")
                            },
                            {
                                tenant: tenant.tenant,
                                user_id: user.user_id,
                                token: 'sample_token_0987654321',
                                created_at: knex.raw("CURRENT_TIMESTAMP - INTERVAL '30 minutes'")
                            }
                        ]);
                    }
                });
        });
};
