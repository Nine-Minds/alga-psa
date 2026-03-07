exports.seed = function (knex) {
    return knex('tenants').select('tenant').first()
        .then((tenant) => {
            if (!tenant) return;
            return knex('time_periods').insert([
                {
                    tenant: tenant.tenant,
                    start_date: knex.raw("DATE_TRUNC('week', CURRENT_DATE) - INTERVAL '1 week'"),
                    end_date: knex.raw("DATE_TRUNC('week', CURRENT_DATE)"),
                    is_closed: true
                },
                {
                    tenant: tenant.tenant,
                    start_date: knex.raw("DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '1 month'"),
                    end_date: knex.raw("DATE_TRUNC('month', CURRENT_DATE)"),
                    is_closed: true
                }
            ]);
        });
};
