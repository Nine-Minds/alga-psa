exports.seed = function (knex) {
    return knex('tenants').select('tenant').first()
        .then((tenant) => {
            if (!tenant) return;
            return knex('usage_tracking').insert([
                {
                    tenant: tenant.tenant,
                    company_id: knex('companies').where({ 
                        tenant: tenant.tenant, 
                        company_name: 'Wonderland' 
                    }).select('company_id').first(),
                    service_id: knex('service_catalog').where({ 
                        tenant: tenant.tenant, 
                        service_name: 'Shrinking Potion' 
                    }).select('service_id').first(),
                    usage_date: knex.raw("DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '2 days'"),
                    quantity: 3
                },
                {
                    tenant: tenant.tenant,
                    company_id: knex('companies').where({ 
                        tenant: tenant.tenant, 
                        company_name: 'Wonderland' 
                    }).select('company_id').first(),
                    service_id: knex('service_catalog').where({ 
                        tenant: tenant.tenant, 
                        service_name: 'Yellow Brick Road Repair' 
                    }).select('service_id').first(),
                    usage_date: knex.raw("DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '1 day'"),
                    quantity: 2
                }
            ]);
        });
};