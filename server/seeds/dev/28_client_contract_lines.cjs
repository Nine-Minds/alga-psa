exports.seed = async function (knex) {
    // As of 0.15.x the legacy `client_contract_lines` table may be removed.
    // Skip gracefully if absent.
    const hasClientContractLines = await knex.schema.hasTable('client_contract_lines');
    if (!hasClientContractLines) return;

    const tenant = await knex('tenants').select('tenant').first();
    if (!tenant) return;
    
    return knex('client_contract_lines').insert([
        {
            tenant: tenant.tenant,
            client_id: knex('clients').where({ tenant: tenant.tenant, client_name: 'Wonderland' }).select('client_id').first(),
            contract_line_id: knex('contract_lines').where({ tenant: tenant.tenant, contract_line_name: 'Wonderland Basic' }).select('contract_line_id').first(),
            service_category: knex('service_categories').where({ tenant: tenant.tenant, category_name: 'Network Services' }).select('category_id').first(),
            start_date: knex.raw("CURRENT_DATE - INTERVAL '3 months'"),
            end_date: null,
            is_active: true
        },
        {
            tenant: tenant.tenant,
            client_id: knex('clients').where({ tenant: tenant.tenant, client_name: 'Emerald City' }).select('client_id').first(),
            contract_line_id: knex('contract_lines').where({ tenant: tenant.tenant, contract_line_name: 'Oz Premium' }).select('contract_line_id').first(),
            service_category: knex('service_categories').where({ tenant: tenant.tenant, category_name: 'Security Services' }).select('category_id').first(),
            start_date: knex.raw("CURRENT_DATE - INTERVAL '6 months'"),
            end_date: null,
            is_active: true
        },
        {
            tenant: tenant.tenant,
            client_id: knex('clients').where({ tenant: tenant.tenant, client_name: 'Emerald City' }).select('client_id').first(),
            contract_line_id: knex('contract_lines').where({ tenant: tenant.tenant, contract_line_name: 'Oz Premium' }).select('contract_line_id').first(),
            service_category: knex('service_categories').where({ tenant: tenant.tenant, category_name: 'Network Services' }).select('category_id').first(),
            start_date: knex.raw("CURRENT_DATE - INTERVAL '6 months'"),
            end_date: null,
            is_active: true
        },
        {
            tenant: tenant.tenant,
            client_id: knex('clients').where({ tenant: tenant.tenant, client_name: 'Emerald City' }).select('client_id').first(),
            contract_line_id: knex('contract_lines').where({ tenant: tenant.tenant, contract_line_name: 'Custom Cheshire' }).select('contract_line_id').first(),
            service_category: knex('service_categories').where({ tenant: tenant.tenant, category_name: 'Security Services' }).select('category_id').first(),
            start_date: knex.raw("CURRENT_DATE - INTERVAL '2 months'"),
            end_date: null,
            is_active: true
        },     
        {
            tenant: tenant.tenant,
            client_id: knex('clients').where({ tenant: tenant.tenant, client_name: 'Emerald City' }).select('client_id').first(),
            contract_line_id: knex('contract_lines').where({ tenant: tenant.tenant, contract_line_name: 'Custom Cheshire' }).select('contract_line_id').first(),
            service_category: knex('service_categories').where({ tenant: tenant.tenant, category_name: 'Cloud Services' }).select('category_id').first(),
            start_date: knex.raw("CURRENT_DATE - INTERVAL '1 month'"),
            end_date: null,
            is_active: true
        }      
    ]);
};
