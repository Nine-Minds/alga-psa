exports.seed = function (knex) {
    return knex('tenants').select('tenant').first()
        .then((tenant) => {
            if (!tenant) return;
            return knex('contract_lines').insert([
                {
                    tenant: tenant.tenant,
                    contract_line_name: 'Wonderland Basic',
                    description: 'Basic services for Wonderland residents',
                    billing_frequency: 'Monthly',
                    is_custom: false,
                    contract_line_type: 'Fixed'
                },
                {
                    tenant: tenant.tenant,
                    contract_line_name: 'Oz Premium',
                    description: 'Premium services for Emerald City',
                    billing_frequency: 'Monthly',
                    is_custom: false,
                    contract_line_type: 'Fixed'
                },
                {
                    tenant: tenant.tenant,
                    contract_line_name: 'Custom Cheshire',
                    description: 'Custom plan for special clients',
                    billing_frequency: 'Quarterly',
                    is_custom: true,
                    contract_line_type: 'Hourly'
                }
            ]);
        });
};