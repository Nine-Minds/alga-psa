exports.seed = function (knex) {
    return Promise.resolve();
    /*
    return knex('tenants').select('tenant').first()
        .then((tenant) => {
            if (!tenant) return;
            return knex('bucket_usage').insert([
                {
                    tenant: tenant.tenant,
                    bucket_contract_line_id: knex('bucket_plans').where({ 
                        tenant: tenant.tenant, 
                        contract_line_id: knex('contract_lines').where({ 
                            tenant: tenant.tenant, 
                            contract_line_name: 'Wonderland Basic' 
                        }).select('contract_line_id').first() 
                    }).select('bucket_contract_line_id').first(),
                    client_id: knex('clients').where({ 
                        tenant: tenant.tenant, 
                        client_name: 'Wonderland' 
                    }).select('client_id').first(),
                    period_start: knex.raw("DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '1 month'"),
                    period_end: knex.raw("DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '1 day'"),
                    hours_used: 35,
                    overage_hours: 0,
                    service_catalog_id: knex('service_catalog').where({ 
                        tenant: tenant.tenant,
                        service_name: 'Basic Support' 
                    }).select('service_id').first()
                },
                {
                    tenant: tenant.tenant,
                    bucket_contract_line_id: knex('bucket_plans').where({ 
                        tenant: tenant.tenant, 
                        contract_line_id: knex('contract_lines').where({ 
                            tenant: tenant.tenant, 
                            contract_line_name: 'Oz Premium' 
                        }).select('contract_line_id').first() 
                    }).select('bucket_contract_line_id').first(),
                    client_id: knex('clients').where({ 
                        tenant: tenant.tenant, 
                        client_name: 'Emerald City' 
                    }).select('client_id').first(),
                    period_start: knex.raw("DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '1 month'"),
                    period_end: knex.raw("DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '1 day'"),
                    hours_used: 110,
                    overage_hours: 10,
                    service_catalog_id: knex('service_catalog').where({ 
                        tenant: tenant.tenant,
                        service_name: 'Premium Support' 
                    }).select('service_id').first()
                }
            ]);
        }); */
};
