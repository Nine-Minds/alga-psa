exports.seed = function (knex) {
    return knex('tenants').select('tenant').first()
        .then((tenant) => {
            if (!tenant) return;
            return knex('time_sheets').insert([
                {
                    tenant: tenant.tenant,
                    user_id: knex('users').where({ 
                        tenant: tenant.tenant, 
                        username: 'glinda' 
                    }).select('user_id').first(),
                    period_id: knex('time_periods').where({ 
                        tenant: tenant.tenant
                    }).select('period_id').first(),
                    approval_status: 'SUBMITTED',
                    submitted_at: knex.raw("CURRENT_TIMESTAMP - INTERVAL '2 days'")
                }
            ]);
        });
};