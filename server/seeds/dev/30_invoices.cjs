exports.seed = function (knex) {
    return knex('tenants').select('tenant').first()
        .then((tenant) => {
            if (!tenant) return;
            return knex('invoices').insert([
                {
                    tenant: tenant.tenant,
                    company_id: knex('companies').where({ 
                        tenant: tenant.tenant, 
                        company_name: 'Emerald City' 
                    }).select('company_id').first(),
                    invoice_number: 'INV-003',
                    invoice_date: knex.raw("DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '1 month'"),
                    due_date: knex.raw("DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '15 days'"),
                    total_amount: 5000.00,
                    status: 'Unpaid',
                    template_id: knex('invoice_templates').where({ 
                        tenant: tenant.tenant, 
                        name: 'Detailed Template' 
                    }).select('template_id').first(),
                    custom_fields: JSON.stringify([
                        {
                            name: 'Payment Terms',
                            type: 'text',
                            default_value: '"Net 30"',
                            value: null
                        }])
                },
                {
                    tenant: tenant.tenant,
                    company_id: knex('companies').where({ 
                        tenant: tenant.tenant, 
                        company_name: 'Emerald City' 
                    }).select('company_id').first(),
                    invoice_number: 'INV-004',
                    invoice_date: knex.raw("DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '1 month'"),
                    due_date: knex.raw("DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '15 days'"),
                    total_amount: 10000.00,
                    status: 'Unpaid',
                    template_id: knex('invoice_templates').where({ 
                        tenant: tenant.tenant, 
                        name: 'Detailed Template' 
                    }).select('template_id').first(),
                    custom_fields: JSON.stringify([
                        {
                            name: 'Payment Terms',
                            type: 'text',
                            default_value: '"Net 30"',
                            value: null
                        }])
                },
                {
                    tenant: tenant.tenant,
                    company_id: knex('companies').where({ 
                        tenant: tenant.tenant, 
                        company_name: 'Emerald City' 
                    }).select('company_id').first(),
                    invoice_number: 'INV-005',
                    invoice_date: knex.raw("DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '1 month'"),
                    due_date: knex.raw("DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '15 days'"),
                    total_amount: 7500.00,
                    status: 'Unpaid',
                    template_id: knex('invoice_templates').where({ 
                        tenant: tenant.tenant, 
                        name: 'Detailed Template' 
                    }).select('template_id').first(),
                    custom_fields: JSON.stringify([
                        {
                            name: 'Payment Terms',
                            type: 'text',
                            default_value: '"Net 30"',
                            value: null
                        },
                        {
                            name: 'Customer PO',
                            type: 'text',
                            default_value: null,
                            value: 'PO-005'
                        },
                        {
                            name: 'Discount',
                            type: 'number',
                            default_value: null,
                            value: 2
                        }
                    ])
                }
            ]);
        });
};