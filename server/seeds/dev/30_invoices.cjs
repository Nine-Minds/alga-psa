const { getFirstTenantSeedContext } = require('./_tenant.cjs');

exports.seed = async function (knex) {
    const context = await getFirstTenantSeedContext(knex);
    if (!context) return;

    const { tenantId, db } = context;
    const emeraldCityClientId = db.table('clients')
        .where({ client_name: 'Emerald City' })
        .select('client_id')
        .first();
    const detailedTemplateId = db.table('invoice_templates')
        .where({ name: 'Detailed Template' })
        .select('template_id')
        .first();

    return db.table('invoices').insert([
        {
            tenant: tenantId,
            client_id: emeraldCityClientId,
            invoice_number: 'INV-003',
            invoice_date: knex.raw("DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '1 month'"),
            due_date: knex.raw("DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '15 days'"),
            total_amount: 5000.00,
            status: 'Unpaid',
            template_id: detailedTemplateId,
            custom_fields: JSON.stringify([
                {
                    name: 'Payment Terms',
                    type: 'text',
                    default_value: '"Net 30"',
                    value: null
                }])
        },
        {
            tenant: tenantId,
            client_id: emeraldCityClientId,
            invoice_number: 'INV-004',
            invoice_date: knex.raw("DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '1 month'"),
            due_date: knex.raw("DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '15 days'"),
            total_amount: 10000.00,
            status: 'Unpaid',
            template_id: detailedTemplateId,
            custom_fields: JSON.stringify([
                {
                    name: 'Payment Terms',
                    type: 'text',
                    default_value: '"Net 30"',
                    value: null
                }])
        },
        {
            tenant: tenantId,
            client_id: emeraldCityClientId,
            invoice_number: 'INV-005',
            invoice_date: knex.raw("DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '1 month'"),
            due_date: knex.raw("DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '15 days'"),
            total_amount: 7500.00,
            status: 'Unpaid',
            template_id: detailedTemplateId,
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
};
