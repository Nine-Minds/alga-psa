exports.seed = function (knex) {
    return knex('tenants').select('tenant').first()
        .then((tenant) => {
            if (!tenant) return;
            return knex('billing_plans').insert([
                {
                    tenant: tenant.tenant,
                    plan_name: 'Wonderland Basic',
                    description: 'Basic services for Wonderland residents',
                    billing_frequency: 'Monthly',
                    is_custom: false,
                    plan_type: 'Fixed'
                },
                {
                    tenant: tenant.tenant,
                    plan_name: 'Oz Premium',
                    description: 'Premium services for Emerald City',
                    billing_frequency: 'Monthly',
                    is_custom: false,
                    plan_type: 'Fixed'
                },
                {
                    tenant: tenant.tenant,
                    plan_name: 'Custom Cheshire',
                    description: 'Custom plan for special clients',
                    billing_frequency: 'Quarterly',
                    is_custom: true,
                    plan_type: 'Hourly'
                }
            ]);
        });
};