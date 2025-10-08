
exports.seed = function(knex) {
    return knex('clients').del()
        .then(() => {
            return knex('tenants').select('tenant').first();
        })
        .then((tenant) => {
            if (tenant) {
                return knex('clients').insert([
                    {
                        tenant: tenant.tenant,
                        client_name: 'Emerald City',
                        url: 'https://emeraldcity.oz',
                        created_at: knex.fn.now(),
                        client_type: 'company'
                    },
                    {
                        tenant: tenant.tenant,
                        client_name: 'Wonderland',
                        url: 'https://wonderland.com',
                        created_at: knex.fn.now(),
                        client_type: 'company'
                    },
                    {
                        tenant: tenant.tenant,
                        client_name: 'White Rabbit',
                        created_at: knex.fn.now(),
                        client_type: 'individual'
                    }
                ]);
            }
        });
};