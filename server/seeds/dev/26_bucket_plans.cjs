exports.seed = function (knex) {
    return knex('tenants').select('tenant').first()
        .then((tenant) => {
            if (!tenant) return;
            return knex('bucket_plans').insert([
                {
                    tenant: tenant.tenant,
                    plan_id: knex('billing_plans').where({ tenant: tenant.tenant, plan_name: 'Wonderland Basic' }).select('plan_id').first(),
                    total_hours: 40,
                    billing_period: 'Monthly',
                    overage_rate: 100.00
                },
                {
                    tenant: tenant.tenant,
                    plan_id: knex('billing_plans').where({ tenant: tenant.tenant, plan_name: 'Oz Premium' }).select('plan_id').first(),
                    total_hours: 100,
                    billing_period: 'Monthly',
                    overage_rate: 150.00
                }
            ]);
        });
};