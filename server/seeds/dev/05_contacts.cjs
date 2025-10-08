exports.seed = function(knex) {
    return knex('tenants').select('tenant').first()
        .then((tenant) => {
            if (!tenant) return;
            return knex('contacts').insert([
                {
                    tenant: tenant.tenant,
                    full_name: 'Dorothy Gale',
                    client_id: knex('clients')
                        .where({
                            tenant: tenant.tenant,
                            client_name: 'Emerald City'
                        })
                        .select('client_id')
                        .first(),
                    phone_number: '+1-555-987-6543',
                    email: 'dorothy@oz.com',
                    created_at: knex.fn.now()
                },
                {
                    tenant: tenant.tenant,
                    full_name: 'Alice in Wonderland',
                    client_id: knex('clients')
                        .where({
                            tenant: tenant.tenant,
                            client_name: 'Wonderland'
                        })
                        .select('client_id')
                        .first(),
                    phone_number: '+1-555-246-8135',
                    email: 'alice@wonderland.com',
                    created_at: knex.fn.now()
                }
            ]);
        });
};