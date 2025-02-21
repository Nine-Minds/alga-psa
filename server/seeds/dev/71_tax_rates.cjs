exports.seed = function (knex) {
    return knex('tenants').select('tenant').first()
        .then((tenant) => {
            if (!tenant) return;
            return knex('tax_rates').insert([
                {
                    tax_rate_id: knex.raw('gen_random_uuid()'),
                    tenant: tenant.tenant,
                    region: 'US-FL',
                    tax_percentage: 6,
                    description: 'Florida Sales Tax',
                    start_date: knex.raw('CURRENT_DATE')
                }
            ]);
        });
};