exports.seed = function(knex) {
    return knex('tenants').select('tenant').first()
        .then((tenant) => {
            if (!tenant) return;
            return knex('urgencies').insert([
                {
                    tenant: tenant.tenant,
                    urgency_name: 'Leisurely Lark',
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
                    urgency_name: 'Tick-Tock Task',
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
                    urgency_name: 'Hare-Paced Hustle',
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