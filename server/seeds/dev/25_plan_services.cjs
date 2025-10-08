exports.seed = function (knex) {
    return knex('tenants').select('tenant').first()
        .then((tenant) => {
            if (!tenant) return;
            return knex('plan_services').insert([
                {
                    tenant: tenant.tenant,
                    contract_line_id: knex('contract_lines').where({ tenant: tenant.tenant, contract_line_name: 'Wonderland Basic' }).select('contract_line_id').first(),
                    service_id: knex('service_catalog').where({ tenant: tenant.tenant, service_name: 'Rabbit Tracking' }).select('service_id').first(),
                    quantity: 10,
                    custom_rate: null
                },
                {
                    tenant: tenant.tenant,
                    contract_line_id: knex('contract_lines').where({ tenant: tenant.tenant, contract_line_name: 'Wonderland Basic' }).select('contract_line_id').first(),
                    service_id: knex('service_catalog').where({ tenant: tenant.tenant, service_name: 'Looking Glass Maintenance' }).select('service_id').first(),
                    quantity: 1,
                    custom_rate: null
                },
                {
                    tenant: tenant.tenant,
                    contract_line_id: knex('contract_lines').where({ tenant: tenant.tenant, contract_line_name: 'Oz Premium' }).select('contract_line_id').first(),
                    service_id: knex('service_catalog').where({ tenant: tenant.tenant, service_name: 'Yellow Brick Road Repair' }).select('service_id').first(),
                    quantity: 20,
                    custom_rate: null
                },
                {
                    tenant: tenant.tenant,
                    contract_line_id: knex('contract_lines').where({ tenant: tenant.tenant, contract_line_name: 'Oz Premium' }).select('contract_line_id').first(),
                    service_id: knex('service_catalog').where({ tenant: tenant.tenant, service_name: 'Emerald City Security' }).select('service_id').first(),
                    quantity: 1,
                    custom_rate: null
                }]);
        });
};