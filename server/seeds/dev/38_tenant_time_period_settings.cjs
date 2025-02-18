exports.seed = function (knex) {
    return knex('tenants').select('tenant').first()
        .then((tenant) => {
            if (!tenant) return;
            return knex('tenant_time_period_settings').insert([
                {
                    tenant: tenant.tenant,
                    type_id: knex('time_period_types').where({ 
                        tenant: tenant.tenant, 
                        type_name: 'Weekly' 
                    }).select('type_id').first(),
                    start_day: 1,
                    start_month: 1,
                    frequency: 1,
                    frequency_unit: 'week',
                    is_active: true,
                    effective_from: knex.raw("CURRENT_DATE - INTERVAL '1 year'")
                },
                {
                    tenant: tenant.tenant,
                    type_id: knex('time_period_types').where({ 
                        tenant: tenant.tenant, 
                        type_name: 'Monthly' 
                    }).select('type_id').first(),
                    start_day: 1,
                    start_month: 1,
                    frequency: 1,
                    frequency_unit: 'month',
                    is_active: true,
                    effective_from: knex.raw("CURRENT_DATE - INTERVAL '1 year'")
                }
            ]);
        });
};