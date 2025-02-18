exports.seed = function (knex) {
    return knex('tenants').select('tenant').first()
        .then((tenant) => {
            if (!tenant) return;
            return knex('time_periods').insert([
                {
                    tenant: tenant.tenant,
                    period_id: knex('time_period_types').where({ 
                        tenant: tenant.tenant, 
                        type_name: 'Weekly' 
                    }).select('type_id').first(),
                    start_date: knex.raw("CURRENT_DATE - INTERVAL '2 weeks'"),
                    end_date: knex.raw("CURRENT_DATE - INTERVAL '1 week'"),
                    is_closed: true
                },
                {
                    tenant: tenant.tenant,
                    period_id: knex('time_period_types').where({ 
                        tenant: tenant.tenant, 
                        type_name: 'Monthly' 
                    }).select('type_id').first(),
                    start_date: knex.raw("DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '1 month'"),
                    end_date: knex.raw("DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '1 day'"),
                    is_closed: true
                }
            ]);
        });
};