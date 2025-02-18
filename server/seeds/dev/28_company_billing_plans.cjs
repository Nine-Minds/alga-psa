exports.seed = async function (knex) {
    const tenant = await knex('tenants').select('tenant').first();
    if (!tenant) return;
    
    return knex('company_billing_plans').insert([
        {
            tenant: tenant.tenant,
            company_id: knex('companies').where({ tenant: tenant.tenant, company_name: 'Wonderland' }).select('company_id').first(),
            plan_id: knex('billing_plans').where({ tenant: tenant.tenant, plan_name: 'Wonderland Basic' }).select('plan_id').first(),
            service_category: knex('service_categories').where({ tenant: tenant.tenant, category_name: 'Network Services' }).select('category_id').first(),
            start_date: knex.raw("CURRENT_DATE - INTERVAL '3 months'"),
            end_date: null,
            is_active: true
        },
        {
            tenant: tenant.tenant,
            company_id: knex('companies').where({ tenant: tenant.tenant, company_name: 'Emerald City' }).select('company_id').first(),
            plan_id: knex('billing_plans').where({ tenant: tenant.tenant, plan_name: 'Oz Premium' }).select('plan_id').first(),
            service_category: knex('service_categories').where({ tenant: tenant.tenant, category_name: 'Security Services' }).select('category_id').first(),
            start_date: knex.raw("CURRENT_DATE - INTERVAL '6 months'"),
            end_date: null,
            is_active: true
        },
        {
            tenant: tenant.tenant,
            company_id: knex('companies').where({ tenant: tenant.tenant, company_name: 'Emerald City' }).select('company_id').first(),
            plan_id: knex('billing_plans').where({ tenant: tenant.tenant, plan_name: 'Oz Premium' }).select('plan_id').first(),
            service_category: knex('service_categories').where({ tenant: tenant.tenant, category_name: 'Network Services' }).select('category_id').first(),
            start_date: knex.raw("CURRENT_DATE - INTERVAL '6 months'"),
            end_date: null,
            is_active: true
        },
        {
            tenant: tenant.tenant,
            company_id: knex('companies').where({ tenant: tenant.tenant, company_name: 'Emerald City' }).select('company_id').first(),
            plan_id: knex('billing_plans').where({ tenant: tenant.tenant, plan_name: 'Custom Cheshire' }).select('plan_id').first(),
            service_category: knex('service_categories').where({ tenant: tenant.tenant, category_name: 'Security Services' }).select('category_id').first(),
            start_date: knex.raw("CURRENT_DATE - INTERVAL '2 months'"),
            end_date: null,
            is_active: true
        },     
        {
            tenant: tenant.tenant,
            company_id: knex('companies').where({ tenant: tenant.tenant, company_name: 'Emerald City' }).select('company_id').first(),
            plan_id: knex('billing_plans').where({ tenant: tenant.tenant, plan_name: 'Custom Cheshire' }).select('plan_id').first(),
            service_category: knex('service_categories').where({ tenant: tenant.tenant, category_name: 'Cloud Services' }).select('category_id').first(),
            start_date: knex.raw("CURRENT_DATE - INTERVAL '1 month'"),
            end_date: null,
            is_active: true
        }      
    ]);
};