exports.seed = function(knex) {
    return knex('tenants').select('tenant').first()
        .then((tenant) => {
            if (!tenant) return;
            return knex('severities').insert([
                {
                    tenant: tenant.tenant,
                    severity_name: 'Trifling Trouble',
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
                    severity_name: 'Moderate Muddle',
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
                    severity_name: 'Serious Snarl',
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
